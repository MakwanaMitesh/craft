const AuditLog = require('../models/AuditLog');

// Fire-and-forget by design — a failed audit write shouldn't ever block or
// fail the admin action it's recording. Call it after the action already
// succeeded.
function logAdminAction(req, action, { targetType, targetId, details } = {}) {
  AuditLog.create({
    admin: req.session.userId,
    action,
    targetType,
    targetId,
    details,
  }).catch((err) => console.error('Audit log write failed:', err));
}

module.exports = { logAdminAction };
