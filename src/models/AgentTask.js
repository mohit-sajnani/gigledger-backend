// AgentTask model — agentic proposal queue (centerpiece of the system)
// Every AI action is proposed here first; nothing applies without user approval
// Fields: userId, type (reconcile|categorize|tax_estimate|deadline_check),
//         status (proposed|approved|rejected|auto_applied),
//         inputRefs[], proposedChange{}, reasoning, ruleRefs[], priority
// TODO Phase 2: implement
