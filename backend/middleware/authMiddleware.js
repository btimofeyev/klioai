const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token format'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role === 'child') {
            const childQuery = `
                SELECT 
                    c.*,
                    pc.allowed_start_time,
                    pc.allowed_end_time
                FROM children c
                LEFT JOIN parental_controls pc ON c.id = pc.child_id
                WHERE c.id = $1
            `;
            const { rows: [child] } = await pool.query(childQuery, [decoded.userId]);

            if (!child) {
                return res.status(401).json({
                    success: false,
                    message: 'Child not found'
                });
            }

            req.user = { ...child, role: 'child', childId: child.id };
        } else {
            const userQuery = 'SELECT * FROM users WHERE id = $1';
            const { rows: [user] } = await pool.query(userQuery, [decoded.userId]);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            req.user = user;
        }

        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

module.exports = { verifyToken };
