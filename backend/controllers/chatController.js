const ChatModel = require("../models/chatModel");
const Child = require("../models/childModel");
const ParentalControl = require("../models/parentalControlModel");
const pool = require("../config/db");

class ChatController {
    // Conversation Management
    static async startConversation(req, res) {
        try {
            const childId = req.user.childId;
            const activeConv = await ChatModel.getActiveConversation(childId);

            if (activeConv) {
                await ChatModel.endConversation(activeConv.id);
            }

            const conversationId = await ChatModel.startNewConversation(childId);
            res.json({ success: true, conversationId });
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
            const childId = req.user.childId;
            const conversation = await ChatModel.getActiveConversation(childId);
            res.json({ success: true, conversation: conversation || null });
        } catch (error) {
            console.error('Error getting active conversation:', error);
            res.status(500).json({ success: false, message: 'Failed to get active conversation' });
        }
    }

    static async endConversation(req, res) {
        try {
            const { conversationId } = req.params;
            await ChatModel.endConversation(conversationId);
            res.json({ success: true, message: 'Conversation ended and summarized successfully' });
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
    
            if (!message?.trim() || !conversationId) {
                throw new Error('Message and conversation ID are required');
            }
    
            const [childData, controls] = await Promise.all([
                Child.findById(childId),
                ParentalControl.findByChildId(childId)
            ]);
    
            if (!childData) {
                throw new Error('Child not found');
            }
    
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
    
            // Generate AI response
            const chatHistory = await ChatModel.getConversationMessages(conversationId);
            const stream = await ChatModel.generateAIResponse(chatHistory, childData);
            
            // Set up streaming response headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
    
            let fullResponse = '';
    
            // Stream the response
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                fullResponse += content;
                
                if (content) {
                    // Send the chunk to the client
                    res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
            }
    
            // Save the complete AI response
            await ChatModel.saveMessage(childId, conversationId, fullResponse, 'assistant');
    
            // Generate suggestions
            const suggestions = await ChatModel.generateSuggestions(fullResponse, childData);
    
            // Increment message usage
            await client.query('UPDATE children SET messages_used = messages_used + 1 WHERE id = $1', [childId]);
            const { rows: [{ messages_used }] } = await client.query(
                'SELECT messages_used FROM children WHERE id = $1',
                [childId]
            );
    
            await client.query('COMMIT');
    
            // Send final message with metadata
            res.write(`data: ${JSON.stringify({
                done: true,
                suggestions,
                messageLimit: controls.message_limit,
                messagesUsed: messages_used,
                messagesRemaining: controls.message_limit - messages_used,
                conversationId,
                isNearLimit: (controls.message_limit - messages_used) <= 5
            })}\n\n`);
    
            res.end();
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error processing message:', error);
            res.write(`data: ${JSON.stringify({
                error: true,
                message: error.message || 'Failed to process message'
            })}\n\n`);
            res.end();
        } finally {
            client.release();
        }
    }

    // User Management
    static async resetDailyMessages(req, res) {
        try {
            const { childId } = req.params;
            await pool.query('UPDATE children SET messages_used = 0 WHERE id = $1', [childId]);

            res.json({ success: true, message: "Daily message count reset successfully" });
        } catch (error) {
            console.error("Error resetting messages:", error);
            res.status(500).json({ success: false, message: "Failed to reset messages" });
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
            res.status(500).json({ success: false, message: 'Error during logout' });
        }
    }
}

module.exports = ChatController;
