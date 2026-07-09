import mongoose from 'mongoose';

const assessmentSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    report_json: { type: mongoose.Schema.Types.Mixed, default: null },
    pdf_url: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

assessmentSchema.index({ user_id: 1, created_at: -1 });

export function sanitizeAssessment(assessment) {
  if (!assessment) return null;
  const obj =
    typeof assessment.toObject === 'function' ? assessment.toObject() : { ...assessment };
  return {
    id: String(obj._id),
    user_id: String(obj.user_id),
    report_json: obj.report_json ?? null,
    pdf_url: obj.pdf_url ?? null,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export const Assessment = mongoose.model('Assessment', assessmentSchema);
