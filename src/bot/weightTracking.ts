import { Bot, Context } from 'grammy';
import {
  BODY_MEASUREMENT_LABELS,
  BODY_MEASUREMENT_TYPES,
  BodyMeasurement,
  BodyMeasurementType,
} from '../db/models/BodyMeasurement.js';
import { User } from '../db/models/User.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PROMPT_INTERVAL_MS = 60 * 60 * 1000;

function parseWeight(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (Number.isNaN(value) || value < 30 || value > 250) return null;
  return Math.round(value * 10) / 10;
}

function parseBodyMeasurement(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (Number.isNaN(value) || value < 1 || value > 300) return null;
  return Math.round(value * 10) / 10;
}

function isSkipText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ['skip', 'пропустить', 'без изменений', 'no change', 'no changes', '-'].includes(normalized);
}

async function getTrackedBodyMeasurementTypes(telegramId: number): Promise<BodyMeasurementType[]> {
  const types = await BodyMeasurement.distinct('type', { telegramId });
  return BODY_MEASUREMENT_TYPES.filter((type) => types.includes(type));
}

async function askNextBodyMeasurement(ctx: Context, type: BodyMeasurementType): Promise<void> {
  await ctx.reply(
    `📏 Send ${BODY_MEASUREMENT_LABELS[type]} in centimeters, for example 72.5.\n` +
      `If there are no changes, send "skip" or "пропустить".`
  );
}

export function getNextWeightPromptAt(from = new Date()): Date {
  return new Date(from.getTime() + WEEK_MS);
}

export async function recordWeight(telegramId: number, weight: number, measuredAt = new Date()): Promise<Date> {
  const nextWeightPromptAt = getNextWeightPromptAt(measuredAt);

  await User.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        weight,
        awaitingWeightUpdate: false,
        nextWeightPromptAt,
      },
      $push: {
        weightHistory: {
          weight,
          measuredAt,
        },
      },
    },
    { upsert: true }
  );

  return nextWeightPromptAt;
}

export async function handleWeightUpdateMessage(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const user = await User.findOne({ telegramId, awaitingWeightUpdate: true });
  if (!user) return false;

  const text = ctx.message?.text ?? '';
  const weight = parseWeight(text);
  if (weight === null) {
    await ctx.reply('❌ Enter your current weight in kg as a number from 30 to 250. For example: 72.5');
    return true;
  }

  const nextWeightPromptAt = await recordWeight(telegramId, weight);
  const bodyMeasurementTypes = await getTrackedBodyMeasurementTypes(telegramId);

  if (bodyMeasurementTypes.length > 0) {
    await User.updateOne(
      { telegramId },
      {
        $set: {
          awaitingBodyMeasurementUpdate: true,
          pendingBodyMeasurementTypes: bodyMeasurementTypes,
          pendingBodyMeasurementIndex: 0,
        },
      }
    );

    await ctx.reply(`✅ Weight saved: ${weight} kg.`);
    await askNextBodyMeasurement(ctx, bodyMeasurementTypes[0]);
    return true;
  }

  await ctx.reply(
    `✅ Weight saved: ${weight} kg.\n` +
      `I will ask for the next weight update on ${nextWeightPromptAt.toLocaleDateString('en-US')}.`
  );
  return true;
}

export async function handleBodyMeasurementUpdateMessage(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const user = await User.findOne({ telegramId, awaitingBodyMeasurementUpdate: true });
  if (!user) return false;

  const pendingTypes = user.pendingBodyMeasurementTypes ?? [];
  const currentIndex = user.pendingBodyMeasurementIndex ?? 0;
  const type = pendingTypes[currentIndex];

  if (!type) {
    await User.updateOne(
      { telegramId },
      {
        $set: {
          awaitingBodyMeasurementUpdate: false,
          pendingBodyMeasurementTypes: [],
          pendingBodyMeasurementIndex: 0,
        },
      }
    );
    return false;
  }

  const text = ctx.message?.text ?? '';
  const skipped = isSkipText(text);
  const valueCm = skipped ? null : parseBodyMeasurement(text);

  if (!skipped && valueCm === null) {
    await ctx.reply(
      `❌ Enter ${BODY_MEASUREMENT_LABELS[type]} in centimeters as a number from 1 to 300, or send "skip" / "пропустить".`
    );
    return true;
  }

  if (valueCm !== null) {
    await BodyMeasurement.create({
      userId: user._id,
      telegramId,
      type,
      valueCm,
      measuredAt: new Date(),
    });
  }

  const nextIndex = currentIndex + 1;
  const nextType = pendingTypes[nextIndex];

  if (nextType) {
    await User.updateOne({ telegramId }, { $set: { pendingBodyMeasurementIndex: nextIndex } });
    await askNextBodyMeasurement(ctx, nextType);
    return true;
  }

  await User.updateOne(
    { telegramId },
    {
      $set: {
        awaitingBodyMeasurementUpdate: false,
        pendingBodyMeasurementTypes: [],
        pendingBodyMeasurementIndex: 0,
      },
    }
  );
  await ctx.reply(
    `✅ Weekly body measurements update is complete.` +
      (user.nextWeightPromptAt
        ? ` I will ask for the next update on ${user.nextWeightPromptAt.toLocaleDateString('en-US')}.`
        : '')
  );
  return true;
}

export function startWeeklyWeightPrompts(bot: Bot): NodeJS.Timeout {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;

    try {
      const now = new Date();
      const users = await User.find({
        weight: { $exists: true },
        nextWeightPromptAt: { $lte: now },
        awaitingWeightUpdate: { $ne: true },
      })
        .select('telegramId')
        .limit(100);

      for (const user of users) {
        try {
          const bodyMeasurementTypes = await getTrackedBodyMeasurementTypes(user.telegramId);
          const bodyMeasurementLine =
            bodyMeasurementTypes.length > 0
              ? ' After weight, I will ask for your saved body measurements.'
              : '';

          await bot.api.sendMessage(
            user.telegramId,
            `⚖️ Time for your weekly weight check-in. Send your current weight in kg, for example: 72.5.${bodyMeasurementLine}`
          );
          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                awaitingWeightUpdate: true,
                awaitingBodyMeasurementUpdate: false,
                pendingBodyMeasurementTypes: [],
                pendingBodyMeasurementIndex: 0,
              },
            }
          );
        } catch (err) {
          console.error(`Failed to send weight prompt to ${user.telegramId}:`, err);
        }
      }
    } catch (err) {
      console.error('Weekly weight prompt scheduler error:', err);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 5000);
  return setInterval(run, PROMPT_INTERVAL_MS);
}
