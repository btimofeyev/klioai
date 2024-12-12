const ChatModel = require("../models/chatModel");
const Child = require("../models/childModel");
const ParentalControl = require("../models/parentalControlModel");
const pool = require("../config/db");

class ChatController {
  // Conversation Management
  static async startConversation(req, res) {
    try {
      const childId = req.user.childId;

      // First, end any active conversations
      const activeConv = await ChatModel.getActiveConversation(childId);
      if (activeConv) {
        await ChatModel.endConversation(activeConv.id);
      }

      // Start new conversation
      const conversationId = await ChatModel.startNewConversation(childId);

      res.json({
        success: true,
        conversationId
      });
    } catch (error) {
      console.error('Error starting conversation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start conversation'
      });
    }
  }

  static async getActiveConversation(req, res) {
    try {
        const childId = req.user.childId; // Get from JWT token
        
        const conversation = await ChatModel.getActiveConversation(childId);
        
        res.json({
            success: true,
            conversation: conversation || null
        });
    } catch (error) {
        console.error('Error getting active conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get active conversation'
        });
    }
}

  static async endConversation(req, res) {
    try {
      const { conversationId } = req.params;
      await ChatModel.endConversation(conversationId);
      
      res.json({
        success: true,
        message: 'Conversation ended and summarized successfully'
      });
    } catch (error) {
      console.error('Error ending conversation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to end conversation'
      });
    }
  }

  // Message Processing
  static async processMessage(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const childId = req.user.childId;
        const { message, conversationId } = req.body;
        
        // Validate input
        if (!message?.trim() || !conversationId) {
            throw new Error('Message and conversation ID are required');
        }

        // Get child data and controls
        const [childData, controls] = await Promise.all([
            Child.findById(childId),
            ParentalControl.findByChildId(childId)
        ]);

        if (!childData) {
            throw new Error('Child not found');
        }

        // Check message limit
        if (childData.messages_used >= controls.message_limit) {
            await ChatModel.endConversation(conversationId);
            
            return res.status(403).json({
                success: false,
                message: 'Message limit reached for today',
                messageLimit: controls.message_limit,
                messagesUsed: childData.messages_used
            });
        }

        // Save user message
        await ChatModel.saveMessage(childId, conversationId, message, 'user');

        // Get conversation history
        const chatHistory = await ChatModel.getConversationMessages(conversationId);

        // Generate AI response
        const aiResponse = await ChatModel.generateAIResponse(chatHistory, childData);
        if (!aiResponse) {
            throw new Error('Failed to generate AI response');
        }

        // Save AI response
        await ChatModel.saveMessage(childId, conversationId, aiResponse, 'assistant');

        // Generate suggestions
        const suggestions = await ChatModel.generateSuggestions(aiResponse, childData);

        // Increment messages used
        await client.query(
            'UPDATE children SET messages_used = messages_used + 1 WHERE id = $1',
            [childId]
        );

        // Get updated message count
        const { rows: [{ messages_used }] } = await client.query(
            'SELECT messages_used FROM children WHERE id = $1',
            [childId]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: aiResponse,
            suggestions,
            messageLimit: controls.message_limit,
            messagesUsed: messages_used,
            messagesRemaining: controls.message_limit - messages_used,
            conversationId,
            isNearLimit: (controls.message_limit - messages_used) <= 5
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing message:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process message'
        });
    } finally {
        client.release();
    }
}

  // User Management
  static async resetDailyMessages(req, res) {
    try {
      const childId = req.params.childId;
      await pool.query(
        "UPDATE children SET messages_used = 0 WHERE id = $1",
        [childId]
      );

      res.json({
        success: true,
        message: "Daily message count reset successfully"
      });
    } catch (error) {
      console.error("Error resetting messages:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset messages"
      });
    }
  }

  // Logout Handling
  static async handleLogout(req, res) {
    try {
      const { conversationId } = req.body;

      if (conversationId) {
        await ChatModel.endConversation(conversationId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({
        success: false,
        message: 'Error during logout'
      });
    }
  }
}

module.exports = ChatController;