const pool = require('../config/db');

const chatMiddleware = {
    async validateChildAccess(req, res, next) {
        try {
            // Get child data from authenticated user
            const userId = req.user.id;
            
            // Modified query to correctly join tables and find child
            const childResult = await pool.query(`
                SELECT 
                    c.*,
                    COALESCE(
                        (SELECT summary 
                         FROM chat_summaries 
                         WHERE child_id = c.id 
                         ORDER BY created_at DESC 
                         LIMIT 1),
                        'This is our first chat!'
                    ) as learning_summary
                FROM children c
                WHERE c.id = $1
            `, [req.body.childId]); // Use childId from request body

            if (!childResult.rows[0]) {
                return res.status(403).json({
                    success: false,
                    message: 'Child profile not found'
                });
            }

            // Add child data to request object
            req.childData = childResult.rows[0];
            next();
        } catch (error) {
            console.error('Chat middleware error:', error);
            return res.status(500).json({
                success: false,
                message: 'Error validating child access'
            });
        }
    },

    validateMessageInput(req, res, next) {
        const { message } = req.body;
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid message content is required'
            });
        }

        // Sanitize the message
        req.body.message = message.trim();
        next();
    }
};

module.exports = chatMiddleware;