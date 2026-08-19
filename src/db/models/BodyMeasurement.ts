import { Schema, model, Document, Types } from 'mongoose';

export type BodyMeasurementType =
  | 'waist'
  | 'abdomen'
  | 'chest'
  | 'hips_glutes'
  | 'neck'
  | 'shoulders'
  | 'biceps_flexed'
  | 'biceps_relaxed'
  | 'forearm'
  | 'thigh'
  | 'calf';

export const BODY_MEASUREMENT_TYPES: BodyMeasurementType[] = [
  'waist',
  'abdomen',
  'chest',
  'hips_glutes',
  'neck',
  'shoulders',
  'biceps_flexed',
  'biceps_relaxed',
  'forearm',
  'thigh',
  'calf',
];

export const BODY_MEASUREMENT_LABELS: Record<BodyMeasurementType, string> = {
  waist: 'Талія',
  abdomen: 'Живіт (на рівні пупка)',
  chest: 'Груди',
  hips_glutes: 'Стегна / сідниці',
  neck: 'Шея',
  shoulders: 'Плечи',
  biceps_flexed: 'Біцепс (напружений)',
  biceps_relaxed: 'Біцепс (розслаблений)',
  forearm: 'Передпліччя',
  thigh: 'Стегно',
  calf: 'Литка',
};

export interface IBodyMeasurement extends Document {
  userId: Types.ObjectId;
  telegramId: number;
  type: BodyMeasurementType;
  valueCm: number;
  measuredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BodyMeasurementSchema = new Schema<IBodyMeasurement>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true, index: true },
    type: { type: String, enum: BODY_MEASUREMENT_TYPES, required: true },
    valueCm: { type: Number, required: true, min: 1 },
    measuredAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

// Latest value and historical progress for a specific measurement.
BodyMeasurementSchema.index({ telegramId: 1, type: 1, measuredAt: -1 });

export const BodyMeasurement = model<IBodyMeasurement>('BodyMeasurement', BodyMeasurementSchema);
