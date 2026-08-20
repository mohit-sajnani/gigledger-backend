const Category = require('../models/Category');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/categories — the full master list, optionally filtered by type.
 */
const getCategories = asyncHandler(async (req, res) => {
  const filter = { deleted: false };
  if (req.query.type) filter.type = req.query.type;

  const categories = await Category.find(filter).sort({ name: 1 });
  res.status(200).json({ success: true, data: categories, message: '' });
});

/**
 * POST /api/categories — adds a new entry to the master list. Rejects a
 * duplicate (name, type) pair with 409 before hitting the DB's unique index.
 */
const createCategory = asyncHandler(async (req, res) => {
  const { name, type, taxDeductible, color, icon, isDefault } = req.body;

  const existing = await Category.findOne({ name, type, deleted: false });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Category "${name}" already exists for type "${type}"`,
      errors: [],
    });
  }

  const category = await Category.create({ name, type, taxDeductible, color, icon, isDefault });
  res.status(201).json({ success: true, data: category, message: 'Category created' });
});

module.exports = { getCategories, createCategory };
