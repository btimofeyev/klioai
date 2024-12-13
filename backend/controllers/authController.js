const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/userModel');
const Child = require('../models/childModel');
const ParentalControl = require('../models/parentalControlModel');
const pool = require('../config/db');
require('dotenv').config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const authController = {
  googleAuth: async (req, res) => {
    try {
      const { token, plan = 'basic' } = req.body;
      
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      
      const { email, name, picture, sub: googleId } = ticket.getPayload();
      let user = await User.findByEmail(email);
      
      if (!user) {
        const customer = await stripe.customers.create({
          email,
          name,
          metadata: { google_id: googleId }
        });

        user = await User.create({
          email,
          name,
          picture,
          plan: plan || 'basic',
          google_id: googleId,
          stripe_customer_id: customer.id,
          subscription_status: 'active',
          role: 'parent'
        });
      } else if (!user.stripe_customer_id) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: { google_id: user.google_id }
        });

        user = await User.updateStripeInfo(user.id, {
          customerId: customer.id,
          status: 'active'
        });
      }
  
      const jwtToken = jwt.sign(
        { userId: user.id, email: user.email, role: 'parent' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
  
      res.json({
        success: true,
        token: jwtToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'parent',
          plan_type: user.plan_type,
          subscription_status: user.subscription_status,
          subscription_end_date: user.subscription_end_date,
          stripe_customer_id: user.stripe_customer_id
        }
      });
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(400).json({ success: false, error: 'Authentication failed' });
    }
  },

  login: async (req, res) => {
    try {
      const { token, role } = req.body;
      
      if (role !== 'parent') {
        return res.status(400).json({
          success: false,
          error: 'Invalid role for Google authentication'
        });
      }

      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      
      const { email } = ticket.getPayload();
      const user = await User.findByEmail(email);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found. Please sign up first.'
        });
      }

      const jwtToken = jwt.sign(
        { userId: user.id, email: user.email, role: 'parent' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        token: jwtToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'parent',
          plan_type: user.plan_type,
          subscription_status: user.subscription_status,
          subscription_end_date: user.subscription_end_date,
          stripe_customer_id: user.stripe_customer_id
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(400).json({ success: false, error: 'Login failed' });
    }
  },

  childLogin: async (req, res) => {
    const clientConn = await pool.connect();
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      await clientConn.query('BEGIN');
      
      const query = `
        SELECT c.*, u.id as parent_id, u.email as parent_email,
               pc.message_limit,
               pc.allowed_start_time, pc.allowed_end_time
        FROM children c
        JOIN users u ON c.parent_id = u.id
        LEFT JOIN parental_controls pc ON c.id = pc.child_id
        WHERE c.username = $1
      `;
      
      const { rows } = await clientConn.query(query, [username]);
      if (!rows[0]) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password'
        });
      }

      const child = rows[0];
      const isValidPassword = await bcrypt.compare(password, child.password_hash);
      
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password'
        });
      }

      const sessionQuery = `
        INSERT INTO session_tracking (child_id, start_time)
        VALUES ($1, NOW())
        RETURNING id
      `;
      
      const { rows: [session] } = await clientConn.query(sessionQuery, [child.id]);
      
      const token = jwt.sign(
        {
          userId: child.id,
          parentId: child.parent_id,
          role: 'child',
          username: child.username,
          sessionId: session.id
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      await clientConn.query(
        'UPDATE children SET last_activity = NOW() WHERE id = $1',
        [child.id]
      );

      await clientConn.query('COMMIT');

      res.json({
        success: true,
        token,
        user: {
          id: child.id,
          username: child.username,
          name: child.name,
          age: child.age,
          role: 'child',
          parentId: child.parent_id,
          sessionId: session.id,
          messageLimit: child.message_limit || 100,
          messagesUsed: child.messages_used || 0,
          allowedHours: {
            start: child.allowed_start_time,
            end: child.allowed_end_time
          }
        }
      });
    } catch (error) {
      await clientConn.query('ROLLBACK');
      console.error('Child login error:', error);
      res.status(500).json({ success: false, error: 'An error occurred during login' });
    } finally {
      clientConn.release();
    }
  },

  createChild: async (req, res) => {
    try {
      const { name, age, username, password } = req.body;
      const parentId = req.user.userId;

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters long'
        });
      }

      const existingChild = await pool.query(
        'SELECT id FROM children WHERE username = $1',
        [username]
      );

      if (existingChild.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Username is already taken'
        });
      }

      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      const child = await Child.create({ name, age, username, password: passwordHash }, parentId);

      res.json({
        success: true,
        child: {
          id: child.id,
          name: child.name,
          age: child.age,
          username: child.username,
          created_at: child.created_at
        }
      });
    } catch (error) {
      console.error('Create child error:', error);
      res.status(400).json({
        success: false,
        error: 'Failed to create child account'
      });
    }
  },
  
  completeStripeSignup: async (req, res) => {
    try {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
  
      if (session.payment_status !== 'paid') {
        return res.redirect('/signup?error=payment_failed');
      }
  
      const { email, name, picture, google_id } = JSON.parse(session.metadata.userData);
      let user = await User.findByEmail(email);
      
      if (!user) {
        user = await User.create({
          email,
          name,
          picture,
          plan: session.metadata.plan,
          google_id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: 'active'
        });
      } else {
        user = await User.updateStripeInfo(user.id, {
          customerId: session.customer,
          subscriptionId: session.subscription,
          status: 'active',
          endDate: null
        });
      }
  
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: 'parent' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
  
      const userData = {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'parent',
          plan_type: user.plan_type,
          subscription_status: user.subscription_status,
          stripe_customer_id: user.stripe_customer_id,
          subscription_end_date: user.subscription_end_date
        }
      };
  
      const encodedData = encodeURIComponent(JSON.stringify(userData));
      res.redirect(`/dashboard.html?data=${encodedData}`);
    } catch (error) {
      console.error('Error completing signup:', error);
      res.redirect('/signup?error=signup_failed');
    }
  },
};

module.exports = authController;
