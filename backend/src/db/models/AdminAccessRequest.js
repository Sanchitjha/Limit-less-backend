import mongoose from 'mongoose';

export const ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'rejected'];

const adminAccessRequestSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 320,
      index: true,
    },
    name: { type: String, trim: true, maxlength: 200, default: '' },
    requested_role: { type: String, default: 'admin' },
    status: {
      type: String,
      enum: ACCESS_REQUEST_STATUSES,
      default: 'pending',
      index: true,
    },
    notes: { type: String, maxlength: 1000, default: '' },
    reviewed_by: { type: String, default: null },
    reviewed_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

export function sanitizeAdminAccessRequest(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  return {
    id: String(obj._id),
    email: obj.email,
    name: obj.name,
    requested_role: obj.requested_role,
    status: obj.status,
    notes: obj.notes,
    reviewed_by: obj.reviewed_by,
    reviewed_at: obj.reviewed_at,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export const AdminAccessRequest = mongoose.model('AdminAccessRequest', adminAccessRequestSchema);
