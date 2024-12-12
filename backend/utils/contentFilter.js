const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class ContentFilter {
    static async filterContent(content, filterSettings) {
        const { filterInappropriate, blockPersonalInfo } = filterSettings;

        if (!filterInappropriate && !blockPersonalInfo) {
            return content;
        }

        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `You are a strict content filtering system for a children's chat application. Your task is to:
                        ${filterInappropriate ? `
                        - IMMEDIATELY REDIRECT any discussions about:
                          * Violence, weapons, or fighting
                          * Death, injury, or harm
                          * Adult themes or inappropriate content
                          * Hate speech or bullying
                          * Dangerous or risky behavior
                        
                        Instead of engaging with these topics:
                        1. Acknowledge their curiosity briefly
                        2. Redirect to a safe, related topic
                        3. Use this template: "I understand you're curious, but let's talk about [safe alternative] instead! Did you know [interesting fact about safe topic]?"
                        
                        Example:
                        Input: "Let's talk about fighting"
                        Output: "I understand you're curious, but let's talk about teamwork instead! Did you know that many sports teach us how to work together and solve problems without fighting?"` : ''}
                        
                        ${blockPersonalInfo ? '- Remove any personal information EXCEPT name and age, including: addresses, phone numbers, email addresses, social media handles, school names, or other identifying details. Replace with [REMOVED].' : ''}
                        
                        If no filtering is needed, return the original content.
                        Always maintain a positive, educational tone.`
                    },
                    {
                        role: "user",
                        content: content
                    }
                ],
                max_tokens: 500,
                temperature: 0.3
            });

            return completion.choices[0].message.content;
        } catch (error) {
            console.error("Error in content filtering:", error);
            // For safety, if filtering fails and inappropriate content filter is on,
            // return a safe default message
            if (filterInappropriate) {
                return "I'd love to chat about something fun and positive! What interests you? We could talk about science, art, music, or any other topics you enjoy!";
            }
            return content;
        }
    }

    static async getFilterSettings(childId) {
        const pool = require("../config/db");
        try {
            const result = await pool.query(
                `SELECT pc.filter_inappropriate, pc.block_personal_info
                 FROM parental_controls pc
                 WHERE pc.child_id = $1`,
                [childId]
            );

            if (result.rows.length === 0) {
                return {
                    filterInappropriate: true, // Default to true for safety
                    blockPersonalInfo: true
                };
            }

            return {
                filterInappropriate: result.rows[0].filter_inappropriate,
                blockPersonalInfo: result.rows[0].block_personal_info
            };
        } catch (error) {
            console.error("Error getting filter settings:", error);
            return {
                filterInappropriate: true, // Default to true for safety
                blockPersonalInfo: true
            };
        }
    }
}

module.exports = ContentFilter;
