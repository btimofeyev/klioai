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

            // Log authentication state for debugging
            console.log('Auth state:', {
                hasUser: !!req.user,
                role: req.user?.role,
                childId: req.user?.childId,
                userId: req.user?.id
            });

            const childId = req.user?.childId;
            if (!childId) {
                throw new Error('Child ID is missing. Make sure you are authenticated as a child user.');
            }
            const { message, conversationId } = req.body;
            if (!message?.trim() || !conversationId) {
                throw new Error('Message and conversation ID are required');
            }

            // All .findBy... and similar must accept/use the transaction client!
            const childData = await Child.findById(childId, client);
            if (!childData) {
                throw new Error(`Child not found with ID: ${childId}`);
            }
            const controls = await ParentalControl.findByChildId(childId, client);

            if (childData.messages_used >= controls.message_limit) {
                await ChatModel.endConversation(conversationId, client);
                await client.query('COMMIT');
                return res.status(403).json({
                    success: false,
                    message: 'Message limit reached for today',
                    messageLimit: controls.message_limit,
                    messagesUsed: childData.messages_used
                });
            }

            await ChatModel.saveMessage(childId, conversationId, message, 'user', client);

            const chatHistory = await ChatModel.getConversationMessages(conversationId, client);
            let stream;
            try {
                stream = await ChatModel.generateAIResponse(chatHistory, childData, client);
            } catch (streamError) {
                console.error("OpenAI stream init failed:", streamError);
                await client.query("ROLLBACK");
                res.write(`data: ${JSON.stringify({ error: true, message: streamError.message || "Failed to contact AI" })}\n\n`);
                res.end();
                return;
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            let fullResponse = '';
            try {
                for await (const chunk of stream) {
                    console.log("AI Stream Chunk:", chunk);
                    if (chunk.type === "response.output_text.delta" && chunk.delta) {
                        res.write(`data: ${JSON.stringify({ content: chunk.delta })}\n\n`);
                        fullResponse += chunk.delta;
                    }
                    // Optionally: handle others
                    // else if (chunk.type === "response.output_text.done") { ... }
                }
            } catch (streamingError) {
                await client.query('ROLLBACK');
                console.error('Error during OpenAI streaming:', streamingError);
                res.write(`data: ${JSON.stringify({
                    error: true,
                    message: streamingError.message || "Streaming error"
                })}\n\n`);
                res.end();
                client.release();
                return;
            }

            await ChatModel.saveMessage(childId, conversationId, fullResponse, 'assistant', client);
            const suggestions = await ChatModel.generateSuggestions(fullResponse, childData);

            await client.query(
                'UPDATE children SET messages_used = messages_used + 1 WHERE id = $1',
                [childId]
            );

            const { rows } = await client.query(
                'SELECT messages_used FROM children WHERE id = $1', [childId]
            );
            console.log("children SELECT rows after increment:", rows); // <--- Debug!
            if (!rows.length) {
                await client.query('ROLLBACK');
                throw new Error(`Child with id ${childId} not found during message update.`);
            }
            const { messages_used } = rows[0];
            await client.query('COMMIT');

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
            try { await client.query('ROLLBACK'); } catch (e) { }
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