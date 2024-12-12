// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        console.log('Auth Header:', authHeader);
        
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1];
        console.log('Token:', token);
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token format'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded token:', decoded);

        // Check role and query appropriate table
        if (decoded.role === 'child') {
            // Query children table for child accounts
            const childQuery = `
                SELECT 
                    c.*,
                    pc.allowed_start_time,
                    pc.allowed_end_time
                FROM children c
                LEFT JOIN parental_controls pc ON c.id = pc.child_id
                WHERE c.id = $1
            `;
            
            const child = await pool.query(childQuery, [decoded.userId]);
            
            if (!child.rows[0]) {
                console.log('No child found for ID:', decoded.userId);
                return res.status(401).json({
                    success: false,
                    message: 'Child not found'
                });
            }

            // Set user object with child data
            req.user = {
                ...child.rows[0],
                role: 'child',
                childId: child.rows[0].id
            };
            
        } else {
            // Query users table for parent accounts
            const userQuery = 'SELECT * FROM users WHERE id = $1';
            const user = await pool.query(userQuery, [decoded.userId]);

            if (!user.rows[0]) {
                console.log('No user found for ID:', decoded.userId);
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            req.user = user.rows[0];
        }

        console.log('Final user object:', req.user);
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