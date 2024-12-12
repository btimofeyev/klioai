const ParentalControl = require('../models/parentalControlModel');
const Child = require('../models/childModel');
const bcrypt = require('bcrypt');

const VALID_MESSAGE_LIMITS = [50, 100, 200, 999999]; // Added 999999 for unlimited

const parentalControlController = {
    async getControls(req, res) {
        try {
            const { childId } = req.params;
            const parentId = req.user.id; // Changed from userId to id to match auth token

            console.log('Fetching controls for:', {
                childId,
                parentId,
                user: req.user // Log the entire user object
            });

            // Verify child belongs to parent
            const child = await Child.findById(childId, parentId);
            
            console.log('Found child:', child); // Log the found child

            if (!child) {
                console.log('Child not found for parent:', { childId, parentId });
                return res.status(404).json({
                    success: false,
                    message: 'Child not found'
                });
            }

            const controls = await ParentalControl.findByChildId(childId);
            console.log('Found controls:', controls); // Log the found controls
            
            res.json({
                success: true,
                controls: {
                    filterInappropriate: controls.filter_inappropriate,
                    blockPersonalInfo: controls.block_personal_info,
                    messageLimit: controls.message_limit,
                    allowedHours: {
                        start: controls.allowed_start_time,
                        end: controls.allowed_end_time
                    },
                    blockedTopics: controls.blocked_topics
                }
            });
        } catch (error) {
            console.error('Error fetching controls:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    },

    async updateControls(req, res) {
        try {
            const { childId } = req.params;
            const parentId = req.user.id; // Changed from userId to id to match auth token
    
            console.log('Updating controls for:', {
                childId,
                parentId,
                body: req.body
            });
    
            // Validate input
            const {
                filterInappropriate,
                blockPersonalInfo,
                messageLimit,
                allowedHours
            } = req.body;
    
            // Input validation
            const messageLimitNum = parseInt(messageLimit);
            if (!VALID_MESSAGE_LIMITS.includes(messageLimitNum)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid message limit value'
                });
            }
    
            if (!allowedHours?.start || !allowedHours?.end) {
                return res.status(400).json({
                    success: false,
                    message: 'Both start and end times are required'
                });
            }
    
            // Verify child belongs to parent
            const child = await Child.findById(childId, parentId);
            if (!child) {
                return res.status(404).json({
                    success: false,
                    message: 'Child not found'
                });
            }
    
            // Update the controls
            const updatedControls = await ParentalControl.update(childId, {
                filterInappropriate: !!filterInappropriate, // Convert to boolean
                blockPersonalInfo: !!blockPersonalInfo,
                messageLimit: messageLimitNum,
                allowedHours: {
                    start: allowedHours.start,
                    end: allowedHours.end
                }
            });
    
            // Log the update
            console.log('Controls updated:', updatedControls);
    
            res.json({
                success: true,
                controls: {
                    filterInappropriate: updatedControls.filter_inappropriate,
                    blockPersonalInfo: updatedControls.block_personal_info,
                    messageLimit: updatedControls.message_limit,
                    allowedHours: {
                        start: updatedControls.allowed_start_time,
                        end: updatedControls.allowed_end_time
                    },
                    blockedTopics: updatedControls.blocked_topics || []
                }
            });
        } catch (error) {
            console.error('Error updating controls:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to update controls'
            });
        }
    },

    async checkAccess(req, res) {
        try {
            const { childId } = req.params;
            
            // Get current controls
            const controls = await ParentalControl.findByChildId(childId);
            
            // Check message limit
            const dailyMessages = await ParentalControl.getDailyMessages(childId);
            const withinMessageLimit = dailyMessages < controls.message_limit;

            res.json({
                success: true,
                access: {
                    allowed: withinMessageLimit,
                    withinMessageLimit,
                    messageCount: dailyMessages,
                    messageLimit: controls.message_limit
                }
            });
        } catch (error) {
            console.error('Error checking access:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    },

    async createChildWithControls(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { name, age, username, password, controls } = req.body;
            const parentId = req.user.userId;

            // Validate password strength
            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters long');
            }

            // Check if username is already taken
            const existingChild = await client.query(
                'SELECT id FROM children WHERE username = $1',
                [username]
            );

            if (existingChild.rows.length > 0) {
                throw new Error('Username is already taken');
            }

            // Hash password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // Create child account
            const childQuery = `
                INSERT INTO children (name, age, username, password_hash, parent_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                RETURNING id, name, age, username, created_at
            `;
            
            const { rows: [child] } = await client.query(childQuery, 
                [name, age, username, passwordHash, parentId]
            );

            // Create default parental controls
            const controlsQuery = `
                INSERT INTO parental_controls (
                    child_id,
                    filter_inappropriate,
                    block_personal_info,
                    message_limit
                )
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;

            const controlsValues = [
                child.id,
                controls?.filterInappropriate ?? true,
                controls?.blockPersonalInfo ?? true,
                controls?.messageLimit ?? 50 // 50 messages default
            ];

            const { rows: [parentalControls] } = await client.query(controlsQuery, controlsValues);

            // Add blocked topics if provided
            if (controls?.blockedTopics?.length > 0) {
                const topicsQuery = `
                    INSERT INTO blocked_topics (child_id, topic)
                    SELECT $1, unnest($2::text[])
                `;
                await client.query(topicsQuery, [child.id, controls.blockedTopics]);
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                child: {
                    id: child.id,
                    name: child.name,
                    age: child.age,
                    username: child.username,
                    created_at: child.created_at
                },
                controls: {
                    filterInappropriate: parentalControls.filter_inappropriate,
                    blockPersonalInfo: parentalControls.block_personal_info,
                    messageLimit: parentalControls.message_limit,
                    blockedTopics: controls?.blockedTopics ?? []
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creating child account:', error);
            res.status(400).json({
                success: false,
                message: error.message
            });
        } finally {
            client.release();
        }
    },

};

module.exports = parentalControlController;     