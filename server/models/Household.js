import mongoose from 'mongoose';

const householdSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    splitwiseGroupId: { type: String, default: null, index: true },
    splitwiseGroupName: { type: String, default: null }
  },
  { timestamps: true }
);

householdSchema.index({ ownerId: 1 });
householdSchema.index({ memberIds: 1 });

export default mongoose.model('Household', householdSchema);
