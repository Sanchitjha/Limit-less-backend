import mongoose from 'mongoose';

export const ASSESSMENT_CATEGORIES = [
  'IQ',
  'Memory',
  'Attention Span',
  'ADHD Indicators',
  'Depression Screening',
  'Anxiety Screening',
  'Autism Spectrum',
  'Learning Difficulty',
  'Emotional Intelligence',
  'Stress Evaluation',
];

const questionBankSchema = new mongoose.Schema(
  {
    category: { type: String, enum: ASSESSMENT_CATEGORIES, required: true, index: true },
    title: { type: String, required: true, trim: true },
    question_text: { type: String, required: true, trim: true },
    type: { type: String, enum: ['multiple_choice', 'scale', 'timed_task', 'voice', 'image'], default: 'multiple_choice' },
    options: [
      {
        text: String,
        score: Number,
      },
    ],
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'adaptive'], default: 'medium' },
    is_active: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

export const QuestionBank = mongoose.model('QuestionBank', questionBankSchema);
