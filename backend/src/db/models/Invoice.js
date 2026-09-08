import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoice_number: { type: String, required: true, unique: true, index: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan_name: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['paid', 'pending', 'failed', 'refunded'], default: 'paid' },
    payment_gateway: { type: String, enum: ['stripe', 'paypal', 'apple', 'google', 'manual'], default: 'stripe' },
    transaction_id: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

export const Invoice = mongoose.model('Invoice', invoiceSchema);
