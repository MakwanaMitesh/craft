const mongoose = require('mongoose');

// One row per sensitive admin action — who did what, to what, and when.
// Deliberately schema-loose on `details` since the shape of "what changed"
// varies a lot by action (a refund amount vs. a toggled boolean).
const auditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true }, // e.g. 'user.block', 'card.delete', 'order.refund'
    targetType: { type: String }, // 'User' | 'Card' | 'Order' | 'Template' | 'Plan' | 'Review' | 'Setting'
    targetId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ admin: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
