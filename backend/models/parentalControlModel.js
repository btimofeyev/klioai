const pool = require('../config/db');

class ParentalControl {
    static async create(childId) {
        if (!childId) {
            throw new Error('Child ID is required to create parental controls');
        }

        console.log('Creating default parental controls for child:', childId);

        const query = `
            INSERT INTO parental_controls (
                child_id,
                filter_inappropriate,
                block_personal_info,
                message_limit,
                allowed_start_time,
                allowed_end_time,
                created_at,
                updated_at
            )
            VALUES ($1, true, true, 50, '09:00:00', '21:00:00', NOW(), NOW())
            ON CONFLICT (child_id) DO UPDATE
            SET 
                filter_inappropriate = EXCLUDED.filter_inappropriate,
                block_personal_info = EXCLUDED.block_personal_info,
                message_limit = EXCLUDED.message_limit,
                allowed_start_time = EXCLUDED.allowed_start_time,
                allowed_end_time = EXCLUDED.allowed_end_time,
                updated_at = NOW()
            RETURNING *
        `;
        
        try {
            const { rows } = await pool.query(query, [childId]);
            console.log('Created/Updated parental controls:', rows[0]);
            return rows[0];
        } catch (error) {
            console.error('Error in create parental controls:', error);
            throw new Error(`Error creating parental controls: ${error.message}`);
        }
    }

    static async findByChildId(childId) {
        if (!childId) {
            throw new Error('Child ID is required to fetch parental controls');
        }

        console.log('Finding parental controls for child:', childId);

        try {
            // First try to find existing controls
            const controlsQuery = `
                SELECT *
                FROM parental_controls
                WHERE child_id = $1
            `;
            
            const { rows } = await pool.query(controlsQuery, [childId]);
            
            // If no controls exist, create default ones
            if (rows.length === 0) {
                console.log('No controls found for child, creating defaults...');
                return await this.create(childId);
            }

            console.log('Found existing parental controls:', rows[0]);
            return rows[0];
        } catch (error) {
            console.error('Error in findByChildId:', error);
            throw new Error(`Error fetching parental controls: ${error.message}`);
        }
    }

    static async update(childId, data) {
        if (!childId) {
            throw new Error('Child ID is required to update parental controls');
        }

        console.log('Updating parental controls for child:', childId, 'with data:', data);

        const query = `
            UPDATE parental_controls
            SET 
                filter_inappropriate = $2,
                block_personal_info = $3,
                message_limit = $4,
                allowed_start_time = $5,
                allowed_end_time = $6,
                updated_at = NOW()
            WHERE child_id = $1
            RETURNING *
        `;
        
        const values = [
            childId,
            data.filterInappropriate,
            data.blockPersonalInfo,
            data.messageLimit,
            data.allowedHours.start,
            data.allowedHours.end
        ];

        try {
            const { rows } = await pool.query(query, values);
            if (rows.length === 0) {
                return await this.create(childId);
            }
            console.log('Updated parental controls:', rows[0]);
            return rows[0];
        } catch (error) {
            console.error('Error in update:', error);
            throw new Error(`Error updating parental controls: ${error.message}`);
        }
    }

    static async getDailyMessages(childId) {
        if (!childId) {
            throw new Error('Child ID is required to get daily message count');
        }

        const query = `
            SELECT COUNT(*) as message_count
            FROM messages
            WHERE child_id = $1
            AND created_at >= CURRENT_DATE
            AND created_at < CURRENT_DATE + INTERVAL '1 day'
        `;
        
        try {
            const { rows } = await pool.query(query, [childId]);
            return parseInt(rows[0].message_count);
        } catch (error) {
            console.error('Error in getDailyMessages:', error);
            throw new Error(`Error getting daily message count: ${error.message}`);
        }
    }

    static async getActiveSession(childId) {
        if (!childId) {
            throw new Error('Child ID is required to get active session');
        }

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
            console.error('Error in getActiveSession:', error);
            throw new Error(`Error getting active session: ${error.message}`);
        }
    }
}

module.exports = ParentalControl;