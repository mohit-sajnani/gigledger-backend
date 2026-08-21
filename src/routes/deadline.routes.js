const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { listDeadlines, getDeadline, completeDeadline, runDeadlineAgent } = require('../controllers/deadline.controller');

const router = express.Router();

router.use(protect);

/**
 * No LLM call on this path, but it's still an on-demand trigger that writes
 * up to 5 Deadline upserts plus N AgentTask inserts per call — keyed per-user
 * since every caller here is already authenticated.
 */
const deadlineRunRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many deadline sync requests — please wait a moment and try again.', errors: [] },
});

/** Short-circuits to a 400 with the express-validator error list if any rule failed. */
function checkValidation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: result.array().map((e) => e.msg),
    });
  }
  next();
}

router.get('/', listDeadlines);

router.get('/:id', [param('id').isMongoId()], checkValidation, getDeadline);

router.patch('/:id/complete', [param('id').isMongoId()], checkValidation, completeDeadline);

router.post('/run', deadlineRunRateLimit, runDeadlineAgent);

module.exports = router;
