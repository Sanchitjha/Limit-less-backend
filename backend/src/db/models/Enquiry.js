import mongoose from 'mongoose';

const enquirySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    message: { type: String, trim: true, maxlength: 5000 },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

enquirySchema.index({ created_at: -1 });

export function sanitizeEnquiry(enquiry) {
  const obj = typeof enquiry.toObject === 'function' ? enquiry.toObject() : { ...enquiry };
  return {
    id: String(obj._id),
    name: obj.name ?? null,
    email: obj.email ?? null,
    message: obj.message ?? null,
    status: obj.status,
    created_at: obj.created_at,
  };
}

export const Enquiry = mongoose.model('Enquiry', enquirySchema);
