const pool = require("../config/db");
const Child = require('../models/childModel');
const ChatModel = require('../models/chatModel');
const LongTermMemoryModel = require('../models/longTermMemoryModel');
const ParentalControl = require('../models/parentalControlModel');

const helpers = {
    verifyParentAccess: async (childId, parentId) => {
        const child = await Child.findById(childId, parentId);
        if (!child) {
            throw new Error('Access denied');
        }
        return child;
    },

    handleResponse: (res, data, status = 200) => {
        res.status(status).json({ success: true, ...data });
    },

    handleError: (res, error, status = 500) => {
        console.error(`Error: ${error.message}`);
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

        if (memoryGraph.mainInterests?.length > 0) {
            patterns.interests.push(`Shows strong interest in ${memoryGraph.mainInterests.join(', ')}`);
        }

        for (const [topic, data] of Object.entries(memoryGraph.knowledgeGraph || {})) {
            if (data.engagement > 5) {
                patterns.strengths.push(`Demonstrates deep understanding of ${topic}`);
            }
            if (data.details?.knowledge_bits?.length > 3) {
                patterns.engagement.push(`Shows consistent engagement with ${topic}`);
            }
            if (data.engagement < 3 && data.details?.sub_topics?.length > 0) {
                patterns.growth_areas.push(`Could explore more aspects of ${topic}`);
            }
        }

        return patterns;
    },

    validateChildData: (data) => {
        const errors = [];

        if (!data.name?.trim()) {
            errors.push('Name is required');
        }
        if (!data.age || data.age < 5 || data.age > 17) {
            errors.push('Age must be between 5 and 17');
        }
        if (!data.username?.trim()) {
            errors.push('Username is required');
        }
        if (!data.password || data.password.length < 8) {
            errors.push('Password must be at least 8 characters long');
        }
        if (!data.tosAcceptance) {
            errors.push('Terms of Service acceptance is required');
        }

        if (errors.length > 0) {
            throw new Error(errors.join('. '));
        }
    }
};

const childController = {
    async createChild(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const parentId = req.user.id;
            helpers.validateChildData(req.body);

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
                throw new Error(`Your ${effectivePlanType === 'familypro' ? 'Family Pro' : 'Single'} plan allows up to ${maxChildren} child${maxChildren > 1 ? 'ren' : ''}. Please upgrade your plan to add more.`);
            }

            const existingChild = await client.query(
                'SELECT id FROM children WHERE username = $1',
                [req.body.username]
            );
            if (existingChild.rows.length > 0) {
                throw new Error('Username is already taken');
            }

            const { child, controls } = await Child.createWithTOS(
                {
                    name: req.body.name,
                    age: req.body.age,
                    username: req.body.username,
                    password: req.body.password,
                    parentalControls: req.body.parentalControls
                },
                parentId,
                req.body.tosAcceptance
            );

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
        const client = await pool.connect();
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            await helpers.verifyParentAccess(childId, parentId);
            await client.query('BEGIN');

            const updatedChild = await Child.update(childId, {
                name: req.body.name,
                age: req.body.age,
                username: req.body.username
            }, parentId);

            if (!updatedChild) {
                throw new Error('Failed to update child information');
            }

            if (req.body.password) {
                await Child.updatePassword(childId, req.body.password);
            }

            if (req.body.parentalControls) {
                await ParentalControl.update(childId, req.body.parentalControls);
            }

            const [childData, controls] = await Promise.all([
                Child.findById(childId, parentId),
                ParentalControl.findByChildId(childId)
            ]);

            await client.query('COMMIT');

            helpers.handleResponse(res, {
                child: {
                    ...childData,
                    parentalControls: {
                        filterInappropriate: controls.filter_inappropriate,
                        dailyMessageLimit: controls.message_limit,
                        allowedStartTime: controls.allowed_start_time,
                        allowedEndTime: controls.allowed_end_time
                    }
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            helpers.handleError(res, error, 400);
        } finally {
            client.release();
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
            const effectivePlanType = (subscriptionStatus === 'active' && planType !== 'basic') ? planType : 'basic';

            const children = rows
                .filter(row => row.id)
                .map(({ id, name, age, username, created_at, last_active }) => ({
                    id,
                    name,
                    age,
                    username,
                    created_at,
                    last_active
                }));

            helpers.handleResponse(res, { children, planType: effectivePlanType });
        } catch (error) {
            helpers.handleError(res, error, 400);
        }
    },

    async getChild(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            const [child, controls] = await Promise.all([
                Child.findById(childId, parentId),
                ParentalControl.findByChildId(childId)
            ]);

            if (!child) {
                throw new Error('Child not found');
            }

            const [summaries, memoryGraph] = await Promise.all([
                ChatModel.getSummaries(childId),
                LongTermMemoryModel.getChildMemoryGraph(childId)
            ]);

            const enhancedChild = {
                ...child,
                summaries,
                memory: {
                    mainInterests: memoryGraph.mainInterests || [],
                    recentLearning: memoryGraph.recentLearning || [],
                    topics: Object.entries(memoryGraph.knowledgeGraph || {}).map(([topic, data]) => ({
                        name: topic,
                        engagement: data.engagement,
                        knowledge: data.details?.knowledge_bits || [],
                        subTopics: data.details?.sub_topics || [],
                        relatedInterests: data.details?.related_interests || []
                    }))
                },
                learningPatterns: helpers.analyzeLearningPatterns(memoryGraph)
            };

            helpers.handleResponse(res, { child: enhancedChild });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

    async getChildProfile(req, res) {
        try {
            if (req.user.role !== 'child') {
                throw new Error('Access denied: Child profile only accessible by child users');
            }

            const childId = req.user.id;
            if (!childId) {
                throw new Error('Child ID not found in token');
            }

            const [childData, controls] = await Promise.all([
                Child.findById(childId),
                ParentalControl.findByChildId(childId)
            ]);

            if (!childData) {
                throw new Error('Child profile not found');
            }

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

    async getChildTOSHistory(req, res) {
        try {
            const { id: parentId } = req.user;
            const childId = req.params.id;

            await helpers.verifyParentAccess(childId, parentId);
            const history = await Child.getTOSHistory(childId);

            helpers.handleResponse(res, { history });
        } catch (error) {
            helpers.handleError(res, error);
        }
    },

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
