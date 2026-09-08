import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    admin_id: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    target_resource: { type: String, required: true, index: true },
    target_id: { type: String, default: null },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip_address: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    versionKey: false,
  }
);

auditLogSchema.index({ created_at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
