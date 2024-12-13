const express = require('express');
const router = express.Router();
const childController = require('../controllers/childController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

// Base routes
router.get('/profile', childController.getChildProfile); 
router.post('/', childController.createChild);
router.get('/', childController.getChildren);

// Child-specific routes
router.get('/:id', childController.getChild);
router.put('/:id', childController.updateChild);
router.delete('/:id', childController.deleteChild);

// Memory and summaries routes
router.get('/:id/summaries', childController.getChildSummaries); 
router.get('/:id/memory', childController.getChildMemory);     
router.delete('/:id/memory/:topic', childController.deleteMemoryTopic);

// TOS history route
router.get('/:id/tos-history', childController.getChildTOSHistory);

module.exports = router;