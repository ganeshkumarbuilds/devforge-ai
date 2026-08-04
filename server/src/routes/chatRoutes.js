const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { run, createConversationRules, renameConversationRules, chatMessageRules } = require('../middleware/validate');
const { chatLimiter } = require('../middleware/rateLimiter');
const {
  listConversations,
  createConversation,
  getConversation,
  renameConversation,
  deleteConversation,
  sendMessage,
} = require('../controllers/chatController');

router.use(authRequired);

router.get('/conversations', asyncHandler(listConversations));
router.post('/conversations', createConversationRules, run, asyncHandler(createConversation));
router.get('/conversations/:id', asyncHandler(getConversation));
router.patch('/conversations/:id', renameConversationRules, run, asyncHandler(renameConversation));
router.delete('/conversations/:id', asyncHandler(deleteConversation));
router.post('/conversations/:id/messages', chatLimiter, chatMessageRules, run, asyncHandler(sendMessage));

module.exports = router;
