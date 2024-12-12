const pool = require("../config/db");
const Child = require('../models/childModel');
const ChatModel = require('../models/chatModel');
const LongTermMemoryModel = require('../models/longTermMemoryModel');
const ParentalControl = require('../models/parentalControlModel');

// Helper functions
const helpers = {
    verifyParentAccess: async (childId, parentId) => {
        const child = await Child.findById(childId, parentId);
        if (!child) {
            throw new Error('Access denied');
        }
        return child;
    },

    handleResponse: (res, data, status = 200) => {
        res.status(status).json({
            success: true,
            ...data
        });
    },

    handleError: (res, error, status = 500) => {
        console.error(`Error: ${error.message}`, error);
        res.status(status).json({
            success: false,
            message: error.message || 'An unexpected error occurred'
        });
    },

    analyzeLearningPatterns(memoryGraph) {
        const patterns = {
            strengths: [],
            interests: [],
            engagement: [],
            growth_areas: []
        };

        if (memoryGraph.mainInterests.length > 0) {
            patterns.interests.push(`Shows strong interest in ${memoryGraph.mainInterests.join(', ')}`);
        }

        Object.entries(memoryGraph.knowledgeGraph).forEach(([topic, data]) => {
            if (data.engagement > 5) {
                patterns.strengths.push(`Demonstrates deep understanding of ${topic}`);
            }
            if (data.details.knowledge_bits.length > 3) {
                patterns.engagement.push(`Shows consistent engagement with ${topic}`);
            }
            if (data.engagement < 3 && data.details.sub_topics.length > 0) {
                patterns.growth_areas.push(`Could explore more aspects of ${topic}`);
            }
        });

        return patterns;
    }
};

const childController = {

    async createChild(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const parentId = req.user.id;
            console.log('Creating child with parent ID:', parentId);

            // Get parent's plan type and validate limits
            const { rows: [parent] } = await client.query(`
                SELECT 
                    u.plan_type,
                    u.subscription_status,
                    COUNT(c.id) as child_count
                FROM users u
                LEFT JOIN children c ON u.id = c.parent_id
                WHERE u.id = $1
                GROUP BY u.id, u.plan_type, u.subscription_status
            `, [parentId]);

            const effectivePlanType = (parent.subscription_status === 'active' && parent.plan_type !== 'basic') 
                ? parent.plan_type 
                : 'basic';

            const maxChildren = effectivePlanType === 'familypro' ? 3 : 1;
            if (parent.child_count >= maxChildren) {
                throw new Error(`Your ${effectivePlanType === 'familypro' ? 'Family Pro' : 'Single'} plan allows up to ${maxChildren} child ${maxChildren === 1 ? 'account' : 'accounts'}. Please upgrade your plan to add more children.`);
            }

            // Validate input
            if (!req.body.password || req.body.password.length < 8) {
                throw new Error('Password must be at least 8 characters long');
            }

            const requiredFields = ['name', 'age', 'username'];
            for (const field of requiredFields) {
                if (!req.body[field]) {
                    throw new Error(`${field} is required`);
                }
            }

            // Check username availability
            const existingChild = await client.query(
                'SELECT id FROM children WHERE username = $1',
                [req.body.username]
            );

            if (existingChild.rows.length > 0) {
                throw new Error('Username is already taken');
            }

            // Create child account with parental controls
            const { child, controls } = await Child.create({
                name: req.body.name,
                age: req.body.age,
                username: req.body.username,
                password: req.body.password,
                parentalControls: {
                    filterInappropriate: req.body.parentalControls?.filterInappropriate ?? true,
                    dailyMessageLimit: req.body.parentalControls?.dailyMessageLimit ?? 50,
                    allowedStartTime: req.body.parentalControls?.allowedStartTime ?? '09:00:00',
                    allowedEndTime: req.body.parentalControls?.allowedEndTime ?? '21:00:00'
                }
            }, parentId);

            await client.query('COMMIT');
            
            helpers.handleResponse(res, {
                child: {
                    ...child,
                    controls: {
                        filterInappropriate: controls.filter_inappropriate,
                        blockPersonalInfo: controls.block_personal_info,
                        dailyLimit: controls.daily_limit,
                        allowedHours: {
                            start: controls.allowed_start_time,
                            end: controls.allowed_end_time
                        }
                    }
                }
            }, 201);
        } catch (error) {
            await client.query('ROLLBACK');
            helpers.handleError(res, error, 400);
        } finally {
            client.release();
        }
    },

    async updateChild(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;
            
            await helpers.verifyParentAccess(childId, parentId);

            // Update basic information
            const updatedChild = await pool.query(
                `UPDATE children 
                 SET name = $1, 
                     age = $2,
                     updated_at = NOW()
                 WHERE id = $3 AND parent_id = $4
                 RETURNING *`,
                [req.body.name, req.body.age, childId, parentId]
            );

            if (req.body.password) {
                await Child.updatePassword(childId, req.body.password);
            }

            // Update parental controls if provided
            if (req.body.parentalControls) {
                await pool.query(
                    `UPDATE parental_controls
                     SET filter_inappropriate = $1,
                         message_limit = $2,
                         allowed_start_time = $3,
                         allowed_end_time = $4,
                         updated_at = NOW()
                     WHERE child_id = $5`,
                    [
                        req.body.parentalControls.filterInappropriate,
                        req.body.parentalControls.dailyMessageLimit,
                        req.body.parentalControls.allowedStartTime,
                        req.body.parentalControls.allowedEndTime,
                        childId
                    ]
                );
            }

            // Get updated data
            const [updatedChildData, controls] = await Promise.all([
                Child.findById(childId, parentId),
                ParentalControl.findByChildId(childId)
            ]);

            helpers.handleResponse(res, {
                child: {
                    ...updatedChildData,
                    parentalControls: {
                        filterInappropriate: controls.filter_inappropriate,
                        dailyMessageLimit: controls.message_limit,
                        allowedStartTime: controls.allowed_start_time,
                        allowedEndTime: controls.allowed_end_time
                    }
                }
            });
        } catch (error) {
            helpers.handleError(res, error, 400);
        }
    },

    async getChildren(req, res) {
        try {
            const { id: parentId } = req.user;

            const { rows } = await pool.query(`
                SELECT 
                    u.plan_type,
                    u.subscription_status,
                    c.*
                FROM users u
                LEFT JOIN children c ON u.id = c.parent_id
                WHERE u.id = $1
            `, [parentId]);

            const planType = rows[0]?.plan_type || 'basic';
            const subscriptionStatus = rows[0]?.subscription_status || 'inactive';
            const effectivePlanType = (subscriptionStatus === 'active' && planType !== 'basic') 
                ? planType 
                : 'basic';

            const children = rows
                .filter(row => row.id)
                .map(({
                    id, name, age, username, created_at, last_active
                }) => ({
                    id,
                    name,
                    age,
                    username,
                    created_at,
                    last_active
                }));

            helpers.handleResponse(res, {
                children,
                planType: effectivePlanType
            });
        } catch (error) {
            helpers.handleError(res, error, 400);
        }
    },

    async getChild(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            // Get child data and controls
            const [child, controls] = await Promise.all([
                Child.findById(childId, parentId),
                ParentalControl.findByChildId(childId)
            ]);

            if (!child) {
                throw new Error('Child not found');
            }

            // Get profile enhancements
            const [summaries, memoryGraph] = await Promise.all([
                ChatModel.getSummaries(childId),
                LongTermMemoryModel.getChildMemoryGraph(childId)
            ]);

            const enhancedChild = {
                ...child,
                summaries,
                memory: {
                    mainInterests: memoryGraph.mainInterests,
                    recentLearning: memoryGraph.recentLearning,
                    topics: Object.entries(memoryGraph.knowledgeGraph).map(([topic, data]) => ({
                        name: topic,
                        engagement: data.engagement,
                        knowledge: data.details.knowledge_bits,
                        subTopics: data.details.sub_topics,
                        relatedInterests: data.details.related_interests
                    }))
                },
                learningPatterns: helpers.analyzeLearningPatterns(memoryGraph)
            };

            helpers.handleResponse(res, { child: enhancedChild });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

    async getProfile(req, res) {
        try {
            if (req.user.role !== 'child') {
                throw new Error('Access denied: Child profile only accessible by child users');
            }

            const childId = req.user.id || req.user.userId;
            if (!childId) {
                throw new Error('Child ID not found in token');
            }

            // Get profile data
            const [childData, controls] = await Promise.all([
                Child.findById(childId),
                ParentalControl.findByChildId(childId)
            ]);

            if (!childData) {
                throw new Error('Child profile not found');
            }

            // Calculate remaining time
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const usage = await pool.query(`
                SELECT COALESCE(SUM(duration), 0) as total_minutes
                FROM session_tracking
                WHERE child_id = $1
                AND start_time >= $2
            `, [childId, todayStart]);

            const usedMinutes = parseInt(usage.rows[0].total_minutes || 0);
            const remainingMinutes = controls.daily_limit - usedMinutes;

            helpers.handleResponse(res, {
                id: childData.id,
                name: childData.name,
                age: childData.age,
                username: childData.username,
                timeRemaining: remainingMinutes,
                daily_time_limit: controls.daily_limit,
                allowed_hours: {
                    start: controls.allowed_start_time,
                    end: controls.allowed_end_time
                }
            });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

    async deleteChild(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            await helpers.verifyParentAccess(childId, parentId);
            await Child.delete(childId, parentId);
            
            helpers.handleResponse(res, { 
                message: 'Child account and all related data deleted successfully' 
            });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

    // Memory and Learning Methods
    async getChildSummaries(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            await helpers.verifyParentAccess(childId, parentId);
            const summaries = await ChatModel.getSummaries(childId);
            
            helpers.handleResponse(res, { summaries });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

    async getChildMemory(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            await helpers.verifyParentAccess(childId, parentId);
            const memoryGraph = await LongTermMemoryModel.getChildMemoryGraph(childId);
            
            helpers.handleResponse(res, { memory: memoryGraph });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

    async deleteMemoryTopic(req, res) {
        try {
            const { id: parentId } = req.user;
            const { id: childId, topic } = req.params;

            await helpers.verifyParentAccess(childId, parentId);
            
            const result = await pool.query(`
                DELETE FROM long_term_memory_graph 
                WHERE child_id = $1 AND topic = $2
                RETURNING *
            `, [childId, topic]);

            if (result.rowCount === 0) {
                throw new Error('Memory topic not found');
            }

            helpers.handleResponse(res, { 
                message: 'Memory topic deleted successfully' 
            });
        } catch (error) {
            helpers.handleError(res, error);
        }
    }
};

module.exports = childController;