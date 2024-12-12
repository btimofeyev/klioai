// src/cron/cleanup.js
const cron = require('node-cron');
const ChatModel = require('../models/chatModel');
const SummaryService = require('../services/summaryService');
const pool = require('../config/db'); 
function setupCleanupJobs() {
    // Run daily at midnight
    cron.schedule('0 0 * * *', async () => {
        try {
          
            await ChatModel.cleanupOldMessages(7); 
            
            // Clean up old summaries older than 30 days
            await ChatModel.cleanupOldSummaries(30); // 30 days
            
            console.log('Daily cleanup jobs completed successfully');
        } catch (error) {
            console.error('Error in daily cleanup jobs:', error);
        }
    });

    // Create long-term summaries weekly on Sunday at midnight
    cron.schedule('0 0 * * 0', async () => {
        try {
            const result = await pool.query('SELECT id FROM children WHERE is_active = true');

            // Process long-term summaries for each active child
            for (const child of result.rows) {
                await SummaryService.createLongTermMemory(child.id);
            }
            
            console.log('Weekly long-term summaries created successfully');
        } catch (error) {
            console.error('Error creating weekly long-term summaries:', error);
        }
    });
}

module.exports = setupCleanupJobs;
