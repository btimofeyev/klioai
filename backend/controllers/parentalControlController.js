const ParentalControl = require('../models/parentalControlModel');
const Child = require('../models/childModel');
const bcrypt = require('bcrypt');

const VALID_MESSAGE_LIMITS = [50, 100, 200, 999999]; // Include 999999 for unlimited

const parentalControlController = {
    async getControls(req, res) {
        try {
            const { childId } = req.params;
            const parentId = req.user.id;

            const child = await Child.findById(childId, parentId);
            if (!child) {
                return res.status(404).json({
                    success: false,
                    message: 'Child not found'
                });
            }

            const controls = await ParentalControl.findByChildId(childId);

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
            const parentId = req.user.id;
            const {
                filterInappropriate,
                blockPersonalInfo,
                messageLimit,
                allowedHours
            } = req.body;

            const messageLimitNum = parseInt(messageLimit, 10);
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

            const child = await Child.findById(childId, parentId);
            if (!child) {
                return res.status(404).json({
                    success: false,
                    message: 'Child not found'
                });
            }

            const updatedControls = await ParentalControl.update(childId, {
                filterInappropriate: !!filterInappropriate,
                blockPersonalInfo: !!blockPersonalInfo,
                messageLimit: messageLimitNum,
                allowedHours: {
                    start: allowedHours.start,
                    end: allowedHours.end
                }
            });

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
            const controls = await ParentalControl.findByChildId(childId);
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

            if (password.length < 8) {
                throw new Error('Password must be at least 8 characters long');
            }

            const existingChild = await client.query(
                'SELECT id FROM children WHERE username = $1',
                [username]
            );

            if (existingChild.rows.length > 0) {
                throw new Error('Username is already taken');
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const childQuery = `
                INSERT INTO children (name, age, username, password_hash, parent_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                RETURNING id, name, age, username, created_at
            `;
            const { rows: [child] } = await client.query(childQuery, [name, age, username, passwordHash, parentId]);

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
                controls?.messageLimit ?? 50
            ];
            const { rows: [parentalControls] } = await client.query(controlsQuery, controlsValues);

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
