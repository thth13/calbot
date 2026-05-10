import { Bot, Context } from 'grammy';
import { User } from '../db/models/User.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PROMPT_INTERVAL_MS = 60 * 60 * 1000;

function parseWeight(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (Number.isNaN(value) || value < 30 || value > 250) return null;
  return Math.round(value * 10) / 10;
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
  await ctx.reply(
    `✅ Weight saved: ${weight} kg.\n` +
      `I will ask for the next weight update on ${nextWeightPromptAt.toLocaleDateString('en-US')}.`
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
          await bot.api.sendMessage(
            user.telegramId,
            '⚖️ Time for your weekly weight check-in. Send your current weight in kg, for example: 72.5'
          );
          await User.updateOne({ _id: user._id }, { $set: { awaitingWeightUpdate: true } });
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
