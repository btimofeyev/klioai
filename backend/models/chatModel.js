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

      // Create tables
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
      console.log("Database initialization completed successfully");
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
      await client.query('BEGIN');

      // Get all messages from the conversation
      const messages = await client.query(`
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
          id: messages.rows[0].child_id
        };

        // Generate comprehensive summary
        const summary = await this.generateSummary(messages.rows, childData);

        // Get existing summaries count
        const { rows: summaries } = await client.query(
          `SELECT id, summary FROM chat_summaries 
           WHERE child_id = $1 
           ORDER BY created_at ASC`,
          [childData.id]
        );

        // If we have 5 or more summaries
        if (summaries.length >= 5) {
          // Process all but the 4 most recent summaries into long-term memory
          const summariesToProcess = summaries.slice(0, summaries.length - 4);
          const LongTermMemoryModel = require("./longTermMemoryModel");
          
          for (const oldSummary of summariesToProcess) {
            // Process into long-term memory
            await LongTermMemoryModel.processNewSummary(childData.id, oldSummary.summary);
            
            // Delete the processed summary
            await client.query(
              `DELETE FROM chat_summaries WHERE id = $1`,
              [oldSummary.id]
            );
          }
        }

        // Save new final summary
        await client.query(`
                INSERT INTO chat_summaries (
                    child_id, 
                    conversation_id, 
                    summary
                ) VALUES ($1, $2, $3)`,
          [childData.id, conversationId, summary]
        );

        // Delete interim summaries for this conversation
        await client.query(`
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

        // Update conversation status
        await client.query(`
                UPDATE conversations 
                SET status = 'summarized',
                    end_time = NOW()
                WHERE id = $1`,
          [conversationId]
        );

        // Delete all messages for this conversation
        await client.query(`
                DELETE FROM chat_messages 
                WHERE conversation_id = $1`,
          [conversationId]
        );

        console.log(`Deleted messages and interim summaries for conversation ${conversationId} after final summarization`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in summarizeConversation:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  static async cleanupOldData() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find conversations that are summarized but still have messages
      const result = await client.query(`
          SELECT DISTINCT c.id
          FROM conversations c
          JOIN chat_messages cm ON c.id = cm.conversation_id
          WHERE c.status = 'summarized'
      `);

      for (const row of result.rows) {
        console.log(`Cleaning up messages for summarized conversation ${row.id}`);
        await client.query(
          'DELETE FROM chat_messages WHERE conversation_id = $1',
          [row.id]
        );
      }

      // Delete any orphaned messages (if any)
      await client.query(`
          DELETE FROM chat_messages
          WHERE conversation_id IN (
              SELECT id FROM conversations 
              WHERE status = 'ended' OR status = 'summarized'
          )
      `);

      await client.query('COMMIT');
      console.log('Cleanup completed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error during cleanup:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  // Conversation Management
  static async startNewConversation(childId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // End any active conversations
      await client.query(
        `
        UPDATE conversations 
        SET status = 'ended', end_time = NOW() 
        WHERE child_id = $1 AND status = 'active'`,
        [childId]
      );

      // Create new conversation
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
      await client.query('BEGIN');

      // Generate summary first
      await this.summarizeConversation(conversationId);

      // Verify cleanup
      const messageCount = await client.query(
        `SELECT COUNT(*) FROM chat_messages WHERE conversation_id = $1`,
        [conversationId]
      );

      if (messageCount.rows[0].count > 0) {
        console.log(`Found ${messageCount.rows[0].count} remaining messages, cleaning up...`);
        await client.query(
          'DELETE FROM chat_messages WHERE conversation_id = $1',
          [conversationId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error ending conversation:', error);
      throw error;
    } finally {
      client.release();
    }
  }


  // Message Management
  static async saveMessage(childId, conversationId, content, role) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Save message
      await client.query(
        `
        INSERT INTO chat_messages (child_id, conversation_id, role, content)
        VALUES ($1, $2, $3, $4)`,
        [childId, conversationId, role, content]
      );

      // Update message count
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

      // If message count reaches 25, create a summary but keep conversation active
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

  // Summary and AI Interaction
  static async generateSummary(messages, childData) {
    const systemMessage = {
      role: "system",
      content: `Create a structured summary of ${childData.name}'s (age ${childData.age}) conversation for their parents.
               
               Format the summary with these EXACT sections:

               🚨 Topics of Concern (if any):
               - List any concerning topics the child brought up (violence, personal info sharing, etc.)
               - For each topic, note frequency and context
               - If none, write "No concerning topics discussed"

               💭 Topics Discussed:
               - List the main topics covered in bullet points
               - Keep topics concise (1-3 words each)
               - Example: "Space Exploration", "Math", "Dinosaurs"

               📊 Engagement Level:
               - Rate as: "High", "Medium", or "Moderate"
               - Brief explanation of engagement

               📚 Key Learning Points:
               - Bullet points of main concepts learned
               - Skills demonstrated
               - New interests discovered
               
               👪 Parent Tips:
               - Specific suggestions based on conversation content
               - Ways to address any concerning topics appropriately
               - Topics to explore further
               - Resources or activities to support interests

               Keep sections clearly separated by double newlines.
               If concerning topics were discussed, make specific recommendations for parent follow-up.`,
    };

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        systemMessage,
        {
          role: "user",
          content: `Analyze this conversation carefully for both educational content and any concerning topics: ${JSON.stringify(messages)}`,
        },
      ],
      max_tokens: 800,
      temperature: 0.7,
    });

    return completion.choices[0].message.content;
  }

  static async generateAIResponse(messages, childData) {
    try {
      const LongTermMemoryModel = require("./longTermMemoryModel");
      const memoryGraph = await LongTermMemoryModel.getChildMemoryGraph(
        childData.id
      );

      console.log('\n=== Child Memory Information ===');
      console.log('Child:', { name: childData.name, age: childData.age, id: childData.id });
      console.log('Main Interests:', memoryGraph.mainInterests);
      console.log('Recent Learning:', memoryGraph.recentLearning);
      console.log('Full Knowledge Graph:', JSON.stringify(memoryGraph.knowledgeGraph, null, 2));
      console.log('================================\n');

      const recentMessages = messages.slice(-20);

      // Get filter settings first
      const filterSettings = await ContentFilter.getFilterSettings(childData.id);

      // Build comprehensive system message with content filtering rules
      const systemMessage = {
        role: "system",
        content: `You are Klio, a helpful AI assistant. You are a child-friendly AI that helps children learn. Never give direct answers, instead give suggestions and directions. You are chatting with ${childData.name} (age ${childData.age}).\nPrevious interests: ${memoryGraph.mainInterests.join(", ")}\nRecent learning: ${memoryGraph.recentLearning.map((l) => l.fact).join("; ")}\n\n${filterSettings.filterInappropriate ? `As a strict content moderator and child-friendly AI:\n1. IMMEDIATELY REDIRECT any discussions about:\n * Violence, weapons, or fighting\n * Death, injury, or harm\n * Adult themes or inappropriate content\n * Hate speech or bullying\n * Dangerous or risky behavior\n\nWhen these topics arise:\n1. Acknowledge their curiosity briefly\n2. Redirect to a safe, related topic\n3. Use this format: "I understand you're curious, but let's talk about [safe alternative] instead! Did you know [interesting fact about safe topic]?"` : ''}\n\n${filterSettings.blockPersonalInfo ? `Never request or encourage sharing of personal information such as:\n- Addresses\n- Phone numbers\n- Email addresses\n- Social media handles\n- School names\n- Other identifying details\n\nIf such information is shared, respond with: "To keep you safe, let's not share personal information. Instead, tell me about [safe alternative topic]."` : ''}\n\nKeep all responses friendly, educational, and age-appropriate.`
      };

      // Format messages for OpenAI
      const formattedMessages = recentMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const response = await openai.chat.completions.create({
        model: "chatgpt-4o-latest",
        messages: [
          systemMessage,
          ...formattedMessages,
        ],
        max_tokens: 550,
        temperature: 0.7,
      });

      if (!response.choices[0]?.message?.content) {
        throw new Error("No response generated");
      }

      return response.choices[0].message.content;
    } catch (error) {
      console.error("Error generating AI response:", error);
      throw new Error("Failed to generate AI response");
    }
  }

  static async generateSuggestions(aiResponse, childData) {
    try {
      console.log("Starting suggestion generation...");
      console.log("AI Response:", aiResponse);
      console.log("Child Data:", childData);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are helping create follow-up questions users can ask AI to continue the conversation. Based on the AI's previous response, suggest 3 thoughtful and engaging questions the user can ask next. Use emojis only if needed, Keep the suggestions child-friendly, creative, and formatted as:
            {
              "suggestions": [
                "Suggested question 1?",
                "Suggested question 2?",
                "Suggested question 3?"
              ]
            }`,
          },
          {
            role: "user",
            content: `Based on this response: "${aiResponse}"`,
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });

      console.log("Completion Response:", JSON.stringify(completion, null, 2));

      // Extract raw content
      const rawContent = completion.choices[0].message.content;
      console.log("Raw Content from AI:", rawContent);

      // Remove backticks and code block indicators if present
      const cleanContent = rawContent.replace(/```json|```/g, "").trim();
      console.log("Clean Content after removing code blocks:", cleanContent);

      // Attempt to parse the cleaned JSON
      const suggestions = JSON.parse(cleanContent).suggestions;

      console.log("Parsed Suggestions:", suggestions);

      // Check if suggestions is an array
      if (Array.isArray(suggestions)) {
        console.log("Suggestions successfully parsed.");
        return suggestions;
      } else {
        console.error(
          "Suggestions is not an array. Returning default suggestions."
        );
        return getDefaultSuggestions();
      }
    } catch (error) {
      console.error("Error generating suggestions:", error);
      return getDefaultSuggestions();
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
                        WHERE conversation_id = c.id 
                        AND role = 'user'
                        ORDER BY timestamp DESC
                        LIMIT 3
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

    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
    }
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
