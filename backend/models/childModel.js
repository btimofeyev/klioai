const pool = require('../config/db');
const bcrypt = require('bcrypt');

class Child {
    static async create(data, parentId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            console.log('Creating child with data:', { ...data, parentId });

            // Hash password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(data.password, saltRounds);

            // Create child account
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

            const childValues = [
                parentId,
                data.name,
                data.age,
                data.username,
                passwordHash
            ];

            console.log('Executing child creation query with values:', childValues);
            const { rows: [child] } = await client.query(childQuery, childValues);

            // Create parental controls with provided or default values
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

            console.log('Successfully created child:', child);
            console.log('Created parental controls:', controls);

            await client.query('COMMIT');
            return { ...child, controls };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async getProfile(userId) {
        try {
            console.log('Getting profile for childId:', userId);
            
            // First get the main profile data
            const profileResult = await pool.query(`
                SELECT 
                    c.*,
                    pc.filter_inappropriate,
                    pc.block_personal_info,
                    pc.allowed_start_time,
                    pc.allowed_end_time
                FROM children c
                LEFT JOIN parental_controls pc ON c.id = pc.child_id
                WHERE c.id = $1
            `, [userId]);

            if (!profileResult.rows[0]) {
                throw new Error(`No child profile found for ID: ${userId}`);
            }

            const profile = profileResult.rows[0];

            // Separately get the last 5 summaries
            const summariesResult = await pool.query(`
                SELECT 
                    summary,
                    created_at,
                    id as summary_id
                FROM chat_summaries 
                WHERE child_id = $1 
                ORDER BY created_at DESC 
                LIMIT 5
            `, [userId]);

            // Format timestamps for summaries
            const formattedSummaries = summariesResult.rows.map(row => ({
                summary: row.summary,
                when: formatTimestamp(row.created_at),
                id: row.summary_id
            }));

            // Add summaries to profile
            profile.learning_summaries = formattedSummaries;
            
            // Set most recent summary as the primary learning summary
            profile.learning_summary = formattedSummaries.length > 0 
                ? formattedSummaries[0].summary 
                : 'This is our first chat!';

            // Remove sensitive data
            delete profile.password_hash;

            console.log('Enhanced profile data:', {
                ...profile,
                summaryCount: formattedSummaries.length
            });

            return profile;
        } catch (error) {
            console.error('Error in getProfile:', error);
            throw new Error(`Error fetching child profile: ${error.message}`);
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
        try {
            console.log('Finding children for parent:', parentId);

            const query = `
                SELECT 
                    c.*,
                    pc.message_limit,
                    pc.allowed_start_time,
                    pc.allowed_end_time
                FROM children c
                LEFT JOIN parental_controls pc ON c.id = pc.child_id
                WHERE c.parent_id = $1
                ORDER BY c.created_at DESC
            `;

            const { rows } = await pool.query(query, [parentId]);
            console.log(`Found ${rows.length} children for parent ${parentId}`);
            return rows;
        } catch (error) {
            console.error('Error in findByParentId:', error);
            throw new Error(`Error finding children: ${error.message}`);
        }
    }

    static async findById(childId, parentId = null) {
        try {
            console.log('Finding child by ID:', childId, parentId ? `for parent ${parentId}` : '');

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

            const { rows } = await pool.query(query, values);
            
            if (rows.length === 0) {
                console.log('No child found with ID:', childId);
                return null;
            }

            console.log('Found child data:', rows[0]);
            return rows[0];
        } catch (error) {
            console.error('Error in findById:', error);
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

    static async delete(id, parentId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Delete related data in correct order to respect foreign key constraints
            const queries = [
                'DELETE FROM chat_summaries WHERE child_id = $1',
                'DELETE FROM chat_messages WHERE child_id = $1',
                'DELETE FROM session_tracking WHERE child_id = $1',
                'DELETE FROM long_term_memory_graph WHERE child_id = $1',
                'DELETE FROM parental_controls WHERE child_id = $1',
                'DELETE FROM conversations WHERE child_id = $1',
                'DELETE FROM children WHERE id = $1 AND parent_id = $2 RETURNING id'
            ];

            // Execute all deletion queries
            for (const query of queries) {
                if (query.includes('parent_id')) {
                    await client.query(query, [id, parentId]);
                } else {
                    await client.query(query, [id]);
                }
            }

            await client.query('COMMIT');
            return { success: true };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error in delete:', error);
            throw new Error(`Error deleting child account: ${error.message}`);
        } finally {
            client.release();
        }
    }
}
function formatTimestamp(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffHours < 24) {
        return `${diffHours} hours ago`;
    } else {
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} days ago`;
    }
}
module.exports = Child;