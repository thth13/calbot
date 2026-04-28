import { Schema, model, Document } from 'mongoose';

export type Gender = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName?: string;
  dailyCalorieGoal: number;
  weight?: number;
  height?: number;
  age?: number;
  gender?: Gender;
  activityLevel?: ActivityLevel;
  dailyTokensUsed: number;
  tokensResetDate: Date;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },
    dailyCalorieGoal: { type: Number },
    weight: { type: Number },
    height: { type: Number },
    age: { type: Number },
    gender: { type: String, enum: ['male', 'female'] },
    activityLevel: { type: String, enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
    dailyTokensUsed: { type: Number, default: 0 },
    tokensResetDate: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);
