import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    splitBetween: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    billName: { type: String, required: true, trim: true },
    items: [itemSchema],
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    totalAmount: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

billSchema.index({ householdId: 1, createdAt: -1 });

export default mongoose.model('Bill', billSchema);
