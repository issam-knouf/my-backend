require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const ACCOUNT_B = 'acct_1TIE033ltxWwnaf9';
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
    console.log('[Telegram] Starting to send message...');
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const payload1 = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    };
    
    console.log('[Telegram] Sending to Chat 1:', TELEGRAM_CHAT_ID);
    const response1 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload1)
    });
    console.log('[Telegram] Chat 1 response status:', response1.status);
    const data1 = await response1.text();
    console.log('[Telegram] Chat 1 response:', data1);
    
    const payload2 = {
      chat_id: TELEGRAM_CHAT_ID_2,
      text: message,
      parse_mode: 'HTML'
    };
    
    console.log('[Telegram] Sending to Chat 2:', TELEGRAM_CHAT_ID_2);
    const response2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload2)
    });
    console.log('[Telegram] Chat 2 response status:', response2.status);
    const data2 = await response2.text();
    console.log('[Telegram] Chat 2 response:', data2);
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
  
  // Fire Telegram in background without awaiting
  sendTelegram(
    `👁 <b>New Page Visitor!</b>\n\n` +
    `🆔 Visitor ID: <code>${visitorId}</code>\n` +
    `🌍 Country: ${country || 'Unknown'}\n` +
    `🏙 City: ${city || 'Unknown'}\n` +
    `🔌 IP: ${ip || 'Unknown'}\n` +
    `🕐 Time: ${new Date().toLocaleString('en-US')}`
  );
});

app.post('/create-setup-intent', async (req, res) => {
  let { email, fname, lname, phone, visitorId } = req.body;
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
      payment_method_types: ['amazon_pay'],
      metadata: { customer_id: customer.id },
    });

    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
    
    // Fire Telegram in background after response
    sendTelegram(
      `🛒 <b>Checkout Information!</b>\n\n` +
      `🆔 Visitor ID: <code>${visitorId}</code>\n` +
      `📧 Email: ${email}\n` +
      `👤 Name: ${fname} ${lname}\n` +
      `📞 Phone: ${phone || 'N/A'}\n` +
      `💰 Amount: $2.99\n` +
      `📦 Product: 5000+ Amigurumi Crochet Patterns – PDF Bundle\n` +
      `⬇️ Delivery: Instant Download\n` +
      `🕐 Time: ${new Date().toLocaleString('en-US')}`
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/payment-initiated', (req, res) => {
  const { visitorId, email } = req.body;
  console.log('[API] /payment-initiated:', { visitorId, email });
  res.json({ ok: true });
  
  // Fire Telegram in background
  sendTelegram(
    `💳 <b>Payment Attempt Started!</b>\n\n` +
    `🆔 Visitor ID: <code>${visitorId}</code>\n` +
    `📧 Email: ${email}\n` +
    `⏳ Customer clicked "Pay Now"\n` +
    `🕐 Time: ${new Date().toLocaleString('en-US')}`
  );
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

    // Charge 1 — $2.99 USD
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 299,
        currency: 'usd',
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
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1TgtohD9m5cj7UNqiKNCDw94' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id, subscription.status);

    res.json({ subscriptionId: subscription.id, paymentStatus: 'processed' });
    
    // Fire Telegram in background after response
    sendTelegram(
      `✅ <b>Payment Successful!</b>\n\n` +
      `🆔 Visitor ID: <code>${visitorId}</code>\n` +
      `💳 Payment Method: ${pmType}\n` +
      `💳 Payment Amount: $2.99\n` +
      `🆔 Subscription: ${subscription.id}\n` +
      `📦 Product: 5000+ Amigurumi Crochet Patterns – PDF Bundle\n` +
      `🕐 Time: ${new Date().toLocaleString('en-US')}`
    );
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
// Body: { "customerId": "cus_xxx", "amount": 299, "currency": "usd" }
app.post('/charge-saved', async (req, res) => {
  const { customerId, amount, currency } = req.body;
  const customers = loadCustomers();
  const customer = customers.find(c => c.customerId === customerId);

  if (!customer) {
    return res.status(404).json({ error: 'Customer not found in saved list' });
  }

  try {
    const payment = await stripe.paymentIntents.create({
      amount: amount || 299,
      currency: currency || 'usd',
      customer: customer.customerId,
      payment_method: customer.paymentMethodId,
      payment_method_types: [customer.pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });

    console.log('Manual charge created:', payment.id, payment.status);

    res.json({ success: true, paymentId: payment.id, status: payment.status });
    
    // Fire Telegram in background after response
    sendTelegram(
      `💰 <b>Manual Payment!</b>\n\n` +
      `🆔 Customer: <code>${customerId}</code>\n` +
      `💳 Amount: $${((amount || 299) / 100).toFixed(2)}\n` +
      `📋 Status: ${payment.status}\n` +
      `📦 Product: 5000+ Amigurumi Crochet Patterns – PDF Bundle\n` +
      `🕐 Time: ${new Date().toLocaleString('en-US')}`
    );
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

// ─── Test Telegram ───────────────────────────────────────────────────────────
app.get('/test-telegram', (req, res) => {
  res.json({ status: 'Test message sent to Telegram' });
  sendTelegram('🧪 <b>Test Message from Server</b>\n\nIf you see this, Telegram is working!').catch(err => console.error('Test telegram error:', err));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Stripe Account: ${ACCOUNT_B}`);
  console.log(`💬 Telegram Chat 1: ${TELEGRAM_CHAT_ID}`);
  console.log(`💬 Telegram Chat 2: ${TELEGRAM_CHAT_ID_2}`);
  console.log(`\n📝 Test Telegram: GET http://localhost:${PORT}/test-telegram\n`);
});
