const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = isProduction 
  ? 'https://klioai.com'
  : (process.env.FRONTEND_URL || 'http://localhost:3000');

// Imports
const authRoutes = require('./routes/authRoutes');
const childRoutes = require('./routes/childRoutes');
const parentalControlRoutes = require('./routes/parentalControlRoutes');
const chatRoutes = require('./routes/chatRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const ChatModel = require('./models/chatModel');
const scheduleCleanup = require('./utils/cleanupScheduler');
const User = require('./models/userModel');
const { verifyToken } = require('./middleware/authMiddleware');
const { checkSubscription } = require('./middleware/subscriptionMiddleware');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();

// Stripe webhook (raw body parsing)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('⭐ Webhook received:', new Date().toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('✅ Webhook signature verified');
    console.log('Event Type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', {
      error: err.message,
      signature: sig ? 'Present' : 'Missing',
      bodyLength: req.body?.length
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        console.log('📦 Processing checkout.session.completed');
        const session = event.data.object;
        console.log('Session details:', {
          id: session.id,
          customer: session.customer,
          subscription: session.subscription,
          metadata: session.metadata,
          mode: session.mode,
          payment_status: session.payment_status
        });
        
        // Verify session has required metadata
        if (!session.metadata?.email || !session.customer) {
          console.warn('⚠️ Missing required metadata:', {
            email: session.metadata?.email,
            customer: session.customer,
            allMetadata: session.metadata
          });
          return res.json({ received: true });
        }

        if (!session.subscription) {
          console.warn('⚠️ No subscription in completed checkout session');
          return res.json({ received: true });
        }

        console.log('🔍 Retrieving subscription details');
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        console.log('Subscription details:', {
          id: subscription.id,
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000),
          trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          items: subscription.items.data.map(item => ({
            price_id: item.price.id,
            quantity: item.quantity
          }))
        });

        const priceId = subscription.items.data[0].price.id;
        console.log('Price ID from subscription:', priceId);
        
        const planMap = {
          'price_1QVLU5DII9A9349o7xJSR3OZ': 'single',
          'price_1QVLUbDII9A9349oEK9fzVp1': 'familypro'
        };

        const planType = planMap[priceId];
        if (!planType) {
          console.error('❌ Unknown price ID:', {
            received: priceId,
            validPriceIds: Object.keys(planMap)
          });
          return res.status(400).json({ error: 'Invalid price ID' });
        }

        console.log('✅ Plan type identified:', planType);

        const userData = {
          email: session.metadata.email,
          name: session.metadata.name,
          picture: null,
          plan: planType,
          google_id: session.metadata.google_id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: subscription.status,
          subscription_end_date: subscription.trial_end ? 
            new Date(subscription.trial_end * 1000).toISOString() : 
            null
        };
        
        console.log('👤 Updating user data:', {
          email: userData.email,
          plan: userData.plan,
          status: userData.subscription_status
        });

        const updatedUser = await User.handleStripeWebhook(userData);
        console.log('✅ User update complete:', {
          userId: updatedUser.id,
          plan: updatedUser.plan_type,
          status: updatedUser.subscription_status
        });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.trial_will_end': {
        console.log(`📦 Processing ${event.type}`);
        const subscription = event.data.object;
        console.log('Subscription update details:', {
          id: subscription.id,
          status: subscription.status,
          customer: subscription.customer
        });
        const updatedUser = await User.handleSubscriptionUpdate(subscription);
        console.log('✅ Subscription update complete:', {
          userId: updatedUser.id,
          newStatus: updatedUser.subscription_status
        });
        break;
      }

      case 'customer.subscription.deleted': {
        console.log('📦 Processing subscription deletion');
        const subscription = event.data.object;
        console.log('Deletion details:', {
          id: subscription.id,
          customer: subscription.customer,
          cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null
        });
        const updatedUser = await User.handleSubscriptionUpdate({
          ...subscription,
          status: 'canceled'
        });
        console.log('✅ Subscription deletion handled:', {
          userId: updatedUser.id,
          newStatus: 'canceled'
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        console.log('📦 Processing successful payment');
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          console.log('Payment success details:', {
            subscriptionId: subscription.id,
            amount: invoice.amount_paid,
            status: subscription.status
          });
          const updatedUser = await User.handleSubscriptionUpdate(subscription);
          console.log('✅ Payment success handled:', {
            userId: updatedUser.id,
            status: updatedUser.subscription_status
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        console.log('📦 Processing payment failure');
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          console.log('Payment failure details:', {
            subscriptionId: subscription.id,
            attempt: invoice.attempt_count,
            nextAttempt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null
          });
          const updatedUser = await User.handleSubscriptionUpdate({
            ...subscription,
            status: 'past_due'
          });
          console.log('✅ Payment failure handled:', {
            userId: updatedUser.id,
            newStatus: 'past_due'
          });
        }
        break;
      }

      default:
        console.log(`⚠️ Unhandled event type: ${event.type}`);
    }

    console.log('✅ Webhook processing complete');
    return res.json({ received: true });
  } catch (err) {
    console.error('❌ Error processing webhook:', {
      error: err.message,
      stack: err.stack,
      eventType: event.type
    });
    return res.status(500).json({ 
      error: 'Failed to process webhook', 
      details: err.message 
    });
  }
});
// CORS
app.use(cors({
  origin: [
    'https://klioai.com',
    'https://www.klioai.com',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/stripe', stripeRoutes);

// Protected routes
app.use('/api/children', verifyToken, checkSubscription, childRoutes);
app.use('/api/parental-controls', verifyToken, checkSubscription, parentalControlRoutes);
app.use('/api/chat', verifyToken, checkSubscription, chatRoutes);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Frontend routes
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: isProduction ? undefined : err.message
  });
});

// Server startup
async function startServer() {
  try {
    console.log(`Starting server in ${process.env.NODE_ENV} mode...`);
    console.log(`Frontend URL: ${FRONTEND_URL}`);

    await Promise.all([
      ChatModel.initializeDatabase(),
      scheduleCleanup()
    ]);

    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
