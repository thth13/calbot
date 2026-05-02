import { Schema, model, Document } from 'mongoose';

export type Gender = 'male' | 'female';
export type FitnessGoal = 'lose_weight' | 'maintain_weight' | 'gain_muscle';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type SportType = 'strength' | 'cardio' | 'mixed' | 'team' | 'martial_arts' | 'other';
export type TrainingFrequency = 'low' | 'medium' | 'high';
export type TrainingDuration = 'short' | 'medium' | 'long' | 'extra_long';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName?: string;
  premiumUntil?: Date;
  premiumPlan?: 'monthly' | 'yearly';
  dailyCalorieGoal: number;
  weight?: number;
  height?: number;
  age?: number;
  gender?: Gender;
  fitnessGoal?: FitnessGoal;
  activityLevel?: ActivityLevel;
  hasSport?: boolean;
  sportType?: SportType;
  trainingFrequency?: TrainingFrequency;
  trainingDuration?: TrainingDuration;
  bmr?: number;
  tdee?: number;
  activityCoefficient?: number;
  calorieAdjustmentPercent?: number;
  dailyProteinGoal?: number;
  dailyCarbsGoal?: number;
  dailyFatGoal?: number;
  dailyTokensUsed: number;
  tokensResetDate: Date;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String },
    firstName: { type: String },
    premiumUntil: { type: Date },
    premiumPlan: { type: String, enum: ['monthly', 'yearly'] },
    dailyCalorieGoal: { type: Number },
    weight: { type: Number },
    height: { type: Number },
    age: { type: Number },
    gender: { type: String, enum: ['male', 'female'] },
    fitnessGoal: { type: String, enum: ['lose_weight', 'maintain_weight', 'gain_muscle'] },
    activityLevel: { type: String, enum: ['sedentary', 'light', 'moderate', 'active'] },
    hasSport: { type: Boolean },
    sportType: { type: String, enum: ['strength', 'cardio', 'mixed', 'team', 'martial_arts', 'other'] },
    trainingFrequency: { type: String, enum: ['low', 'medium', 'high'] },
    trainingDuration: { type: String, enum: ['short', 'medium', 'long', 'extra_long'] },
    bmr: { type: Number },
    tdee: { type: Number },
    activityCoefficient: { type: Number },
    calorieAdjustmentPercent: { type: Number },
    dailyProteinGoal: { type: Number },
    dailyCarbsGoal: { type: Number },
    dailyFatGoal: { type: Number },
    dailyTokensUsed: { type: Number, default: 0 },
    tokensResetDate: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', UserSchema);
