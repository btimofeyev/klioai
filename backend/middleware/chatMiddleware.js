const pool = require('../config/db');

const chatMiddleware = {
    async validateChildAccess(req, res, next) {
        try {
            // Check if req.user is a child user already (from verifyToken)
            if (req.user && req.user.role === 'child' && req.user.childId) {
                // We already have child data from authentication
                return next();
            }
            
            // If we get here, either:
            // 1. It's a parent user trying to access child data
            // 2. We need to get additional child data
            
            // Get the childId - either from params, query, or body
            const childId = req.params.childId || req.query.childId || req.body.childId;
            
            if (!childId) {
                return res.status(400).json({
                    success: false,
                    message: 'Child ID is required'
                });
            }
            
            // For parent users, verify they have access to this child
            if (req.user && req.user.role !== 'child') {
                // Verify parent has access to this child
                const parentAccessQuery = `
                    SELECT * FROM children WHERE id = $1 AND parent_id = $2
                `;
                const parentAccess = await pool.query(parentAccessQuery, [childId, req.user.id]);
                
                if (parentAccess.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied: Not authorized to access this child profile'
                    });
                }
            }
            
            // Get child data
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
            `, [childId]);

            if (!childResult.rows[0]) {
                return res.status(403).json({
                    success: false,
                    message: 'Child profile not found'
                });
            }

            // Add child data to request object
            const childData = childResult.rows[0];
            req.childData = childData;
            
            // Ensure childId is set on req.user for controllers that expect it there
            if (!req.user) req.user = {};
            req.user.childId = childId;
            
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