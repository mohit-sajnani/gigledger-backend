const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { runAgent, listTasks, approveTask, rejectTask } = require('../controllers/agent.controller');

const router = express.Router();

router.use(protect);

const STATUSES = ['proposed', 'approved', 'rejected', 'auto_applied'];

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

router.post('/run', runAgent);

router.get(
  '/tasks',
  [
    query('status').optional().isIn(STATUSES),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  checkValidation,
  listTasks,
);

router.patch('/tasks/:id/approve', [param('id').isMongoId()], checkValidation, approveTask);

router.patch('/tasks/:id/reject', [param('id').isMongoId()], checkValidation, rejectTask);

module.exports = router;
