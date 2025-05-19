const express = require('express');
const router = express.Router();
const parentalControlController = require('../controllers/parentalControlController');
const { verifyToken } = require('../middleware/authMiddleware');

// Debug middleware
router.use((req, res, next) => {
    console.log('Parental Controls Route:', req.method, req.url);
    console.log('Params:', req.params);
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    next();
});

// Apply authentication middleware to all routes
router.use(verifyToken);

// Ensure route parameters are properly defined
router.get('/children/:childId/controls', parentalControlController.getControls);
router.put('/children/:childId/controls', parentalControlController.updateControls);
router.get('/children/:childId/access', parentalControlController.checkAccess);

module.exports = router;