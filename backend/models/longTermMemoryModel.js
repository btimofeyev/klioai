const pool = require("../config/db");
const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class LongTermMemoryModel {
    static async processNewSummary(childId, summary) {
        const client = await pool.connect();
        try {
            const insights = await this.extractInsights(summary);

            await client.query('BEGIN');

            const existingTopicsRes = await client.query(
                `SELECT topic, details FROM long_term_memory_graph WHERE child_id = $1`,
                [childId]
            );

            const topicMap = this.createTopicMap(existingTopicsRes.rows);

            for (const topic of insights.topics) {
                if (this.isGenericTopic(topic)) continue;

                const matchingTopic = this.findMatchingTopic(topic, topicMap);

                if (matchingTopic) {
                    await this.updateExistingTopic(
                        childId,
                        matchingTopic,
                        topic,
                        insights,
                        topicMap[matchingTopic]
                    );
                } else {
                    const initialDetails = {
                        sub_topics: insights.sub_topics[topic] || [],
                        knowledge_bits: [{
                            fact: insights.knowledge_bits[topic],
                            learned_at: new Date().toISOString()
                        }],
                        engagement_level: "initial",
                        related_interests: insights.related_interests[topic] || []
                    };

                    await client.query(
                        `INSERT INTO long_term_memory_graph 
                         (child_id, category, topic, details, first_seen, last_seen)
                         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
                        [childId, 'interest', topic, initialDetails]
                    );
                }
            }

            await client.query('COMMIT');
        } catch (error) {
            await pool.query('ROLLBACK');
            console.error('Error processing new summary:', error);
            throw error;
        } finally {
            pool.release();
        }
    }

    static async extractInsights(summary) {
        const systemMessage = {
            role: "system",
            content: `You are analyzing conversations to build a child's long-term memory profile.
                      Extract core interests, knowledge, subtopics, and related interests as JSON.
                      Ignore generic, conversational patterns and focus on subject matter interests.`
        };

        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    systemMessage,
                    { role: "user", content: summary }
                ],
                temperature: 0.7,
                max_tokens: 500,
                response_format: { type: "json_object" }
            });

            return JSON.parse(completion.choices[0].message.content);
        } catch (error) {
            console.error('Error extracting insights:', error);
            throw error;
        }
    }

    static createTopicMap(existingTopics) {
        const topicMap = {};
        for (const row of existingTopics) {
            const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
            const mainTopic = row.topic.toLowerCase();
            const relatedTerms = [
                ...details.sub_topics.map(st => st.toLowerCase()),
                ...details.related_interests.map(ri => ri.toLowerCase())
            ];

            topicMap[mainTopic] = {
                originalTopic: row.topic,
                relatedTerms,
                details
            };
        }
        return topicMap;
    }

    static findMatchingTopic(newTopic, topicMap) {
        const normalized = newTopic.toLowerCase();

        if (topicMap[normalized]) {
            return topicMap[normalized].originalTopic;
        }

        for (const [existingTopic, data] of Object.entries(topicMap)) {
            if (this.areTopicsSimilar(normalized, existingTopic) || 
                data.relatedTerms.some(term => this.areTopicsSimilar(normalized, term))) {
                return data.originalTopic;
            }
        }

        return null;
    }

    static areTopicsSimilar(topic1, topic2) {
        const normalize = (text) => text.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .split(' ')
            .filter(word => !this.commonWords.includes(word))
            .join(' ');

        const n1 = normalize(topic1);
        const n2 = normalize(topic2);

        if (n1.includes(n2) || n2.includes(n1)) return true;

        const words1 = new Set(n1.split(' '));
        const words2 = new Set(n2.split(' '));
        const intersection = new Set([...words1].filter(x => words2.has(x)));

        return intersection.size > 0;
    }

    static async getChildMemoryGraph(childId) {
        try {
            const result = await pool.query(
                `SELECT 
                    topic,
                    category,
                    details,
                    engagement_count,
                    (NOW() - last_seen) as recency
                 FROM long_term_memory_graph
                 WHERE child_id = $1
                 ORDER BY engagement_count DESC, last_seen DESC`,
                [childId]
            );

            return this.formatMemoriesForContext(result.rows);
        } catch (error) {
            console.error('Error getting memory graph:', error);
            return {
                mainInterests: [],
                recentLearning: [],
                knowledgeGraph: {}
            };
        }
    }

    static formatMemoriesForContext(memories) {
        try {
            const mainInterests = memories
                .filter(m => m.engagement_count > 3)
                .map(m => m.topic);

            const recentLearning = memories
                .filter(m => {
                    const diffDays = this.getDaysFromInterval(m.recency);
                    return diffDays < 7;
                })
                .map(m => {
                    const details = typeof m.details === 'string' ? JSON.parse(m.details) : m.details;
                    return details.knowledge_bits[details.knowledge_bits.length - 1];
                });

            const knowledgeGraph = memories.reduce((acc, m) => {
                const details = typeof m.details === 'string' ? JSON.parse(m.details) : m.details;
                acc[m.topic] = {
                    engagement: m.engagement_count,
                    details
                };
                return acc;
            }, {});

            return {
                mainInterests,
                recentLearning,
                knowledgeGraph
            };
        } catch (error) {
            console.error('Error formatting memories:', error);
            return {
                mainInterests: [],
                recentLearning: [],
                knowledgeGraph: {}
            };
        }
    }

    static async updateExistingTopic(childId, existingTopic, newTopic, insights, existingData) {
        try {
            const details = existingData.details;
            const newKnowledgeBit = {
                fact: insights.knowledge_bits[newTopic],
                learned_at: new Date().toISOString()
            };

            if (!details.knowledge_bits.some(kb => kb.fact === newKnowledgeBit.fact)) {
                details.knowledge_bits.push(newKnowledgeBit);
            }

            const newSubTopics = insights.sub_topics[newTopic] || [];
            details.sub_topics = [...new Set([...details.sub_topics, ...newSubTopics])];

            const newRelatedInterests = insights.related_interests[newTopic] || [];
            details.related_interests = [...new Set([...details.related_interests, ...newRelatedInterests])];

            await pool.query(
                `UPDATE long_term_memory_graph 
                 SET details = $1::jsonb,
                     last_seen = NOW(),
                     engagement_count = engagement_count + 1
                 WHERE child_id = $2 AND topic = $3`,
                [details, childId, existingTopic]
            );
        } catch (error) {
            console.error('Error updating existing topic:', error);
            throw error;
        }
    }

    static getDaysFromInterval(interval) {
        // interval may be returned as a Postgres interval object or a numeric
        // fallback to 0 if cannot parse
        if (!interval) return 0;
        if (typeof interval === 'object' && interval.days !== undefined) {
            return interval.days;
        }
        return 0;
    }

    static isGenericTopic(topic) {
        const genericTopics = [
            'greetings', 'conversation', 'communication', 'discussion',
            'engagement', 'interaction', 'flexibility', 'response', 
            'chat', 'talking', 'speaking'
        ];

        return genericTopics.some(g => topic.toLowerCase().includes(g));
    }

    static commonWords = [
        'the', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of',
        'with', 'by', 'about', 'like', 'through', 'over', 'before',
        'between', 'after', 'since', 'without', 'under', 'within',
        'along', 'following', 'across', 'behind', 'beyond', 'plus',
        'except', 'but', 'up', 'down', 'in', 'out', 'on', 'off',
        'over', 'under', 'again', 'further', 'then', 'once'
    ];
}

module.exports = LongTermMemoryModel;
