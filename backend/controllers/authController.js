const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/userModel');
const Child = require('../models/childModel');
const ParentalControl = require('../models/parentalControlModel');
const pool = require('../config/db');

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
                // Create Stripe customer first
                const customer = await stripe.customers.create({
                    email: email,
                    name: name,
                    metadata: {
                        google_id: googleId
                    }
                });

                // Then create user with Stripe customer ID
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
                // If user exists but doesn't have a Stripe customer ID, create one
                const customer = await stripe.customers.create({
                    email: user.email,
                    name: user.name,
                    metadata: {
                        google_id: user.google_id
                    }
                });

                // Update user with Stripe customer ID
                user = await User.updateStripeInfo(user.id, {
                    customerId: customer.id,
                    status: 'active'
                });
            }
        
            const jwtToken = jwt.sign(
                { 
                    userId: user.id, 
                    email: user.email,
                    role: 'parent'
                },
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
            res.status(400).json({
                success: false,
                error: 'Authentication failed'
            });
      
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
            let user = await User.findByEmail(email);
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found. Please sign up first.'
                });
            }
    
            const jwtToken = jwt.sign(
                { 
                    userId: user.id, 
                    email: user.email,
                    role: 'parent'
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
    
            // Send complete user data including Stripe info
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
                    stripe_customer_id: user.stripe_customer_id  // Added this
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(400).json({
                success: false,
                error: 'Login failed'
            });
        }
    },

    async childLogin(req, res) {
        const client = await pool.connect();
        try {
            // Log incoming request
            console.log('Child login attempt:', {
                username: req.body.username,
                timestamp: new Date().toISOString()
            });
    
            await client.query('BEGIN');
            
            const { username, password } = req.body;
    
            if (!username || !password) {
                console.log('Missing credentials');
                return res.status(400).json({
                    success: false,
                    error: 'Username and password are required'
                });
            }
    
            // Find child by username
            const query = `
                SELECT c.*, u.id as parent_id, u.email as parent_email,
                       pc.message_limit,
                       pc.allowed_start_time, pc.allowed_end_time
                FROM children c
                JOIN users u ON c.parent_id = u.id
                LEFT JOIN parental_controls pc ON c.id = pc.child_id
                WHERE c.username = $1
            `;
            
            const { rows } = await client.query(query, [username]);
            console.log('Query result:', { found: !!rows[0] });
    
            if (!rows[0]) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid username or password'
                });
            }
    
            const child = rows[0];
    
            // Verify password
            const isValidPassword = await bcrypt.compare(password, child.password_hash);
            console.log('Password verification:', { isValid: isValidPassword });
            
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid username or password'
                });
            }
    
            // Start a new session
            const sessionQuery = `
                INSERT INTO session_tracking (child_id, start_time)
                VALUES ($1, NOW())
                RETURNING id
            `;
            
            const { rows: [session] } = await client.query(sessionQuery, [child.id]);
            console.log('Session created:', { sessionId: session.id });
    
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
    
            // Update last activity
            await client.query(
                'UPDATE children SET last_activity = NOW() WHERE id = $1',
                [child.id]
            );
    
            await client.query('COMMIT');
    
            console.log('Login successful:', { childId: child.id, username: child.username });
    
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
            await client.query('ROLLBACK');
            console.error('Child login error:', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            res.status(500).json({
                success: false,
                error: 'An error occurred during login'
            });
        } finally {
            client.release();
        }
    },    

    createChild: async (req, res) => {
        try {
            const { name, age, username, password } = req.body;
            const parentId = req.user.userId;

            // Validate password strength
            if (password.length < 8) {
                return res.status(400).json({
                    success: false,
                    error: 'Password must be at least 8 characters long'
                });
            }

            // Check if username is already taken
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

            // Hash password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // Create child account with hashed password
            const child = await Child.create({
                name,
                age,
                username,
                password: passwordHash // This will be stored as password_hash in the database
            }, parentId);

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
    
            // Get the email from the session metadata
            const { email, name, picture, google_id } = JSON.parse(session.metadata.userData);
    
            // Create or update user with Stripe info
            let user = await User.findByEmail(email);
            
            if (!user) {
                user = await User.create({
                    email,
                    name,
                    picture,
                    plan: session.metadata.plan, // Make sure this matches the plan name in your system
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
    
            // Create JWT token
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    email: user.email,
                    role: 'parent'
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
    
            // Store user data and token
            const userData = {
                token: token,
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
    
            // Redirect to dashboard with encoded user data
            const encodedData = encodeURIComponent(JSON.stringify(userData));
            res.redirect(`/dashboard.html?data=${encodedData}`);
        } catch (error) {
            console.error('Error completing signup:', error);
            res.redirect('/signup?error=signup_failed');
        }
    },
};

module.exports = authController;