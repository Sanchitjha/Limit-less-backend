import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    user_email: { type: String, required: false, lowercase: true, trim: true },
    action: { type: String, required: true, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip_address: { type: String, default: '' },
    user_agent: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    versionKey: false,
  }
);

activityLogSchema.index({ created_at: -1 });

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
