const pool = require("../config/db");
const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class LongTermMemoryModel {
    static async processNewSummary(childId, summary) {
        const client = await pool.connect();
        try {
            console.log('[ProcessNewSummary] Starting for childId:', childId);
            const insights = await this.extractInsights(summary);
            
            if (!insights || typeof insights !== 'object') {
                console.error('[ProcessNewSummary] Invalid insights structure:', insights);
                return;
            }

            await client.query('BEGIN');

            const existingTopicsRes = await client.query(
                `SELECT topic, details FROM long_term_memory_graph WHERE child_id = $1`,
                [childId]
            );

            console.log('[ProcessNewSummary] Existing topics found:', existingTopicsRes.rows.length);
            const topicMap = this.createTopicMap(existingTopicsRes.rows);

            const topics = Array.isArray(insights.topics) ? insights.topics : 
                          (insights.topics ? Object.keys(insights.topics) : []);

            console.log('[ProcessNewSummary] Processing topics:', topics);

            for (const topic of topics) {
                if (!topic || this.isGenericTopic(topic)) {
                    console.log('[ProcessNewSummary] Skipping generic topic:', topic);
                    continue;
                }

                const matchingTopic = this.findMatchingTopic(topic, topicMap);
                console.log('[ProcessNewSummary] Matching topic found:', matchingTopic);

                if (matchingTopic && topicMap[matchingTopic.toLowerCase()]) {
                    await this.updateExistingTopic(
                        client,
                        childId,
                        matchingTopic,
                        topic,
                        insights,
                        topicMap[matchingTopic.toLowerCase()]
                    );
                } else {
                    console.log('[ProcessNewSummary] Creating new topic:', topic);
                    const initialDetails = {
                        sub_topics: (insights.sub_topics?.[topic] || []),
                        knowledge_bits: [{
                            fact: insights.knowledge_bits?.[topic] || 'Discussed this topic',
                            learned_at: new Date().toISOString()
                        }],
                        engagement_level: "initial",
                        related_interests: (insights.related_interests?.[topic] || [])
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
            console.log('[ProcessNewSummary] Successfully completed for childId:', childId);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[ProcessNewSummary] Error:', error);
            throw error;
        } finally {
            client.release();
        }
    }
    static async extractInsights(summary) {
        const systemMessage = {
            role: "system",
            content: `You are analyzing conversations to build a child's long-term memory profile.
                     Extract and return a JSON object with the following structure:
                     {
                         "topics": [],             // Array of main topics discussed
                         "sub_topics": {},         // Object mapping topics to their subtopics
                         "knowledge_bits": {},     // Object mapping topics to key learnings
                         "related_interests": {}   // Object mapping topics to related interests
                     }
                     Focus on subject matter interests and ignore generic conversation patterns.`
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

            const insights = JSON.parse(completion.choices[0].message.content);
            
 
            return {
                topics: insights.topics || [],
                sub_topics: insights.sub_topics || {},
                knowledge_bits: insights.knowledge_bits || {},
                related_interests: insights.related_interests || {}
            };
        } catch (error) {
            console.error('Error extracting insights:', error);
            // Return a valid but empty structure instead of throwing
            return {
                topics: [],
                sub_topics: {},
                knowledge_bits: {},
                related_interests: {}
            };
        }
    }
    static createTopicMap(existingTopics) {
        const topicMap = {};
        for (const row of existingTopics) {
            if (!row || !row.topic) continue;
            
            try {
                const details = typeof row.details === 'string' ? 
                    JSON.parse(row.details) : 
                    (row.details || { sub_topics: [], related_interests: [] });

                const mainTopic = row.topic.toLowerCase();
                const relatedTerms = [
                    ...(details.sub_topics || []).map(st => st.toLowerCase()),
                    ...(details.related_interests || []).map(ri => ri.toLowerCase())
                ];

                topicMap[mainTopic] = {
                    originalTopic: row.topic,
                    relatedTerms,
                    details
                };
            } catch (error) {
                console.error('[CreateTopicMap] Error processing row:', error);
                continue;
            }
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

    static async updateExistingTopic(client, childId, existingTopic, newTopic, insights, existingData) {
        try {
            console.log('[UpdateExistingTopic] Starting update for:', {
                childId,
                existingTopic,
                newTopic,
                hasExistingData: !!existingData
            });

            if (!existingData || !existingData.details) {
                console.log('[UpdateExistingTopic] No existing data, creating new details object');
                existingData = {
                    details: {
                        sub_topics: [],
                        knowledge_bits: [],
                        engagement_level: "initial",
                        related_interests: []
                    }
                };
            }

            const details = existingData.details;
            const newKnowledgeBit = {
                fact: insights.knowledge_bits?.[newTopic] || 'Continued discussion on this topic',
                learned_at: new Date().toISOString()
            };

            details.knowledge_bits = Array.isArray(details.knowledge_bits) ? 
                details.knowledge_bits : [];

            if (!details.knowledge_bits.some(kb => kb.fact === newKnowledgeBit.fact)) {
                details.knowledge_bits.push(newKnowledgeBit);
            }

            const newSubTopics = insights.sub_topics?.[newTopic] || [];
            details.sub_topics = [...new Set([...(details.sub_topics || []), ...newSubTopics])];

            const newRelatedInterests = insights.related_interests?.[newTopic] || [];
            details.related_interests = [...new Set([...(details.related_interests || []), ...newRelatedInterests])];

            await client.query(
                `UPDATE long_term_memory_graph 
                 SET details = $1::jsonb,
                     last_seen = NOW(),
                     engagement_count = COALESCE(engagement_count, 0) + 1
                 WHERE child_id = $2 AND topic = $3`,
                [details, childId, existingTopic]
            );

            console.log('[UpdateExistingTopic] Successfully updated topic:', existingTopic);
        } catch (error) {
            console.error('[UpdateExistingTopic] Error:', error);
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
