const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables first
dotenv.config();

// Environment-specific configuration
const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = isProduction 
  ? 'https://klioai.com'
  : (process.env.FRONTEND_URL || 'http://localhost:3000');

// Route imports
const authRoutes = require('./routes/authRoutes');
const childRoutes = require('./routes/childRoutes');
const parentalControlRoutes = require('./routes/parentalControlRoutes');
const chatRoutes = require('./routes/chatRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const ChatModel = require('./models/chatModel');
const scheduleCleanup = require('./utils/cleanupScheduler');
const User = require('./models/userModel');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Middleware imports
const { verifyToken } = require('./middleware/authMiddleware');
const { checkSubscription } = require('./middleware/subscriptionMiddleware');

const app = express();

// Webhook should be before CORS middleware
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log('Webhook event received:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0].price.id;
        const planMap = {
          'price_1QP9N4DII9A9349ohlOJgJEE': 'single',
          'price_1QP9NLDII9A9349oDRxFpdWx': 'familypro'
        };
        const planType = planMap[priceId];

        const userData = {
          email: session.metadata.email,
          name: session.metadata.name,
          picture: null,
          plan: planType,
          google_id: session.metadata.google_id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription
        };

        const user = await User.handleStripeWebhook(userData);
        console.log('Updated user:', user);
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object;
        await User.handleSubscriptionUpdate(updatedSubscription);
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// CORS configuration


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

// Static file serving
app.use(express.static(path.join(__dirname, '../public')));

// Route handlers
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
    console.log("Database and cleanup routines initialized.");

    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log('Session tracking and parental controls active');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;