const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/chatController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

// Conversation management
router.post('/conversation/start', ChatController.startConversation);
router.get('/conversation/active', ChatController.getActiveConversation); // Removed childId parameter
router.post('/conversation/:conversationId/end', ChatController.endConversation);

// Message handling
router.post('/message', ChatController.processMessage);

// Parent controls
router.post('/messages/reset/:childId', ChatController.resetDailyMessages);

// User management
router.post('/logout', ChatController.handleLogout);

module.exports = router;