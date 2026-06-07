import { Schema, model, Document } from 'mongoose';

export type BotEventType =
  | 'registration'
  | 'command'
  | 'text_message'
  | 'photo_message'
  | 'callback_query'
  | 'meal_logged'
  | 'entry_edited'
  | 'entry_deleted'
  | 'premium_offer_shown'
  | 'premium_purchase_clicked';

export interface IBotEvent extends Document {
  type: BotEventType;
  telegramId?: number;
  username?: string;
  firstName?: string;
  command?: string;
  callbackData?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const BotEventSchema = new Schema<IBotEvent>(
  {
    type: { type: String, required: true, index: true },
    telegramId: { type: Number, index: true },
    username: { type: String },
    firstName: { type: String },
    command: { type: String },
    callbackData: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

BotEventSchema.index({ createdAt: -1 });
BotEventSchema.index({ type: 1, createdAt: -1 });
BotEventSchema.index({ telegramId: 1, createdAt: -1 });

export const BotEvent = model<IBotEvent>('BotEvent', BotEventSchema);
