// models/longTermMemoryModel.js
const pool = require("../config/db");
const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class LongTermMemoryModel {
    static async processNewSummary(childId, summary) {
        try {
            // Extract insights about interests and knowledge
            const insights = await this.extractInsights(summary);
            console.log('Initial insights:', insights);

            await pool.query('BEGIN');

            // Get existing topics for this child
            const existingTopics = await pool.query(
                `SELECT topic, details FROM long_term_memory_graph WHERE child_id = $1`,
                [childId]
            );

            // Create a map of similar topics
            const topicMap = this.createTopicMap(existingTopics.rows);
            console.log('Topic map:', topicMap);

            for (const topic of insights.topics) {
                // Skip generic conversational topics
                if (this.isGenericTopic(topic)) {
                    console.log(`Skipping generic topic: ${topic}`);
                    continue;
                }

                // Check for similar existing topics
                const matchingTopic = this.findMatchingTopic(topic, topicMap);
                console.log(`Topic: ${topic}, Matching topic: ${matchingTopic}`);

                if (matchingTopic) {
                    // Update existing topic with new information
                    await this.updateExistingTopic(
                        childId,
                        matchingTopic,
                        topic,
                        insights,
                        topicMap[matchingTopic]
                    );
                } else {
                    // Create new topic
                    const initialDetails = {
                        sub_topics: insights.sub_topics[topic] || [],
                        knowledge_bits: [{
                            fact: insights.knowledge_bits[topic],
                            learned_at: new Date().toISOString()
                        }],
                        engagement_level: "initial",
                        related_interests: insights.related_interests[topic] || []
                    };

                    await pool.query(
                        `INSERT INTO long_term_memory_graph 
                         (child_id, category, topic, details, first_seen, last_seen)
                         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
                        [childId, 'interest', topic, initialDetails]
                    );
                    console.log(`Created new topic: ${topic}`);
                }
            }

            await pool.query('COMMIT');
            console.log('Successfully processed summary into long-term memory');

        } catch (error) {
            await pool.query('ROLLBACK');
            console.error('Error processing new summary:', error);
            throw error;
        }
    }

    static async extractInsights(summary) {
        const systemMessage = {
            role: "system",
            content: `You are analyzing conversations to build a child's long-term memory profile.
                     Extract key insights about core interests and knowledge, not conversation styles.
                     
                     Focus on:
                     1. Main interests (science, space, animals, etc.)
                     2. Specific knowledge gained
                     3. Connected topics and subtopics
                     4. Depth of understanding

                     Return a JSON object with:
                     {
                         "topics": ["main interest/topic"],
                         "knowledge_bits": {
                             "topic": "specific new knowledge learned about this topic"
                         },
                         "sub_topics": {
                             "topic": ["specific aspects of this topic the child knows about"]
                         },
                         "related_interests": {
                             "topic": ["broader areas this connects to"]
                         }
                     }

                     Example:
                     For "Child discussed Mars' moons and showed interest in space exploration"
                     {
                         "topics": ["space exploration"],
                         "knowledge_bits": {
                             "space exploration": "Knows about Mars' moons and their characteristics"
                         },
                         "sub_topics": {
                             "space exploration": ["Mars", "moons", "planetary science"]
                         },
                         "related_interests": {
                             "space exploration": ["astronomy", "planetary science", "space technology"]
                         }
                     }
                     
                     DO NOT create topics about:
                     - Conversation styles
                     - Generic greetings
                     - Communication patterns
                     - Basic interactions`
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
        existingTopics.forEach(row => {
            const details = typeof row.details === 'string' ? 
                JSON.parse(row.details) : row.details;

            // Create normalized versions of topics and subtopics
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
        });
        return topicMap;
    }

    static findMatchingTopic(newTopic, topicMap) {
        const normalizedNew = newTopic.toLowerCase();

        // First check for exact matches
        if (topicMap[normalizedNew]) {
            return topicMap[normalizedNew].originalTopic;
        }

        // Then check for similar topics
        for (const [existingTopic, data] of Object.entries(topicMap)) {
            // Check if topics are similar
            if (this.areTopicsSimilar(normalizedNew, existingTopic)) {
                return data.originalTopic;
            }

            // Check if new topic is related to existing topic
            if (data.relatedTerms.some(term => 
                this.areTopicsSimilar(normalizedNew, term)
            )) {
                return data.originalTopic;
            }
        }

        return null;
    }

    static areTopicsSimilar(topic1, topic2) {
        const normalize = (text) => {
            return text.toLowerCase()
                .replace(/[^a-z0-9 ]/g, '')
                .split(' ')
                .filter(word => !this.commonWords.includes(word))
                .join(' ');
        };

        const normalized1 = normalize(topic1);
        const normalized2 = normalize(topic2);

        // Check for substring matches
        if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
            return true;
        }

        // Check for word similarity
        const words1 = new Set(normalized1.split(' '));
        const words2 = new Set(normalized2.split(' '));
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
                    const recency = typeof m.recency === 'object' ? 
                        m.recency.days || 0 : 0;
                    return recency < 7;
                })
                .map(m => {
                    const details = typeof m.details === 'string' ? 
                        JSON.parse(m.details) : m.details;
                    return details.knowledge_bits[details.knowledge_bits.length - 1];
                });

            const knowledgeGraph = memories.reduce((acc, m) => {
                const details = typeof m.details === 'string' ? 
                    JSON.parse(m.details) : m.details;
                
                acc[m.topic] = {
                    engagement: m.engagement_count,
                    details: details
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

            // Add new knowledge if it doesn't exist
            if (!details.knowledge_bits.some(kb => kb.fact === newKnowledgeBit.fact)) {
                details.knowledge_bits.push(newKnowledgeBit);
            }

            // Add new subtopics
            const newSubTopics = insights.sub_topics[newTopic] || [];
            details.sub_topics = [...new Set([...details.sub_topics, ...newSubTopics])];

            // Add new related interests
            const newRelatedInterests = insights.related_interests[newTopic] || [];
            details.related_interests = [...new Set([...details.related_interests, ...newRelatedInterests])];

            // Update the topic in the database
            await pool.query(
                `UPDATE long_term_memory_graph 
                 SET details = $1::jsonb,
                     last_seen = NOW(),
                     engagement_count = engagement_count + 1
                 WHERE child_id = $2 AND topic = $3`,
                [details, childId, existingTopic]
            );

            console.log(`Updated existing topic: ${existingTopic} with new information`);
        } catch (error) {
            console.error('Error updating existing topic:', error);
            throw error;
        }
    }

    static isGenericTopic(topic) {
        const genericTopics = [
            'greetings',
            'conversation',
            'communication',
            'discussion',
            'engagement',
            'interaction',
            'flexibility',
            'response',
            'chat',
            'talking',
            'speaking'
        ];

        return genericTopics.some(generic => 
            topic.toLowerCase().includes(generic.toLowerCase())
        );
    }

    // Common words to ignore in topic matching
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