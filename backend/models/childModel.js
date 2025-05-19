const pool = require('../config/db');
const bcrypt = require('bcrypt');

class Child {
    static async createWithTOS(data, parentId, tosData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const passwordHash = await bcrypt.hash(data.password, 10);

            const childQuery = `
                INSERT INTO children (
                    parent_id,
                    name,
                    age,
                    username,
                    password_hash,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                RETURNING id, name, age, username, created_at
            `;
            const childValues = [parentId, data.name, data.age, data.username, passwordHash];
            const { rows: [child] } = await client.query(childQuery, childValues);

            const controlsQuery = `
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
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                RETURNING *
            `;
            const controlsValues = [
                child.id,
                data.parentalControls?.filterInappropriate ?? true,
                true,
                data.parentalControls?.dailyMessageLimit ?? 50,
                data.parentalControls?.allowedStartTime ?? '09:00:00',
                data.parentalControls?.allowedEndTime ?? '21:00:00'
            ];
            const { rows: [controls] } = await client.query(controlsQuery, controlsValues);

            const tosQuery = `
                INSERT INTO child_tos_acceptance (
                    child_id,
                    parent_id,
                    tos_version,
                    ip_address,
                    user_agent,
                    accepted_at
                )
                VALUES ($1, $2, $3, $4, $5, NOW())
                RETURNING *
            `;
            const tosValues = [
                child.id,
                parentId,
                tosData.version,
                tosData.ipAddress,
                tosData.userAgent
            ];
            await client.query(tosQuery, tosValues);

            await client.query('COMMIT');
            return { child, controls };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async getProfile(userId) {
        try {
            const profileQuery = `
                SELECT 
                    c.*,
                    pc.filter_inappropriate,
                    pc.block_personal_info,
                    pc.allowed_start_time,
                    pc.allowed_end_time
                FROM children c
                LEFT JOIN parental_controls pc ON c.id = pc.child_id
                WHERE c.id = $1
            `;
            const profileResult = await pool.query(profileQuery, [userId]);

            if (!profileResult.rows[0]) {
                throw new Error('No child profile found');
            }

            const profile = profileResult.rows[0];

            const summariesQuery = `
                SELECT 
                    summary,
                    created_at,
                    id as summary_id
                FROM chat_summaries 
                WHERE child_id = $1 
                ORDER BY created_at DESC 
                LIMIT 5
            `;
            const summariesResult = await pool.query(summariesQuery, [userId]);

            const formattedSummaries = summariesResult.rows.map(row => ({
                summary: row.summary,
                when: formatTimestamp(row.created_at),
                id: row.summary_id
            }));

            profile.learning_summaries = formattedSummaries;
            profile.learning_summary = formattedSummaries.length > 0 
                ? formattedSummaries[0].summary 
                : 'This is our first chat!';

            delete profile.password_hash;
            return profile;
        } catch (error) {
            throw new Error(`Error fetching profile: ${error.message}`);
        }
    }

    static async updateLastActivity(childId) {
        try {
            await pool.query(`
                UPDATE children 
                SET last_activity = NOW() 
                WHERE id = $1
            `, [childId]);
        } catch (error) {
            console.error('Error updating last activity:', error);
        }
    }

    static async findByUsername(username) {
        const query = `
            SELECT c.*, u.email as parent_email 
            FROM children c
            JOIN users u ON c.parent_id = u.id
            WHERE c.username = $1
        `;
        
        try {
            const { rows } = await pool.query(query, [username]);
            return rows[0];
        } catch (error) {
            throw new Error(`Error finding child by username: ${error.message}`);
        }
    }

    static async findByParentId(parentId) {
        const query = `
            SELECT 
                c.*,
                pc.message_limit,
                pc.allowed_start_time, pc.allowed_end_time
            FROM children c
            LEFT JOIN parental_controls pc ON c.id = pc.child_id
            WHERE c.parent_id = $1
            ORDER BY c.created_at DESC
        `;

        try {
            const { rows } = await pool.query(query, [parentId]);
            return rows;
        } catch (error) {
            throw new Error(`Error fetching children for parent: ${error.message}`);
        }
    }

    static async findById(childId, parentId = null) {
        let query = `
            SELECT 
                c.*,
                pc.message_limit,
                pc.allowed_start_time,
                pc.allowed_end_time
            FROM children c
            LEFT JOIN parental_controls pc ON c.id = pc.child_id
            WHERE c.id = $1
        `;

        const values = [childId];
        if (parentId) {
            query += ' AND c.parent_id = $2';
            values.push(parentId);
        }

        try {
            // Using pool directly for the query instead of a client
            const { rows } = await pool.query(query, values);
            return rows[0] || null;
        } catch (error) {
            throw new Error(`Error finding child: ${error.message}`);
        }
    }

    static async update(id, data, parentId) {
        const { name, age, username } = data;
        const query = `
            UPDATE children
            SET name = $1, age = $2, username = $3, updated_at = NOW()
            WHERE id = $4 AND parent_id = $5
            RETURNING id, name, age, username, updated_at
        `;
        
        try {
            const { rows } = await pool.query(query, [name, age, username, id, parentId]);
            return rows[0];
        } catch (error) {
            throw new Error(`Error updating child: ${error.message}`);
        }
    }

    static async updatePassword(childId, newPassword) {
        try {
            const passwordHash = await bcrypt.hash(newPassword, 10);
            await pool.query(`
                UPDATE children
                SET password_hash = $1, updated_at = NOW()
                WHERE id = $2
            `, [passwordHash, childId]);
            return true;
        } catch (error) {
            throw new Error(`Error updating password: ${error.message}`);
        }
    }

    static async delete(id, parentId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const queries = [
                'DELETE FROM chat_summaries WHERE child_id = $1',
                'DELETE FROM chat_messages WHERE child_id = $1',
                'DELETE FROM session_tracking WHERE child_id = $1',
                'DELETE FROM long_term_memory_graph WHERE child_id = $1',
                'DELETE FROM parental_controls WHERE child_id = $1',
                'DELETE FROM conversations WHERE child_id = $1',
                'DELETE FROM child_tos_acceptance WHERE child_id = $1',
                'DELETE FROM children WHERE id = $1 AND parent_id = $2 RETURNING id'
            ];

            for (const q of queries) {
                if (q.includes('parent_id')) {
                    await client.query(q, [id, parentId]);
                } else {
                    await client.query(q, [id]);
                }
            }

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw new Error(`Error deleting child: ${error.message}`);
        } finally {
            client.release();
        }
    }

    static async getTOSHistory(childId) {
        try {
            const { rows } = await pool.query(`
                SELECT 
                    tos_version,
                    accepted_at,
                    ip_address,
                    user_agent
                FROM child_tos_acceptance
                WHERE child_id = $1
                ORDER BY accepted_at DESC
            `, [childId]);
            return rows;
        } catch (error) {
            throw new Error(`Error fetching TOS history: ${error.message}`);
        }
    }
}

function formatTimestamp(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffHours < 24) {
        return `${diffHours} hours ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
}

module.exports = Child;