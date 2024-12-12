const cron = require('node-cron');
const pool = require('../config/db');
const LongTermMemoryModel = require('../models/longTermMemoryModel');

async function processSummariesForChild(client, childId) {
  // Get all summaries for the child, ordered by creation date (oldest first)
  const { rows: summaries } = await client.query(
    `SELECT id, summary, child_id 
     FROM chat_summaries 
     WHERE child_id = $1 
     ORDER BY created_at ASC`,
    [childId]
  );

  // If we have more than 5 summaries
  if (summaries.length > 5) {
    // Process all but the 5 most recent summaries
    const summariesToProcess = summaries.slice(0, summaries.length - 5);
    
    for (const summary of summariesToProcess) {
      // Process into long-term memory
      await LongTermMemoryModel.processNewSummary(summary.child_id, summary.summary);
    }

    // Delete all processed summaries in one query
    const summaryIds = summariesToProcess.map(s => s.id);
    await client.query(
      `DELETE FROM chat_summaries 
       WHERE id = ANY($1)`,
      [summaryIds]
    );

    console.log(`Processed and deleted ${summariesToProcess.length} excess summaries for child ${childId}`);
  }
}

function scheduleCleanup() {
  // Run cleanup every day at midnight
  cron.schedule('0 0 * * *', async () => {
    const client = await pool.connect();
    try {
      console.log('Running scheduled cleanup...');
      
      await client.query('BEGIN');

      // Delete old summarized conversations
      await client.query(`
        DELETE FROM conversations
        WHERE status = 'summarized'
        AND end_time < NOW() - INTERVAL '7 days'
        RETURNING id
      `);

      // Cleanup old messages from summarized conversations
      await client.query(`
        WITH deleted AS (
          DELETE FROM chat_messages 
          WHERE conversation_id IN (
            SELECT id FROM conversations 
            WHERE status = 'summarized'
            AND end_time < NOW() - INTERVAL '1 day'
          )
          RETURNING id
        )
        INSERT INTO maintenance_logs (operation, rows_affected, executed_at)
        VALUES (
          'scheduled_cleanup',
          (SELECT COUNT(*) FROM deleted),
          NOW()
        );
      `);

      // Get all unique child IDs with summaries
      const { rows: children } = await client.query(
        `SELECT DISTINCT child_id 
         FROM chat_summaries`
      );

      // Process summaries for each child
      for (const { child_id } of children) {
        await processSummariesForChild(client, child_id);
      }

      await client.query('COMMIT');
      console.log('Scheduled cleanup completed');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Scheduled cleanup failed:', error);
    } finally {
      client.release();
    }
  });
}

module.exports = scheduleCleanup;