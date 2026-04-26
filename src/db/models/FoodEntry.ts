import { Schema, model, Document, Types } from 'mongoose';

export interface IFoodEntry extends Document {
  userId: Types.ObjectId;
  telegramId: number;
  foodDescription: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'low' | 'medium' | 'high';
  photoFileId?: string;
  createdAt: Date;
}

const FoodEntrySchema = new Schema<IFoodEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true, index: true },
    foodDescription: { type: String, required: true },
    calories: { type: Number, required: true },
    protein: { type: Number, required: true },
    carbs: { type: Number, required: true },
    fat: { type: Number, required: true },
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    photoFileId: { type: String },
  },
  { timestamps: true }
);

// Индекс для быстрой выборки по юзеру и дате
FoodEntrySchema.index({ telegramId: 1, createdAt: -1 });

export const FoodEntry = model<IFoodEntry>('FoodEntry', FoodEntrySchema);
