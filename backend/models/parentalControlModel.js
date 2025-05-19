// parentalControlModel.js
const pool = require('../config/db');

class ParentalControl {
    // Initializes with default values if the record doesn't exist, or does nothing if it exists.
    // Returns the current state of controls after ensuring initialization.
    static async initDefaults(childId, dbClient = pool) {
        if (!childId) throw new Error('Child ID is required to initialize parental controls');

        const insertQuery = `
            INSERT INTO parental_controls (
                child_id, filter_inappropriate, block_personal_info, message_limit,
                allowed_start_time, allowed_end_time, created_at, updated_at
            )
            VALUES ($1, true, true, 50, '09:00:00', '21:00:00', NOW(), NOW())
            ON CONFLICT (child_id) DO NOTHING; 
        `;
        // The ON CONFLICT DO NOTHING will not return rows if there's a conflict.
        
        await dbClient.query(insertQuery, [childId]);

        // Always fetch the current state to ensure we return the actual controls
        const selectQuery = `SELECT * FROM parental_controls WHERE child_id = $1`;
        const { rows: selectRows } = await dbClient.query(selectQuery, [childId]);

        if (selectRows.length === 0) {
            // This state should be rare if the INSERT or prior existence was true.
            // Could indicate an issue, e.g., childId doesn't exist in parent `children` table if FKs are strict.
            throw new Error(`Failed to find or initialize parental controls for childId ${childId} after initDefaults attempt.`);
        }
        return selectRows[0];
    }

    static async findByChildId(childId, dbClient = pool) {
        if (!childId) throw new Error('Child ID is required to fetch parental controls');
        const controlsQuery = `SELECT * FROM parental_controls WHERE child_id = $1`;
        try {
            const { rows } = await dbClient.query(controlsQuery, [childId]);
            if (rows.length === 0) {
                // If not found, initialize with defaults and return those.
                return await this.initDefaults(childId, dbClient);
            }
            return rows[0];
        } catch (error) {
            console.error(`Error fetching parental controls for childId ${childId}:`, error);
            throw new Error(`Error fetching parental controls: ${error.message}`);
        }
    }

    // Updates specific fields using an UPSERT approach.
    static async update(childId, data, dbClient = pool) {
        if (!childId) throw new Error('Child ID is required to update parental controls');

        // Define structure and defaults for data handling
        const filterInappropriate = data.filterInappropriate !== undefined ? !!data.filterInappropriate : true;
        const blockPersonalInfo = data.blockPersonalInfo !== undefined ? !!data.blockPersonalInfo : true;
        const messageLimit = data.messageLimit !== undefined ? parseInt(data.messageLimit, 10) : 50;
        const allowedStartTime = data.allowedHours?.start || '09:00:00';
        const allowedEndTime = data.allowedHours?.end || '21:00:00';

        const query = `
            INSERT INTO parental_controls (
                child_id, filter_inappropriate, block_personal_info, message_limit,
                allowed_start_time, allowed_end_time, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            ON CONFLICT (child_id) DO UPDATE SET
                filter_inappropriate = EXCLUDED.filter_inappropriate,
                block_personal_info = EXCLUDED.block_personal_info,
                message_limit = EXCLUDED.message_limit,
                allowed_start_time = EXCLUDED.allowed_start_time,
                allowed_end_time = EXCLUDED.allowed_end_time,
                updated_at = NOW()
            RETURNING *;
        `;
        const values = [
            childId, filterInappropriate, blockPersonalInfo, messageLimit,
            allowedStartTime, allowedEndTime
        ];

        try {
            const { rows } = await dbClient.query(query, values);
            if (rows.length === 0) {
                // UPSERT with RETURNING * should always return a row if childId is valid (e.g. exists in children table for FK)
                throw new Error(`Failed to update/insert parental controls for childId ${childId}. This might indicate an issue with childId validity (e.g., Foreign Key constraint violation if childId does not exist in 'children' table).`);
            }
            return rows[0];
        } catch (error) {
            console.error(`Error updating parental controls for childId ${childId}:`, error);
            throw new Error(`Error updating parental controls: ${error.message}`);
        }
    }

    // getDailyMessages and getActiveSession are read-only and might not strictly need transaction client
    // unless specific read consistency is required. Keeping them on `pool` is often fine.
    static async getDailyMessages(childId) {
        if (!childId) throw new Error('Child ID is required to get daily message count');
        // This method implementation in the problem description refers to 'messages' table,
        // but the schema provided (chat_messages) and logic in chatController (children.messages_used)
        // suggest message counting is handled differently.
        // For consistency with chatController, this method might need revision or is unused for message_limit checks there.
        // Assuming it refers to a general messages table for now.
        const query = `
            SELECT COUNT(*) as message_count
            FROM chat_messages 
            WHERE child_id = $1
            AND timestamp >= CURRENT_DATE -- Assuming timestamp field for message creation time
            AND timestamp < CURRENT_DATE + INTERVAL '1 day'
        `;
        
        try {
            const { rows } = await pool.query(query, [childId]);
            return parseInt(rows[0].message_count, 10);
        } catch (error) {
            console.error('Error getting daily message count:', error);
            throw new Error(`Error getting daily message count: ${error.message}`);
        }
    }

    static async getActiveSession(childId) {
        if (!childId) throw new Error('Child ID is required to get active session');
        const query = `
            SELECT *
            FROM session_tracking
            WHERE child_id = $1
            AND end_time IS NULL
            ORDER BY start_time DESC
            LIMIT 1
        `;
        try {
            const { rows } = await pool.query(query, [childId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting active session:', error);
            throw new Error(`Error getting active session: ${error.message}`);
        }
    }
}

module.exports = ParentalControl;