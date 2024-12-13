const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/userModel');
const PLANS = {
    single: {
        priceId: 'price_1QVLU5DII9A9349o7xJSR3OZ',
        name: 'Single Account Plan'
    },
    familypro: {
        priceId: 'price_1QVLUbDII9A9349oEK9fzVp1',
        name: 'Family Pro Account Plan'
    }
};
router.post('/create-checkout-session', async (req, res) => {
    try {
      const { plan, googleData } = req.body;
      
      if (!PLANS[plan]) {
        return res.status(400).json({ error: 'Invalid plan selected' });
      }
  
      // First check if user exists in our database
      const user = await User.findByEmail(googleData.email);
      let customer;
  
      if (user?.stripe_customer_id) {
        // If user exists and has stripe ID, use that
        customer = { id: user.stripe_customer_id };
      } else {
        // Otherwise check Stripe or create new customer
        const existingCustomers = await stripe.customers.list({
          email: googleData.email,
          limit: 1
        });
  
        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
        } else {
          customer = await stripe.customers.create({
            email: googleData.email,
            metadata: {
              google_id: googleData.googleId
            }
          });
        }
      }
  
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        payment_method_types: ['card'],
        line_items: [{
          price: PLANS[plan].priceId,
          quantity: 1
        }],
        mode: 'subscription',
        metadata: {
          google_id: googleData.googleId,
          email: googleData.email,
          name: googleData.name,
          plan: plan
        },
        success_url: `${process.env.FRONTEND_URL}/signup.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/signup.html`
      });
  
      res.json({ sessionId: session.id });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ error: error.message });
    }
  });
router.get('/get-session', async (req, res) => {
  try {
      const { sessionId } = req.query;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      res.json({
          customerId: session.customer,
          subscriptionId: session.subscription
      });
  } catch (error) {
      console.error('Error retrieving session:', error);
      res.status(500).json({ error: error.message });
  }
});
router.post('/create-upgrade-session', async (req, res) => {
    try {
        const { customerId, currentPlan } = req.body;
        
        // First verify the customer exists
        const customer = await stripe.customers.retrieve(customerId);
        
        if (!customer) {
            return res.status(400).json({ error: 'Invalid customer ID' });
        }

        // Create new subscription checkout with existing customer
        const session = await stripe.checkout.sessions.create({
            customer: customerId, // Use existing customer ID
            payment_method_types: ['card'],
            mode: 'subscription',
            metadata: {
                previous_plan: currentPlan,
                plan: 'familypro',
                upgrade: 'true',
                email: customer.email, // Add this
                customer_id: customerId // Add this
            },
            line_items: [{
                price: PLANS.familypro.priceId,
                quantity: 1
            }],
            subscription_data: {
                metadata: {
                    plan: 'familypro'
                }
            },
            allow_promotion_codes: true,
            // Customer will be redirected to this URL after successful payment
            success_url: `${process.env.FRONTEND_URL}/dashboard.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/dashboard.html`
        });

        res.json({ sessionId: session.id });
    } catch (error) {
        console.error('Error creating upgrade session:', error);
        res.status(500).json({ error: error.message });
    }
});
router.post('/create-portal-session', async (req, res) => {
  try {
      const { customerId } = req.body;
      
      // Create a billing portal session
      const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${process.env.FRONTEND_URL}/dashboard`,
      });

      res.json({ url: session.url });
  } catch (error) {
      console.error('Error creating portal session:', error);
      res.status(500).json({ error: error.message });
  }
});
module.exports = router;