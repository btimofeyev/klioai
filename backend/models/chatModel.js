const pool = require("../config/db");
const OpenAI = require("openai");
const ContentFilter = require("../utils/contentFilter");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class ChatModel {
  static async initializeDatabase() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER REFERENCES children(id),
                    start_time TIMESTAMP DEFAULT NOW(),
                    end_time TIMESTAMP,
                    message_count INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'ended', 'summarized'))
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    conversation_id INTEGER REFERENCES conversations(id),
                    child_id INTEGER REFERENCES children(id),
                    role VARCHAR(50) NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS chat_summaries (
                    id SERIAL PRIMARY KEY,
                    child_id INTEGER REFERENCES children(id),
                    conversation_id INTEGER REFERENCES conversations(id),
                    summary TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_conversations_child_status 
                ON conversations(child_id, status);
                
                CREATE INDEX IF NOT EXISTS idx_messages_conversation 
                ON chat_messages(conversation_id);
                
                CREATE INDEX IF NOT EXISTS idx_summaries_child 
                ON chat_summaries(child_id);
            `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error initializing database:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async summarizeConversation(conversationId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const messages = await client.query(
        `
                SELECT cm.*, c.name as child_name, c.age, c.id as child_id
                FROM chat_messages cm
                JOIN conversations conv ON cm.conversation_id = conv.id
                JOIN children c ON conv.child_id = c.id
                WHERE cm.conversation_id = $1
                ORDER BY cm.timestamp ASC`,
        [conversationId]
      );

      if (messages.rows.length > 0) {
        const childData = {
          name: messages.rows[0].child_name,
          age: messages.rows[0].age,
          id: messages.rows[0].child_id,
        };

        const summary = await this.generateSummary(messages.rows, childData);

        const { rows: summaries } = await client.query(
          `SELECT id, summary FROM chat_summaries 
                     WHERE child_id = $1 
                     ORDER BY created_at ASC`,
          [childData.id]
        );

        if (summaries.length >= 5) {
          const summariesToProcess = summaries.slice(0, summaries.length - 4);
          const LongTermMemoryModel = require("./longTermMemoryModel");

          for (const oldSummary of summariesToProcess) {
            await LongTermMemoryModel.processNewSummary(
              childData.id,
              oldSummary.summary
            );
            await client.query(`DELETE FROM chat_summaries WHERE id = $1`, [
              oldSummary.id,
            ]);
          }
        }

        await client.query(
          `
                    INSERT INTO chat_summaries (child_id, conversation_id, summary)
                    VALUES ($1, $2, $3)`,
          [childData.id, conversationId, summary]
        );

        await client.query(
          `
                    DELETE FROM chat_summaries 
                    WHERE conversation_id = $1 
                    AND id NOT IN (
                      SELECT id FROM chat_summaries 
                      WHERE conversation_id = $1 
                      ORDER BY created_at DESC 
                      LIMIT 1
                    )`,
          [conversationId]
        );

        await client.query(
          `
                    UPDATE conversations 
                    SET status = 'summarized',
                        end_time = NOW()
                    WHERE id = $1`,
          [conversationId]
        );

        await client.query(
          `
                    DELETE FROM chat_messages 
                    WHERE conversation_id = $1`,
          [conversationId]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error in summarizeConversation:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async cleanupOldData() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(`
                SELECT DISTINCT c.id
                FROM conversations c
                JOIN chat_messages cm ON c.id = cm.conversation_id
                WHERE c.status = 'summarized'
            `);

      for (const row of result.rows) {
        await client.query(
          "DELETE FROM chat_messages WHERE conversation_id = $1",
          [row.id]
        );
      }

      await client.query(`
                DELETE FROM chat_messages
                WHERE conversation_id IN (
                    SELECT id FROM conversations 
                    WHERE status = 'ended' OR status = 'summarized'
                )
            `);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error during cleanup:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async startNewConversation(childId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
                UPDATE conversations 
                SET status = 'ended', end_time = NOW() 
                WHERE child_id = $1 AND status = 'active'`,
        [childId]
      );

      const result = await client.query(
        `
                INSERT INTO conversations (child_id) 
                VALUES ($1) 
                RETURNING id`,
        [childId]
      );

      await client.query("COMMIT");
      return result.rows[0].id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async getActiveConversation(childId) {
    const result = await pool.query(
      `
            SELECT * FROM conversations
            WHERE child_id = $1 AND status = 'active'
            ORDER BY start_time DESC
            LIMIT 1`,
      [childId]
    );
    return result.rows[0];
  }

  static async endConversation(conversationId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await this.summarizeConversation(conversationId);

      const messageCount = await client.query(
        `SELECT COUNT(*) FROM chat_messages WHERE conversation_id = $1`,
        [conversationId]
      );

      if (messageCount.rows[0].count > 0) {
        await client.query(
          "DELETE FROM chat_messages WHERE conversation_id = $1",
          [conversationId]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error ending conversation:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async saveMessage(childId, conversationId, content, role) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
                INSERT INTO chat_messages (child_id, conversation_id, role, content)
                VALUES ($1, $2, $3, $4)`,
        [childId, conversationId, role, content]
      );

      const {
        rows: [conversation],
      } = await client.query(
        `
                UPDATE conversations 
                SET message_count = message_count + 1
                WHERE id = $1
                RETURNING message_count`,
        [conversationId]
      );

      if (conversation.message_count % 25 === 0) {
        const messages = await client.query(
          `
                    SELECT cm.*, c.name as child_name, c.age 
                    FROM chat_messages cm
                    JOIN conversations conv ON cm.conversation_id = conv.id
                    JOIN children c ON conv.child_id = c.id
                    WHERE cm.conversation_id = $1
                    ORDER BY cm.timestamp ASC`,
          [conversationId]
        );

        if (messages.rows.length > 0) {
          const childData = {
            name: messages.rows[0].child_name,
            age: messages.rows[0].age,
          };

          const summary = await this.generateSummary(messages.rows, childData);

          await client.query(
            `
                        INSERT INTO chat_summaries (child_id, conversation_id, summary)
                        VALUES ($1, $2, $3)`,
            [childId, conversationId, summary]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async getConversationMessages(conversationId) {
    const result = await pool.query(
      `
            SELECT role, content, timestamp 
            FROM chat_messages 
            WHERE conversation_id = $1 
            ORDER BY timestamp ASC`,
      [conversationId]
    );
    return result.rows;
  }

  static async generateSummary(messages, childData) {
    const systemMsg = {
      role: "system",
      content: `Create a structured summary of ${childData.name}'s (age ${childData.age}) conversation for their parents. Use these exact sections:
      🚨 Topics of Concern
      💭 Topics Discussed
      📊 Engagement Level
      📚 Key Learning Points
      👪 Parent Tips`,
    };
    const userMsg = {
      role: "user",
      content: `Analyze this conversation: ${JSON.stringify(messages)}`,
    };

    const response = await openai.responses.create({
      model: "gpt-4.1-mini", // or your model
      input: [systemMsg, userMsg],
      text: { format: { type: "text" } },
      reasoning: {},
      tools: [],
      temperature: 0.7,
      max_output_tokens: 800,
      top_p: 1,
      store: false,
    });

    // If the API spec changes, check response format (content, or choices[0].content)
    return (
      response.content || (response.choices && response.choices[0].content)
    );
  }

  static async getFilterSettings(childId) {
    const pool = require("../config/db");
    try {
      console.log(
        `[ParentalControls] Fetching settings for child ID: ${childId}`
      );

      const result = await pool.query(
        `SELECT pc.filter_inappropriate, pc.block_personal_info
                 FROM parental_controls pc
                 WHERE pc.child_id = $1`,
        [childId]
      );

      console.log("[ParentalControls] Query result:", {
        rowCount: result.rows.length,
        settings: result.rows[0] || "No settings found",
      });

      const settings =
        result.rows.length === 0
          ? {
              filterInappropriate: true, // Default to true for safety
              blockPersonalInfo: true,
              source: "default",
            }
          : {
              filterInappropriate: result.rows[0].filter_inappropriate,
              blockPersonalInfo: result.rows[0].block_personal_info,
              source: "database",
            };

      console.log("[ParentalControls] Final settings:", settings);

      return settings;
    } catch (error) {
      console.error("Error getting filter settings:", error);
      return {
        filterInappropriate: true,
        blockPersonalInfo: true,
      };
    }
  }

  static async generateAIResponse(messages, childData) {
    try {
      const LongTermMemoryModel = require("./longTermMemoryModel");
      const memoryGraph = await LongTermMemoryModel.getChildMemoryGraph(
        childData.id
      );
      const filterSettings = await this.getFilterSettings(childData.id);
      const recentMessages = messages.slice(-20);

      const systemMessage = {
        role: "system",
        content: `You are Klio, a helpful, child-friendly AI assistant.
                         Age: ${childData.age}
                         Interests: ${memoryGraph.mainInterests.join(", ")}
                         Recent learning: ${memoryGraph.recentLearning
                           .map((l) => l.fact)
                           .join("; ")}

                         ${
                           filterSettings.filterInappropriate
                             ? `
                         Content Filtering Instructions:
                         - IMMEDIATELY REDIRECT any discussions about:
                           * Violence, weapons, or fighting
                           * Death, injury, or harm
                           * Adult themes or inappropriate content
                           * Hate speech or bullying
                           * Dangerous or risky behavior

                         When these topics arise:
                         1. Acknowledge curiosity briefly
                         2. Redirect to a safe, related topic
                         3. Use format: "I understand you're curious, but let's talk about [safe alternative] instead! Did you know [interesting fact about safe topic]?"`
                             : ""
                         }

                         ${
                           filterSettings.blockPersonalInfo
                             ? `
                         Personal Information Protection:
                         - Never request personal information
                         - If personal information is shared (addresses, phone numbers, email, social media, school names):
                           1. Gently discourage sharing such information
                           2. Redirect the conversation
                           3. Do not repeat or reference the shared personal information`
                             : ""
                         }

                         Additional Guidelines:
                         - Keep responses friendly, educational, and age-appropriate
                         - Be concise but engaging
                         - Focus on positive learning experiences
                         - Encourage safe, educational discussions`,
      };

      const formattedMessages = recentMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const stream = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [systemMessage, ...formattedMessages],
        temperature: 0.7,
        stream: true,
      });

      return stream;
    } catch (error) {
      console.error("Error generating AI response:", error);
      throw new Error("Failed to generate AI response");
    }
  }

  static async generateSuggestions(aiResponse, childData) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content: `Generate 3 potential questions or prompts that a ${childData.age}-year-old child might want to ask you based on the conversation.
                        Rules:
                        - These should be questions/prompts the child could ask YOU (the AI)
                        - Keep them relevant to the previous response
                        - Use child-friendly language
                        - Make them interesting and engaging
                        - No questions about personal information
                        - Focus on exploration and learning
                        - Keep them short and clear
                        
                        Return exactly 3 suggestions as JSON:
                        {
                          "suggestions": [
                            "suggestion 1",
                            "suggestion 2",
                            "suggestion 3"
                          ]
                        }`,
          },
          {
            role: "user",
            content: `Based on your previous response: "${aiResponse}"\nGenerate engaging suggestions for what the child might want to ask or explore next.`,
          },
        ],
        temperature: 0.7,
      });

      const rawContent = completion.choices[0].message.content
        .replace(/```json|```/g, "")
        .trim();
      const suggestions = JSON.parse(rawContent).suggestions;

      if (Array.isArray(suggestions)) {
        return suggestions.map((suggestion) => {
          let formatted = suggestion.trim();
          formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
          // Don't automatically add question marks as some might be prompts
          return formatted;
        });
      } else {
        return getDefaultSuggestions(childData.age);
      }
    } catch (error) {
      console.error("Error generating suggestions:", error);
      return getDefaultSuggestions(childData.age);
    }
  }

  static async getSummaries(childId, limit = 10) {
    try {
      const result = await pool.query(
        `
                SELECT 
                    s.id,
                    s.summary,
                    s.created_at,
                    c.start_time,
                    c.end_time,
                    c.message_count,
                    (
                        SELECT string_agg(DISTINCT content, ' | ')
                        FROM (
                            SELECT content
                            FROM chat_messages 
                            WHERE conversation_id = c.id AND role = 'user'
                            ORDER BY timestamp DESC LIMIT 3
                        ) recent_messages
                    ) as recent_topics
                FROM chat_summaries s
                JOIN conversations c ON s.conversation_id = c.id
                WHERE s.child_id = $1
                ORDER BY s.created_at DESC
                LIMIT $2`,
        [childId, limit]
      );

      return result.rows.map((row) => ({
        id: row.id,
        summary: row.summary,
        when: this.formatTimestamp(row.created_at),
        duration: this.calculateDuration(row.start_time, row.end_time),
        messageCount: row.message_count,
        recentTopics: row.recent_topics,
        date: row.start_time.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      }));
    } catch (error) {
      console.error("Error getting summaries:", error);
      throw error;
    }
  }

  static calculateDuration(startTime, endTime) {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const minutes = Math.round((end - start) / (1000 * 60));

    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} hour${hours !== 1 ? "s" : ""} ${remainingMinutes} minute${
      remainingMinutes !== 1 ? "s" : ""
    }`;
  }

  static formatTimestamp(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));

    if (diffHours < 24) {
      if (diffHours === 0) {
        const diffMinutes = Math.floor((now - date) / (1000 * 60));
        return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
      }
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) {
        return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
      } else if (diffDays < 30) {
        const diffWeeks = Math.floor(diffDays / 7);
        return `${diffWeeks} week${diffWeeks !== 1 ? "s" : ""} ago`;
      } else {
        return date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }
    }
  }
}

function getDefaultSuggestions() {
  return [
    "Tell me more about that! 🤔",
    "That sounds cool! Why? ✨",
    "Can you explain it again? 🌟",
  ];
}

module.exports = ChatModel;
