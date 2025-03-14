const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/chatController');
const { verifyToken } = require('../middleware/authMiddleware');
const chatMiddleware = require('../middleware/chatMiddleware');

// Apply authentication to all routes
router.use(verifyToken);

// Conversation management - child access required
router.post('/conversation/start', chatMiddleware.validateChildAccess, ChatController.startConversation);
router.get('/conversation/active', chatMiddleware.validateChildAccess, ChatController.getActiveConversation);
router.post('/conversation/:conversationId/end', chatMiddleware.validateChildAccess, ChatController.endConversation);

// Message handling - child access and valid message required
router.post('/message', 
    chatMiddleware.validateChildAccess, 
    chatMiddleware.validateMessageInput, 
    ChatController.processMessage
);

// Parent controls - may need admin verification instead
router.post('/messages/reset/:childId', ChatController.resetDailyMessages);

// User management - no additional middleware needed
router.post('/logout', ChatController.handleLogout);

module.exports = router;