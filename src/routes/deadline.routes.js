// Deadline routes
// GET    /api/deadlines               — list upcoming deadlines for the user
// GET    /api/deadlines/:id
// PATCH  /api/deadlines/:id/complete
// POST   /api/deadlines/run           — (re)generate the standard statutory set
const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth.middleware');
const { listDeadlines, getDeadline, completeDeadline, runDeadlines } = require('../controllers/deadline.controller');

const router = express.Router();

router.use(protect);

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

router.get('/', [query('status').optional().isIn(['upcoming', 'completed'])], checkValidation, listDeadlines);
router.post('/run', runDeadlines);
router.get('/:id', [param('id').isMongoId()], checkValidation, getDeadline);
router.patch('/:id/complete', [param('id').isMongoId()], checkValidation, completeDeadline);

module.exports = router;
