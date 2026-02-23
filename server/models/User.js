import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: false, default: null },
    name: { type: String, required: true, trim: true },
    splitwise: {
      id: { type: String, index: true, unique: true, sparse: true },
      accessToken: { type: String },
      refreshToken: { type: String },
      tokenType: { type: String },
      expiresAt: { type: Date }
    }
  },
  { timestamps: true }
);

userSchema.methods.checkPassword = function (plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10);
};

export default mongoose.model('User', userSchema);
