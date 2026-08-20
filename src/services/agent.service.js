const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const AgentTask = require('../models/AgentTask');
const AuditLog = require('../models/AuditLog');
const openai = require('../config/openai');
const logger = require('../utils/logger');

const SYSTEM_PROMPT = `You are a financial assistant for a gig worker (rider/delivery driver/freelancer).
You will be given a list of uncategorized transactions and a list of available categories.
For each transaction, propose a "categorize" task: pick the single most appropriate category
from the provided list by its exact _id, and explain your reasoning in one short sentence.
Return ONLY a JSON object shaped exactly like this — no prose, no markdown fences:
{ "tasks": [ { "type": "categorize", "inputRefs": ["<transactionId>"], "proposedChange": { "categoryId": "<categoryId>", "confidence": 0.0-1.0 }, "reasoning": "...", "priority": 1-5 } ] }`;

/**
 * Turns a "3L-7L"-style human range into a compact context string. Not
 * used for tax math (that's Phase 3) — just keeps the prompt payload small.
 */
function serializeTransaction(t) {
  return {
    _id: t._id.toString(),
    amount: t.amount,
    date: t.date.toISOString().slice(0, 10),
    rawDescription: t.rawDescription || '',
    source: t.source,
  };
}

function serializeCategory(c) {
  return { _id: c._id.toString(), name: c.name, type: c.type };
}

/**
 * Re-validates every item the LLM returned against the real batch that was
 * sent — never trusts a hallucinated transaction id or category id. Drops
 * individually-malformed items instead of failing the whole run.
 */
function validateProposedTasks(rawTasks, userId, sentTransactionIds, sentCategoryIds) {
  const validTasks = [];

  for (const item of rawTasks) {
    if (item.type !== 'categorize') {
      logger.warn(`Dropping agent task proposal with unsupported type "${item.type}"`);
      continue;
    }

    const inputRefs = Array.isArray(item.inputRefs) ? item.inputRefs : [];
    const validRefs = inputRefs.filter((id) => sentTransactionIds.has(id));
    if (validRefs.length === 0) {
      logger.warn('Dropping agent task proposal with no valid inputRefs');
      continue;
    }

    const categoryId = item.proposedChange && item.proposedChange.categoryId;
    if (!categoryId || !sentCategoryIds.has(categoryId)) {
      logger.warn(`Dropping agent task proposal referencing unknown categoryId "${categoryId}"`);
      continue;
    }

    const confidence = Number(item.proposedChange.confidence);
    const priority = Math.min(5, Math.max(1, parseInt(item.priority, 10) || 3));
    const reasoning = String(item.reasoning || '').slice(0, 1000) || 'No reasoning provided.';

    validTasks.push({
      userId,
      type: 'categorize',
      status: 'proposed',
      inputRefs: validRefs,
      proposedChange: {
        categoryId,
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
      },
      reasoning,
      priority,
    });
  }

  return validTasks;
}

/**
 * LLM call #1 — the "manager." Decides which category fits each
 * transaction and cites its reasoning; never does arithmetic and never
 * gets its output trusted without re-validation against real data.
 */
async function plannerLLMCall(userId, transactions, categories) {
  const sentTransactionIds = new Set(transactions.map((t) => t._id.toString()));
  const sentCategoryIds = new Set(categories.map((c) => c._id.toString()));

  const userMessage = JSON.stringify({
    transactions: transactions.map(serializeTransaction),
    categories: categories.map(serializeCategory),
  });

  let raw;
  try {
    raw = await openai.chatJSON({ system: SYSTEM_PROMPT, user: userMessage });
  } catch (err) {
    logger.error(`Planner LLM call failed: ${err.message}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(`Planner LLM returned malformed JSON, raw response: ${raw}`);
    return [];
  }

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return validateProposedTasks(rawTasks, userId, sentTransactionIds, sentCategoryIds);
}

/**
 * Entry point — called by the controller on POST /api/agent/run.
 */
async function runAgentCycle(userId) {
  const batchSize = parseInt(process.env.AGENT_MAX_BATCH_SIZE, 10) || 30;

  const candidates = await Transaction.find({ userId, status: 'pending', deleted: false })
    .sort({ createdAt: 1 })
    .limit(batchSize);

  if (candidates.length === 0) {
    return { tasks: [], message: 'Nothing to process' };
  }

  const candidateIds = candidates.map((t) => t._id);
  const alreadyProposed = await AgentTask.find({
    userId,
    status: 'proposed',
    inputRefs: { $in: candidateIds },
  }).distinct('inputRefs');
  const alreadyProposedIds = new Set(alreadyProposed.map((id) => id.toString()));

  const transactions = candidates.filter((t) => !alreadyProposedIds.has(t._id.toString()));
  if (transactions.length === 0) {
    return { tasks: [], message: 'Nothing to process' };
  }

  const categories = await Category.find({ deleted: false });

  const validTasks = await plannerLLMCall(userId, transactions, categories);
  if (validTasks.length === 0) {
    return { tasks: [], message: 'Nothing to process' };
  }

  const created = await AgentTask.insertMany(validTasks);
  return { tasks: created, message: 'Agent run complete.' };
}

/**
 * LLM call #2 (optional, fine-grained) — deferred to a later phase. The
 * planner call already does both planning and categorization in one shot,
 * which is sufficient for the hackathon demo. Not wired into runAgentCycle.
 */
// eslint-disable-next-line no-unused-vars
async function categorizationAgent(transaction, categories) {
  // TODO Phase 2.5 / bonus: per-transaction fine-grained classification.
  throw new Error('categorizationAgent is not implemented — plannerLLMCall handles categorization for now.');
}

/**
 * Applies an already-approved task. Called by the controller inside the
 * same session transaction that flipped the task's status — never invoked
 * by the agent itself, and never re-checks/re-flips the task's own status.
 */
async function applyApprovedTask(task, session) {
  if (task.status !== 'proposed') {
    throw new Error(`applyApprovedTask called on a task with status "${task.status}"`);
  }
  if (task.type !== 'categorize') {
    throw new Error(`applyApprovedTask does not support task type "${task.type}"`);
  }
  if (task.inputRefs.length !== 1) {
    throw new Error('applyApprovedTask expects exactly one transaction per categorize task');
  }

  const transactionId = task.inputRefs[0];
  const transaction = await Transaction.findOne({
    _id: transactionId,
    userId: task.userId,
    deleted: false,
  }).session(session);

  if (!transaction) {
    throw new Error('Transaction referenced by this task no longer exists');
  }

  const before = {
    category: transaction.category,
    categoryConfidence: transaction.categoryConfidence,
    status: transaction.status,
  };

  // Same transition as transaction.controller.js#approveTransaction — keep status semantics in sync.
  transaction.category = task.proposedChange.categoryId;
  transaction.categoryConfidence = task.proposedChange.confidence;
  transaction.status = 'categorized';
  await transaction.save({ session });

  const after = {
    category: transaction.category,
    categoryConfidence: transaction.categoryConfidence,
    status: transaction.status,
  };

  const [auditLog] = await AuditLog.create(
    [
      {
        userId: task.userId,
        actionType: 'transaction.categorize',
        agentTaskId: task._id,
        before,
        after,
        approvedBy: 'user',
        targetModel: 'Transaction',
        targetId: transaction._id,
      },
    ],
    { session },
  );

  return { transaction, auditLog };
}

module.exports = {
  runAgentCycle,
  plannerLLMCall,
  categorizationAgent,
  applyApprovedTask,
};
