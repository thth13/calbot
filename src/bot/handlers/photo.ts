import { Context, InlineKeyboard } from 'grammy';
import { analyzeFood, analyzeFoodDescription, NutritionResult } from '../../services/vision.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { NutritionTotals, sendGoalReachedNotification } from '../goalNotifications.js';
import { buildPremiumKeyboard, isPremiumActive } from './premium.js';

const CONFIDENCE_EMOJI: Record<string, string> = {
  high: '✅',
  medium: '⚠️',
  low: '❓',
};

const MEAL_TYPE_LABELS: Record<NutritionResult['mealType'], string> = {
  meal: '🍽 Meal',
  snack: '🥨 Snack',
};

const DAILY_TOKEN_LIMIT = 30_000;
const FREE_DAILY_ENTRY_LIMIT = 2;
const PREMIUM_DAILY_ENTRY_LIMIT = 100;

async function processMeal(
  ctx: Context,
  analyze: () => Promise<NutritionResult>,
  options: {
    photoFileId?: string;
    waitText: string;
    failureText: string;
  }
): Promise<void> {
  const tgUser = ctx.from!;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const user = await User.findOneAndUpdate(
    { telegramId: tgUser.id },
    { telegramId: tgUser.id, username: tgUser.username, firstName: tgUser.first_name },
    { upsert: true, new: true }
  );

  // Reset the counter on a new day.
  const resetDate = new Date(user.tokensResetDate);
  resetDate.setHours(0, 0, 0, 0);
  if (resetDate < today) {
    user.dailyTokensUsed = 0;
    user.tokensResetDate = today;
    await user.save();
  }

  if (!isPremiumActive(user.premiumUntil) && user.dailyTokensUsed >= DAILY_TOKEN_LIMIT) {
    await ctx.reply(
      "⛔ You've reached today's scan limit. Limits reset tomorrow.\n\n" +
        '💎 Premium removes the daily limit and unlocks extended stats.'
    );
    return;
  }

  const premiumActive = isPremiumActive(user.premiumUntil);
  const dailyEntryLimit = premiumActive ? PREMIUM_DAILY_ENTRY_LIMIT : FREE_DAILY_ENTRY_LIMIT;
  const todayEntriesCount = await FoodEntry.countDocuments({
    telegramId: tgUser.id,
    createdAt: { $gte: today },
  });

  if (todayEntriesCount >= dailyEntryLimit) {
    if (premiumActive) {
      await ctx.reply("⛔ You've reached the subscription limit: 100 entries per day. The limit resets tomorrow.");
    } else {
      await ctx.reply(
        '⛔ The free version allows only 2 entries per day.\n\n' +
          'Subscribe to keep logging without limits.',
        { reply_markup: buildPremiumKeyboard(ctx) }
      );
    }
    return;
  }

  const waitMsg = await ctx.reply(options.waitText);

  try {
    const nutrition = await analyze();

    if (!isPremiumActive(user.premiumUntil)) {
      user.dailyTokensUsed += nutrition.tokensUsed;
    }
    user.tokensResetDate = today;
    await user.save();

    const entry = await FoodEntry.create({
      userId: user._id,
      telegramId: tgUser.id,
      foodDescription: nutrition.foodDescription,
      mealType: nutrition.mealType,
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
      confidence: nutrition.confidence,
      photoFileId: options.photoFileId,
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEntries = await FoodEntry.find({
      telegramId: tgUser.id,
      createdAt: { $gte: todayStart },
    });

    const todayTotals = todayEntries.reduce<NutritionTotals>(
      (sum, e) => ({
        calories: sum.calories + e.calories,
        protein: sum.protein + e.protein,
        carbs: sum.carbs + e.carbs,
        fat: sum.fat + e.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
    const previousTotals: NutritionTotals = {
      calories: todayTotals.calories - nutrition.calories,
      protein: todayTotals.protein - nutrition.protein,
      carbs: todayTotals.carbs - nutrition.carbs,
      fat: todayTotals.fat - nutrition.fat,
    };
    const todayTotal = todayTotals.calories;
    const remaining = (user.dailyCalorieGoal || 2000) - todayTotal;
    const confidenceLabel = CONFIDENCE_EMOJI[nutrition.confidence] ?? '⚠️';
    const mealTypeLabel = MEAL_TYPE_LABELS[nutrition.mealType];
    const keyboard = new InlineKeyboard().text('✏️ Edit', `edit_entry_${entry._id}`);

    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id);

    await ctx.reply(
      `🍽 *${nutrition.foodDescription}*\n\n` +
        `${mealTypeLabel}\n` +
        `🔥 Calories: *${nutrition.calories} kcal*\n` +
        `🥩 Protein: ${nutrition.protein}g\n` +
        `🍞 Carbs: ${nutrition.carbs}g\n` +
        `🧈 Fat: ${nutrition.fat}g\n\n` +
        `${confidenceLabel} Confidence: ${nutrition.confidence}\n\n` +
        `📊 *Today total:* ${todayTotal} kcal\n` +
        `${remaining >= 0 ? `✅ Remaining: ${remaining} kcal` : `⚠️ Over goal: ${Math.abs(remaining)} kcal`}`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );

    await sendGoalReachedNotification(ctx, previousTotals, todayTotals, user);
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => null);
    console.error('Meal handler error:', err);
    await ctx.reply(options.failureText);
  }
}

async function processPhoto(ctx: Context, imageUrl: string, fileId: string, details?: string): Promise<void> {
  await processMeal(ctx, () => analyzeFood(imageUrl, details), {
    photoFileId: fileId,
    waitText: '🔍 Analyzing food...',
    failureText: '❌ Could not recognize the food. Try taking a clearer photo.',
  });
}

export async function handleFoodDescription(ctx: Context): Promise<void> {
  const description = ctx.message?.text?.trim();
  if (!ctx.from || !description) return;

  await processMeal(ctx, () => analyzeFoodDescription(description), {
    waitText: '🔍 Calculating nutrition from the description...',
    failureText: '❌ Could not calculate nutrition from the description. Try listing the foods and approximate portions.',
  });
}

export async function handlePhoto(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  const bestPhoto = photos[photos.length - 1];
  const file = await ctx.api.getFile(bestPhoto.file_id);

  if (!file.file_path) {
    await ctx.reply('❌ Could not get the file. Try again.');
    return;
  }

  const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  // Details are used only when sent as a photo caption.
  const caption = ctx.message?.caption?.trim();
  await processPhoto(ctx, imageUrl, bestPhoto.file_id, caption || undefined);
}
