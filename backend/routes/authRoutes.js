// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
// Add this new route
router.post('/verify-google-token', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        
        const payload = ticket.getPayload();
        
        res.json({
            success: true,
            payload: {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                googleId: payload.sub
            }
        });
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(400).json({
            success: false,
            error: 'Token verification failed'
        });
    }
});

router.post('/google', authController.googleAuth);
router.post('/login', authController.login);
router.get('/complete-stripe-signup', authController.completeStripeSignup);
router.post('/child-login', authController.childLogin);

module.exports = router;
