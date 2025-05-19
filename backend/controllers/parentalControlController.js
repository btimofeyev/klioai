const ParentalControl = require('../models/parentalControlModel');
const Child = require('../models/childModel');
const bcrypt = require('bcrypt');

const VALID_MESSAGE_LIMITS = [50, 100, 200, 999999]; // Include 999999 for unlimited

const parentalControlController = {
    async getControls(req, res) {
        try {
            const childId = req.params.childId;
            console.log("Getting controls for childId:", childId);
            
            if (!childId) {
                return res.status(400).json({
                    success: false,
                    message: 'Child ID is required'
                });
            }
            
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
                    blockedTopics: controls.blocked_topics || []
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
            const childId = req.params.childId;
            console.log("Updating controls for childId:", childId);

            if (!childId) {
                return res.status(400).json({
                    success: false,
                    message: 'Child ID is required'
                });
            }

            const parentId = req.user.id;
            const {
                filterInappropriate,
                blockPersonalInfo,
                messageLimit,
                allowedHours
            } = req.body;

            // Log the received body for clarity
            console.log("Received updateControls body:", JSON.stringify(req.body, null, 2));


            const messageLimitNum = parseInt(messageLimit, 10);
            if (!VALID_MESSAGE_LIMITS.includes(messageLimitNum)) {
                console.error(`Invalid messageLimit from body: ${messageLimit}, parsed as ${messageLimitNum}. Valid limits: ${VALID_MESSAGE_LIMITS.join(', ')}`);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid message limit value. Must be one of: ' + VALID_MESSAGE_LIMITS.join(', ')
                });
            }

            const rawStartTime = allowedHours?.start;
            const rawEndTime = allowedHours?.end;

            console.log(`Raw times from body: Start='${rawStartTime}', End='${rawEndTime}'`);

            // Default time values if not provided or if they are empty strings after trim
            const startTime = (rawStartTime && rawStartTime.trim() !== '') ? rawStartTime.trim() : '09:00';
            const endTime = (rawEndTime && rawEndTime.trim() !== '') ? rawEndTime.trim() : '21:00';

            console.log(`Processed times for validation: Start='${startTime}', End='${endTime}'`);

            // Validate time format (HH:MM or HH:MM:SS)
            const timeFormatRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
            if (!timeFormatRegex.test(startTime) || !timeFormatRegex.test(endTime)) {
                console.error(`Time format validation failed. Regex: ${timeFormatRegex}. Test Start ('${startTime}'): ${timeFormatRegex.test(startTime)}, Test End ('${endTime}'): ${timeFormatRegex.test(endTime)}`);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid time format. Use HH:MM or HH:MM:SS format.'
                });
            }

            const child = await Child.findById(childId, parentId);
            if (!child) {
                console.error(`Child not found for childId: ${childId} with parentId: ${parentId}`);
                return res.status(404).json({
                    success: false,
                    message: 'Child not found or parent does not have access.'
                });
            }

            const controlsToUpdate = {
                filterInappropriate: !!filterInappropriate,
                blockPersonalInfo: !!blockPersonalInfo,
                messageLimit: messageLimitNum,
                allowedHours: {
                    start: startTime, // Use the validated time string
                    end: endTime     // Use the validated time string
                }
            };
            console.log("Calling ParentalControl.update with data:", JSON.stringify(controlsToUpdate, null, 2));

            const updatedControls = await ParentalControl.update(childId, controlsToUpdate);
            
            console.log("ParentalControl.update successful. Result:", JSON.stringify(updatedControls, null, 2));

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
            console.error('Error in updateControls controller:', error.message, error.stack);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to update controls due to an unexpected server error.'
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