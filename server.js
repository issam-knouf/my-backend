/**
 * VoltRide API – inline checkout (TWINT + card on the same page) + Telegram notifications.
 *
 * Environment variables (set them in Render → Environment, never in code):
 *   STRIPE_SECRET_KEY       sk_test_… or sk_live_…
 *   STRIPE_WEBHOOK_SECRET   whsec_…  (Stripe → Developers → Webhooks)
 *   TELEGRAM_BOT_TOKEN      123456:ABC…  (from @BotFather)
 *   TELEGRAM_CHAT_ID        your chat / group id
 *   SITE_URL                https://www.your-domain.ch   (where the shop is hosted)
 *   ALLOWED_ORIGINS         comma list, e.g. https://www.your-domain.ch,https://your-domain.ch
 *   NOTIFY_EVENTS           optional, comma list to limit Telegram messages, e.g. "add_to_cart,checkout_info,paid"
 *   ADMIN_TOKEN             long random string; protects GET /customers and POST /charge-saved (send as x-admin-token)
 *   --- PDF patterns (digital products, sold via direct links like /fr/commande.html?buy=101) ---
 *   DOWNLOAD_SECRET         long random string; signs the download links
 *   API_URL                 this API's own address, e.g. https://air-back-juq4.onrender.com
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM   e-mail account that sends the download links
 *   FILES_DIR               optional, default ./files – one folder per product id: files/101/*.pdf, files/102/*.pdf
 *
 * Stripe webhook endpoint must listen to: payment_intent.succeeded, payment_intent.payment_failed
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const catalog = require('./catalog.json');

const {
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  ALLOWED_ORIGINS = '', NOTIFY_EVENTS = '', PORT = 3000,
} = process.env;
const SITE_URL = (process.env.SITE_URL || catalog.site_url).replace(/\/$/, '');
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;
const ONLY = NOTIFY_EVENTS.split(',').map(s => s.trim()).filter(Boolean);
const LANGS = ['de', 'fr', 'en'];

const app = express();
app.set('trust proxy', true); // Render sits behind a proxy – gives the real visitor IP in req.ip

// ---------------- helpers ----------------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const chf = n => 'CHF ' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
const clip = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ipOf = req => (req.headers['cf-connecting-ip'] || req.ip || '').replace(/^::ffff:/, '');
const country = req => req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '';
const orderId = () => 'VR-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor/i;

function device(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  return `${os} · ${br}`;
}

// ---------------- Telegram (queued, respects rate limits) ----------------
const queue = [];
let pumping = false;
function telegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log('[telegram disabled]\n' + text.replace(/<[^>]+>/g, '')); return; }
  if (queue.length > 500) queue.shift();
  queue.push(text);
  pump();
}
async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const text = queue.shift();
    try {
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        queue.unshift(text);
        await sleep(((j.parameters && j.parameters.retry_after) || 3) * 1000);
        continue;
      }
      if (!r.ok) console.error('Telegram error', r.status, await r.text());
    } catch (e) { console.error('Telegram failed', e.message); }
    await sleep(1100);
  }
  pumping = false;
}
const wants = ev => !ONLY.length || ONLY.includes(ev);

// ---------------- simple per-IP rate limit ----------------
const hits = new Map();
function limited(ip, max = 120, windowMs = 10 * 60 * 1000) {
  const now = Date.now(), h = hits.get(ip);
  if (!h || h.reset < now) { hits.set(ip, { n: 1, reset: now + windowMs }); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60 * 1000).unref();

// ---------------- cart validation (prices always come from catalog.json, never from the browser) ----------------
function priceCart(items, lang) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error('Cart is empty or invalid');
  const lines = items.map(i => {
    const p = catalog.products[String(i.id)];
    const qty = parseInt(i.qty, 10);
    if (!p) throw new Error('Unknown product ' + i.id);
    if (!p.stock) throw new Error('Product sold out: ' + p.name[lang]);
    if (!(qty >= 1 && qty <= 20)) throw new Error('Invalid quantity');
    const q = p.digital ? 1 : qty;
    return { id: String(i.id), name: p.name[lang] || p.name.de, price: p.price, qty: q, total: Math.round(p.price * q * 100) / 100, digital: !!p.digital };
  });
  const subtotal = Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
  const physical = lines.filter(l => !l.digital).reduce((a, l) => a + l.total, 0);
  const shipping = physical === 0 || physical >= catalog.free_shipping_from ? 0 : catalog.shipping_flat;
  const digital = lines.some(l => l.digital), onlyDigital = lines.every(l => l.digital);
  return { lines, subtotal, shipping, total: Math.round((subtotal + shipping) * 100) / 100, digital, onlyDigital };
}
function cleanCustomer(c = {}) {
  return {
    name: clip(c.name, 120), email: clip(c.email, 160), phone: clip(c.phone, 40), street: clip(c.street, 160),
    zip: clip(c.zip, 10), city: clip(c.city, 80), country: clip(c.country, 40), note: clip(c.note, 1000),
  };
}
// the customer details travel with the PaymentIntent metadata, so the webhook can notify without a database
const metaCustomer = (md = {}) => ({
  name: md.name || '', email: md.email || '', phone: md.phone || '', street: md.street || '',
  zip: md.zip || '', city: md.city || '', country: md.country || '', note: md.note || '',
});
function linesFromMeta(str = '', lang) {
  return String(str).split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [id, q] = s.split('x');
    const p = catalog.products[id];
    if (!p) return null;
    const qty = parseInt(q, 10) || 1;
    return { id, name: p.name[lang] || p.name.de, price: p.price, qty, total: Math.round(p.price * qty * 100) / 100 };
  }).filter(Boolean);
}
const linesText = lines => lines.map(l => `• ${l.qty} × ${esc(l.name)} (#${l.id}) = ${chf(l.total)}`).join('\n');
const customerText = c => [
  `👤 <b>${esc(c.name)}</b>`, `✉️ ${esc(c.email)}`, c.phone && `📞 ${esc(c.phone)}`,
  c.street ? `🏠 ${esc(c.street)}, ${esc(c.zip)} ${esc(c.city)}, ${esc(c.country)}` : '📄 PDF order – no address', c.note && `📝 ${esc(c.note)}`,
].filter(Boolean).join('\n');
const visitorText = (req, b = {}) => [
  `🌐 IP: <code>${esc(ipOf(req))}</code>${country(req) ? ' (' + esc(country(req)) + ')' : ''}`,
  b.vid && `🆔 Visitor: <code>${esc(clip(b.vid, 20))}</code>`,
  `📱 ${esc(device(req.headers['user-agent']))}${b.lang ? ' · ' + esc(String(b.lang).toUpperCase()) : ''}`,
].filter(Boolean).join('\n');

// ---------------- Stripe webhook (needs the raw body – must come before express.json) ----------------
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe not configured');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET); }
  catch (e) { console.error('Webhook signature failed', e.message); return res.status(400).send('Bad signature'); }
  res.json({ received: true }); // answer Stripe immediately, then notify

  try {
    const pi = event.data.object;
    const md = pi.metadata || {};
    const lang = LANGS.includes(md.lang) ? md.lang : 'de';

    if (event.type === 'payment_intent.succeeded') {
      if (md.digital === 'yes') deliverDigital(pi).catch(e => console.error('PDF delivery failed', e.message));
      if (!wants('paid')) return;
      let method = '', mandate = '';
      try {
        if (pi.latest_charge) {
          const ch = await stripe.charges.retrieve(pi.latest_charge);
          method = (ch.payment_method_details && ch.payment_method_details.type) || '';
          mandate = (ch.payment_method_details && ch.payment_method_details.twint && ch.payment_method_details.twint.mandate) || '';
        }
      } catch (_) {}
      telegram([
        `✅ <b>PAID</b> – order <b>${esc(md.order_id)}</b>`,
        `💰 <b>${chf(pi.amount_received / 100)}</b>${method ? ' via ' + esc(method) : ''}`,
        linesText(linesFromMeta(md.items, lang)),
        `Subtotal ${chf(Number(md.subtotal || 0))} · Shipping ${chf(Number(md.shipping || 0))}`,
        customerText(metaCustomer(md)),
        pi.customer && `🆔 Customer: <code>${esc(pi.customer)}</code>`,
        md.save_mandate === 'yes' ? `🔐 TWINT saved for future charges${mandate ? ': <code>' + esc(mandate) + '</code>' : ''}` : md.save_mandate === 'already' ? '🔐 Existing TWINT mandate used' : '',
        `🧾 Stripe: <code>${esc(pi.id)}</code>`,
      ].filter(Boolean).join('\n\n'));
    } else if (event.type === 'payment_intent.payment_failed') {
      const why = (pi.last_payment_error && pi.last_payment_error.message) || '';
      telegram(`❌ <b>Payment failed</b> – order ${esc(md.order_id)} · ${chf(pi.amount / 100)}${why ? '\n' + esc(why) : ''}`);
    }
  } catch (e) { console.error('Webhook handling error', e); }
});

// ---------------- CORS + body parsing for everything else ----------------
const origins = ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({ origin: (o, cb) => cb(null, !o || !origins.length || origins.includes(o)), methods: ['POST', 'GET'] }));
app.use('/api/track', express.text({ type: '*/*', limit: '20kb' }));
app.use(express.json({ limit: '50kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, stripe: !!stripe, telegram: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) }));

// ---------------- visitor tracking ----------------
const EVENT_TITLE = {
  page_view: '👀 Page view', view_product: '🔎 Product view', add_to_cart: '🛒 Add to cart', remove_from_cart: '🗑 Removed from cart',
  change_qty: '🔢 Quantity changed', search: '🔍 Search', switch_language: '🌍 Language switch', view_cart: '🧺 Viewing cart',
  begin_checkout: '🧾 Checkout opened', payment_canceled: '↩️ Payment canceled / failed', thank_you: '🎉 Thank-you page',
};
app.post('/api/track', (req, res) => {
  res.status(204).end();
  const ip = ipOf(req);
  if (BOT_UA.test(req.headers['user-agent'] || '') || limited(ip)) return;
  let b; try { b = JSON.parse(req.body || '{}'); } catch (_) { return; }
  const ev = String(b.event || '');
  if (!EVENT_TITLE[ev] || !wants(ev)) return;
  const d = b.data || {};
  const lines = [`<b>${EVENT_TITLE[ev]}</b>`];
  if (b.title) lines.push(`📄 ${esc(clip(b.title, 120))}`);
  if (b.path) lines.push(`🔗 ${esc(SITE_URL + clip(b.path, 300))}`);
  if (d.name) lines.push(`📦 ${esc(clip(d.name, 120))}${d.id ? ' (#' + esc(clip(d.id, 10)) + ')' : ''}${d.price ? ' · ' + chf(d.price) : ''}${d.qty ? ' · qty ' + esc(d.qty) : ''}`);
  if (d.q) lines.push(`🔍 "${esc(clip(d.q, 80))}"`);
  if (d.to) lines.push(`➡️ ${esc(clip(d.to, 5)).toUpperCase()}`);
  if (Array.isArray(d.items) && d.items.length) lines.push(d.items.slice(0, 20).map(i => `• ${esc(i.qty)} × ${esc(clip(i.name, 80))}`).join('\n'));
  if (d.cart_total !== undefined) lines.push(`🛒 Cart: ${chf(d.cart_total)} (${esc(d.cart_count)} items)`);
  if (b.ref && !String(b.ref).startsWith(SITE_URL)) lines.push(`↪️ From: ${esc(clip(b.ref, 200))}`);
  lines.push(visitorText(req, b));
  telegram(lines.join('\n'));
});

// ---------------- Stripe customers + admin access ----------------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
async function findOrCreateCustomer(c, cc) {
  const found = await stripe.customers.list({ email: c.email, limit: 1 });
  if (found.data.length) return found.data[0];
  return stripe.customers.create({
    name: c.name, email: c.email, phone: c.phone || undefined,
    address: { line1: c.street, postal_code: c.zip, city: c.city, country: cc },
  });
}
function requireAdmin(req, res, next) {
  const given = String(req.get('x-admin-token') || '');
  const ok = ADMIN_TOKEN && given.length === ADMIN_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_TOKEN));
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ---------------- Inline payment: PaymentIntent with TWINT + card (shown on the checkout page) ----------------
app.post('/api/payment-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet.' });
    const pk = String(req.body.pk_mode || '');
    const skMode = STRIPE_SECRET_KEY.startsWith('sk_live') || STRIPE_SECRET_KEY.startsWith('rk_live') ? 'live' : 'test';
    if (pk && pk !== skMode) return res.status(400).json({ error: `Key mismatch: publishable key is ${pk}, secret key is ${skMode}.` });
    if (limited(ipOf(req) + ':pi', 20)) return res.status(429).json({ error: 'Too many attempts, please wait a moment.' });

    const lang = LANGS.includes(req.body.lang) ? req.body.lang : 'de';
    const cart = priceCart(req.body.items, lang);
    const c = cleanCustomer(req.body.customer);
    if (!c.email || !c.name) return res.status(400).json({ error: 'Missing name or e-mail.' });
    if (!cart.onlyDigital && (!c.street || !c.zip || !c.city)) return res.status(400).json({ error: 'Missing address details.' });
    if (cart.digital && req.body.customer?.consent !== true) return res.status(400).json({ error: 'Please confirm immediate delivery of the PDF.' });
    const oid = orderId();
    const cc = /liechtenstein/i.test(c.country) ? 'LI' : 'CH';
    const r = catalog.routes[lang];

    const customer = await findOrCreateCustomer(c, cc);
    // PDF-only orders: plain one-time payment, nothing is saved for later charges
    const hasMandate = cart.onlyDigital ? true : (await stripe.paymentMethods.list({ customer: customer.id, type: 'twint', limit: 1 })).data.length > 0;

    const pi = await stripe.paymentIntents.create({
      amount: Math.round(cart.total * 100),
      currency: catalog.currency.toLowerCase(),
      customer: customer.id,
      // first order of a customer: save the TWINT mandate for future charges; TWINT allows only one active mandate
      payment_method_options: hasMandate ? undefined : { twint: { setup_future_usage: 'off_session' } },
      receipt_email: c.email,
      description: `VoltRide order ${oid}`,
      payment_method_types: cart.onlyDigital ? ['twint', 'card'] : ['twint'],
      shipping: cart.onlyDigital ? undefined : {
        name: c.name, phone: c.phone || undefined,
        address: { line1: c.street, postal_code: c.zip, city: c.city, country: cc },
      },
      metadata: {
        order_id: oid, lang,
        items: cart.lines.map(l => `${l.id}x${l.qty}`).join(','),
        subtotal: cart.subtotal.toFixed(2), shipping: cart.shipping.toFixed(2),
        name: c.name, email: c.email, phone: c.phone, street: c.street, zip: c.zip,
        city: c.city, country: c.country, note: c.note.slice(0, 450), visitor: clip(req.body.vid, 20),
        save_mandate: cart.onlyDigital ? 'no' : hasMandate ? 'already' : 'yes',
        digital: cart.digital ? 'yes' : 'no', consent: cart.digital ? 'immediate delivery requested, withdrawal right waived' : '',
      },
    }, { idempotencyKey: oid });

    if (wants('checkout_info')) telegram([
      `📝 <b>Checkout info – payment started</b> · order <b>${oid}</b>`,
      linesText(cart.lines),
      `Subtotal ${chf(cart.subtotal)} · Shipping ${chf(cart.shipping)} · <b>Total ${chf(cart.total)}</b>`,
      customerText(c), cart.onlyDigital ? '💳 Payment: TWINT or card · 📄 PDF order (no shipping)' : `💳 Payment: TWINT (on checkout page)`,
      cart.onlyDigital ? '' : hasMandate ? '🔐 TWINT already saved for this customer' : '🔐 TWINT will be saved for future charges', visitorText(req, req.body),
    ].join('\n\n'));

    res.json({
      clientSecret: pi.client_secret,
      orderId: oid,
      // Stripe sends the shopper back here after TWINT / 3-D Secure; the checkout page then decides where to go
      returnUrl: `${SITE_URL}/${lang}/${r.checkout}.html?order=${oid}`,
      thanksUrl: `${SITE_URL}/${lang}/${r.thanks}.html?order=${oid}`,
    });
  } catch (e) {
    console.error('payment-intent error', e.message);
    res.status(400).json({ error: e.message || 'Payment could not be started' });
  }
});

// ---------------- Admin: saved TWINT customers and manual charges ----------------
app.get('/customers', requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const out = [];
    for await (const cu of stripe.customers.list({ limit: 100 })) {
      const pms = await stripe.paymentMethods.list({ customer: cu.id, type: 'twint', limit: 1 });
      if (pms.data.length) out.push({ customerId: cu.id, email: cu.email, name: cu.name, paymentMethodId: pms.data[0].id });
    }
    res.json({ total: out.length, customers: out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/charge-saved', requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const { customerId, amount, description } = req.body;
    if (!customerId) return res.status(400).json({ error: 'customerId required' });
    const amt = Math.round(Number(amount) * 100) || Math.round(Number(req.body.amount_rappen));
    if (!(amt >= 50 && amt <= 100000)) return res.status(400).json({ error: 'amount must be between 0.50 and 1000 CHF (send amount in CHF, e.g. 19.90)' });
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'twint', limit: 1 });
    if (!pms.data.length) return res.status(404).json({ error: 'No saved TWINT payment method for this customer' });
    const pi = await stripe.paymentIntents.create({
      amount: amt, currency: 'chf', customer: customerId, payment_method: pms.data[0].id,
      payment_method_types: ['twint'], off_session: true, confirm: true,
      description: clip(description || 'VoltRide – Folgebestellung', 200),
    });
    telegram(`💰 <b>Manual charge</b> · ${chf(amt / 100)} · status ${esc(pi.status)}\n🆔 <code>${esc(customerId)}</code>`);
    res.json({ paymentIntentId: pi.id, status: pi.status });
  } catch (e) {
    console.error('charge-saved error', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ---------------- product reviews (customers write → you approve in Telegram → shown on the product page) ----------------
const fs = require('fs');
const path = require('path');
const REVIEWS_FILE = process.env.REVIEWS_FILE || (fs.existsSync('/data') ? '/data/reviews.json' : path.join(__dirname, 'reviews.json'));
let reviews = [];
try { reviews = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8')); } catch (_) { reviews = []; }
function saveReviews() {
  try { fs.writeFileSync(REVIEWS_FILE + '.tmp', JSON.stringify(reviews, null, 1)); fs.renameSync(REVIEWS_FILE + '.tmp', REVIEWS_FILE); }
  catch (e) { console.error('Saving reviews failed', e.message); }
}
const reviewSig = (id, action) => crypto.createHmac('sha256', ADMIN_TOKEN || STRIPE_SECRET_KEY || 'reviews').update(id + ':' + action).digest('hex').slice(0, 32);
const publicReview = r => ({ id: r.id, product: r.product, name: r.name, rating: r.rating, title: r.title, text: r.text, date: r.date, lang: r.lang });
const STARS = n => '★'.repeat(n) + '☆'.repeat(5 - n);

// approved reviews for one product (or all)
app.get('/api/reviews', (req, res) => {
  const pid = String(req.query.product || '');
  res.set('Cache-Control', 'public, max-age=60');
  res.json(reviews.filter(r => r.status === 'approved' && (!pid || r.product === pid)).map(publicReview));
});

// new review from the product page – stored as "pending" until you approve it
app.post('/api/reviews', (req, res) => {
  const ip = ipOf(req);
  if (limited('review:' + ip, 5, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many reviews, please try again later.' });
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // spam trap field – humans leave it empty
  const product = clip(b.product, 10), rating = Math.round(Number(b.rating));
  const name = clip(b.name, 40), title = clip(b.title, 100), text = clip(b.text, 2000), email = clip(b.email, 120);
  const p = catalog.products[product];
  if (!p || !(rating >= 1 && rating <= 5) || name.length < 2 || text.length < 10) return res.status(400).json({ error: 'Please fill in all required fields.' });
  const r = { id: crypto.randomBytes(6).toString('hex'), product, rating, name, title, text, email,
              lang: LANGS.includes(b.lang) ? b.lang : 'de', date: new Date().toISOString().slice(0, 10), status: 'pending', ip };
  reviews.push(r); saveReviews();
  const self = `${req.protocol}://${req.get('host')}/api/reviews/${r.id}`;
  telegram([
    `⭐ <b>New review – please check</b>`,
    `📦 ${esc(p.name?.de || product)} (#${esc(product)})`,
    `${STARS(rating)} · ${esc(name)}${email ? ' · ' + esc(email) : ''}`,
    title ? `<b>${esc(title)}</b>` : '',
    esc(text),
    ``,
    `✅ Approve: ${self}/approve?sig=${reviewSig(r.id, 'approve')}`,
    `❌ Reject: ${self}/reject?sig=${reviewSig(r.id, 'reject')}`,
  ].filter(x => x !== '').join('\n'));
  res.json({ ok: true });
});

// approve / reject links from the Telegram message
app.get('/api/reviews/:id/:action(approve|reject)', (req, res) => {
  const { id, action } = req.params, given = String(req.query.sig || ''), want = reviewSig(id, action);
  const okSig = given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
  const r = reviews.find(x => x.id === id);
  if (!okSig || !r) return res.status(403).send('Link invalid or expired.');
  r.status = action === 'approve' ? 'approved' : 'rejected'; saveReviews();
  res.send(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:40px;text-align:center">
    <h2>${action === 'approve' ? '✅ Review approved – it is now visible on the product page.' : '❌ Review rejected – it will not be shown.'}</h2>
    <p>${esc(STARS(r.rating))} · ${esc(r.name)}</p><p>${esc(r.text)}</p></body>`);
});

// ---------------- PDF patterns: signed download links + e-mail after payment ----------------
const FILES_DIR = path.resolve(process.env.FILES_DIR || path.join(__dirname, 'files'));
const DL_SECRET = process.env.DOWNLOAD_SECRET || '';
const LINK_DAYS = 30;
const SENT_FILE = path.join(fs.existsSync('/data') ? '/data' : __dirname, 'pdf-sent.json');
let pdfSent = {};
try { pdfSent = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')); } catch (_) { pdfSent = {}; }
const dlSign = (...p) => crypto.createHmac('sha256', DL_SECRET).update(p.join('|')).digest('hex').slice(0, 40);
let API_SELF = (process.env.API_URL || '').replace(/\/$/, '');
function pdfFiles(pid) {
  const dir = path.join(FILES_DIR, pid);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(pdf|zip)$/i.test(f)).sort() : [];
}
function downloadLinks(pi) {
  const md = pi.metadata || {}, lang = LANGS.includes(md.lang) ? md.lang : 'fr';
  const exp = String(pi.created + LINK_DAYS * 86400), out = [];
  for (const l of linesFromMeta(md.items, lang)) {
    const p = catalog.products[l.id];
    if (!p || !p.digital) continue;
    const files = pdfFiles(l.id);
    if (!files.length) console.warn(`! No PDF in ${path.join(FILES_DIR, l.id)}`);
    files.forEach(f => out.push({
      label: files.length > 1 ? `${p.name[lang] || p.name.fr} – ${f.replace(/\.(pdf|zip)$/i, '')}` : (p.name[lang] || p.name.fr),
      url: `${API_SELF}/api/download/${encodeURIComponent(pi.id)}/${encodeURIComponent(l.id)}/${encodeURIComponent(f)}?exp=${exp}&sig=${dlSign(pi.id, l.id, f, exp)}`,
    }));
  }
  return out;
}
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const port = Number(process.env.SMTP_PORT || 465);
  mailer = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}
const MAIL_TXT = {
  fr: { subj: 'Tes patrons sont prêts 🧶', hi: 'Bonjour', thanks: 'Merci pour ta commande ! Voici tes patrons :', dl: 'Télécharger le PDF',
        note: `Les liens restent valables ${LINK_DAYS} jours – enregistre tes PDF sur ton appareil. Tu as demandé la livraison immédiate de ce contenu numérique et reconnu perdre ton droit de rétractation dès le début du téléchargement.`, bye: 'Bon crochet !' },
  de: { subj: 'Deine Häkelanleitungen sind bereit 🧶', hi: 'Hallo', thanks: 'Danke für deine Bestellung! Hier sind deine Anleitungen:', dl: 'PDF herunterladen',
        note: `Die Links sind ${LINK_DAYS} Tage gültig – speichere die PDFs auf deinem Gerät. Du hast die sofortige Lieferung der digitalen Inhalte verlangt und zur Kenntnis genommen, dass dein Widerrufsrecht mit Beginn des Downloads erlischt.`, bye: 'Viel Spass beim Häkeln!' },
  en: { subj: 'Your crochet patterns are ready 🧶', hi: 'Hello', thanks: 'Thank you for your order! Here are your patterns:', dl: 'Download PDF',
        note: `The links stay valid for ${LINK_DAYS} days – save the PDFs on your device. You requested immediate delivery of this digital content and acknowledged losing your right of withdrawal once the download begins.`, bye: 'Happy crocheting!' },
};
async function deliverDigital(pi) {
  if (pi.status !== 'succeeded' || pdfSent[pi.id]) return;
  const md = pi.metadata || {}, lang = LANGS.includes(md.lang) ? md.lang : 'fr', t = MAIL_TXT[lang];
  const links = downloadLinks(pi);
  if (mailer && md.email && links.length) {
    await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER, to: md.email, subject: t.subj,
      text: `${t.hi} ${md.name || ''},\n\n${t.thanks}\n\n` + links.map(f => `${f.label}\n${f.url}`).join('\n\n') + `\n\n${t.note}\n\n${t.bye}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#16171b"><p>${t.hi} ${esc(md.name || '')},</p><p>${t.thanks}</p><ul style="padding-left:18px">` +
        links.map(f => `<li style="margin:0 0 10px"><b>${esc(f.label)}</b><br><a href="${f.url}" style="color:#16863c">${t.dl}</a></li>`).join('') +
        `</ul><p style="color:#5d6170;font-size:13px">${t.note}</p><p>${t.bye}</p></div>`,
    });
  }
  pdfSent[pi.id] = new Date().toISOString();
  try { fs.writeFileSync(SENT_FILE, JSON.stringify(pdfSent)); } catch (e) { console.error('pdf-sent.json', e.message); }
  telegram(`📄 <b>PDF delivered</b> – order ${esc(md.order_id)}\n${esc(md.email)}\n${links.map(f => '• ' + esc(f.label)).join('\n')}` +
    (mailer ? '' : '\n⚠️ SMTP not set – no e-mail sent, links shown on the thank-you page only') + (links.length ? '' : '\n⚠️ No PDF files found on the server'));
}
// thank-you page: the browser has the PaymentIntent client secret from Stripe's redirect
app.get('/api/downloads', async (req, res) => {
  if (!stripe || !DL_SECRET) return res.status(503).json({ files: [] });
  if (!API_SELF) API_SELF = `${req.protocol}://${req.get('host')}`;
  const cs = String(req.query.cs || ''), id = cs.split('_secret_')[0];
  if (!/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(cs)) return res.status(400).json({ files: [] });
  try {
    const pi = await stripe.paymentIntents.retrieve(id);
    if (pi.client_secret !== cs || (pi.metadata || {}).digital !== 'yes') return res.status(404).json({ files: [] });
    if (pi.status === 'processing') return res.json({ status: 'processing', files: [] });
    if (pi.status !== 'succeeded') return res.json({ status: pi.status, files: [] });
    deliverDigital(pi).catch(e => console.error('PDF delivery failed', e.message)); // in case the webhook is slower
    res.json({ status: 'succeeded', files: downloadLinks(pi) });
  } catch (e) { res.status(404).json({ files: [] }); }
});
app.get('/api/download/:pi/:pid/:file', (req, res) => {
  const { pi, pid, file } = req.params, exp = String(req.query.exp || ''), sig = String(req.query.sig || ''), want = DL_SECRET ? dlSign(pi, pid, file, exp) : '';
  if (!want || !/^\d+$/.test(exp) || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(403).send('Invalid link.');
  if (Date.now() / 1000 > Number(exp)) return res.status(410).send('This link has expired – please write to us and we will send a new one.');
  const p = path.resolve(FILES_DIR, pid, file);
  if (!p.startsWith(FILES_DIR + path.sep) || !fs.existsSync(p)) return res.status(404).send('File not found – please write to us.');
  res.download(p, file);
});

app.listen(PORT, () => console.log(`VoltRide API on :${PORT} · stripe=${!!stripe} · telegram=${!!TELEGRAM_BOT_TOKEN} · site=${SITE_URL}`));
