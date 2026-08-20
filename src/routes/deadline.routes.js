const express = require('express');
const { param, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { listDeadlines, getDeadline, completeDeadline, runDeadlineAgent } = require('../controllers/deadline.controller');

const router = express.Router();

router.use(protect);

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

router.post('/run', runDeadlineAgent);

module.exports = router;
