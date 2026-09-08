import mongoose from 'mongoose';

const aiRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    domain: { type: String, required: true, index: true },
    condition_threshold: { type: Number, required: true },
    recommendation_template: { type: String, required: true },
    risk_level: { type: String, enum: ['low', 'moderate', 'high'], default: 'moderate' },
    is_active: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

export const AIRule = mongoose.model('AIRule', aiRuleSchema);
