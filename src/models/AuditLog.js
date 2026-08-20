// AuditLog model — immutable record of every approved agent action
// Written ONLY when a user approves an AgentTask — never updated/deleted
// Fields: userId, actionType, agentTaskId, before{}, after{},
//         approvedBy (user|system), targetModel, targetId
// TODO Phase 2: implement
