import { Context, InlineKeyboard } from 'grammy';
import {
  BODY_MEASUREMENT_LABELS,
  BODY_MEASUREMENT_TYPES,
  BodyMeasurement,
  BodyMeasurementType,
} from '../../db/models/BodyMeasurement.js';
import { User } from '../../db/models/User.js';

export const bodyMeasurementInputState = new Map<number, BodyMeasurementType>();

function formatMeasurementValue(value?: number, measuredAt?: Date): string {
  if (value === undefined || !measuredAt) return 'not set';
  return `${value} cm, ${measuredAt.toLocaleDateString('en-US')}`;
}

function parseMeasurementValue(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (Number.isNaN(value) || value < 1 || value > 300) return null;
  return Math.round(value * 10) / 10;
}

function buildMeasurementsKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (let i = 0; i < BODY_MEASUREMENT_TYPES.length; i += 2) {
    const first = BODY_MEASUREMENT_TYPES[i];
    const second = BODY_MEASUREMENT_TYPES[i + 1];
    kb.text(BODY_MEASUREMENT_LABELS[first], `body_measurement_${first}`);
    if (second) kb.text(BODY_MEASUREMENT_LABELS[second], `body_measurement_${second}`);
    kb.row();
  }

  return kb.text('⬅️ Back to profile', 'body_measurements_back');
}

async function getLatestMeasurements(telegramId: number): Promise<Map<BodyMeasurementType, { valueCm: number; measuredAt: Date }>> {
  const result = new Map<BodyMeasurementType, { valueCm: number; measuredAt: Date }>();

  const latestMeasurements = await Promise.all(
    BODY_MEASUREMENT_TYPES.map(async (type) => {
      const measurement = await BodyMeasurement.findOne({ telegramId, type }).sort({ measuredAt: -1 });
      return measurement ? { type, valueCm: measurement.valueCm, measuredAt: measurement.measuredAt } : null;
    })
  );

  for (const measurement of latestMeasurements) {
    if (!measurement) continue;
    result.set(measurement.type, { valueCm: measurement.valueCm, measuredAt: measurement.measuredAt });
  }

  return result;
}

export async function handleBodyMeasurements(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();

  const latestByType = await getLatestMeasurements(telegramId);
  const lines = BODY_MEASUREMENT_TYPES.map((type) => {
    const latest = latestByType.get(type);
    return `${BODY_MEASUREMENT_LABELS[type]}: ${formatMeasurementValue(latest?.valueCm, latest?.measuredAt)}`;
  });

  await ctx.reply(`📏 *Body measurements*\n\n${lines.join('\n')}\n\nChoose a parameter to update:`, {
    parse_mode: 'Markdown',
    reply_markup: buildMeasurementsKeyboard(),
  });
}

export async function handleBodyMeasurementSelectCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const type = ctx.match instanceof Array ? (ctx.match[1] as BodyMeasurementType) : undefined;
  if (!type || !BODY_MEASUREMENT_TYPES.includes(type)) return;

  bodyMeasurementInputState.set(telegramId, type);
  await ctx.answerCallbackQuery();
  await ctx.reply(`Enter ${BODY_MEASUREMENT_LABELS[type]} in centimeters. Example: 72.5`);
}

export async function handleBodyMeasurementMessage(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const type = bodyMeasurementInputState.get(telegramId);
  if (!type) return false;

  const valueCm = parseMeasurementValue(ctx.message?.text ?? '');
  if (valueCm === null) {
    await ctx.reply('❌ Enter a measurement in centimeters as a number from 1 to 300. Example: 72.5');
    return true;
  }

  const user = await User.findOneAndUpdate(
    { telegramId },
    {
      telegramId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
    },
    { upsert: true, new: true }
  );

  await BodyMeasurement.create({
    userId: user._id,
    telegramId,
    type,
    valueCm,
    measuredAt: new Date(),
  });

  bodyMeasurementInputState.delete(telegramId);
  await ctx.reply(`✅ Saved: ${BODY_MEASUREMENT_LABELS[type]} - ${valueCm} cm.`);
  await handleBodyMeasurements(ctx);
  return true;
}
