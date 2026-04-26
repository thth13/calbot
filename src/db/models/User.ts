import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName?: string;
  dailyCalorieGoal: number;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },
    dailyCalorieGoal: { type: Number, default: 2000 },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);
