import { Context, InlineKeyboard } from 'grammy';
import { analyzeFood, analyzeFoodDescription, NutritionResult } from '../../services/vision.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { NutritionTotals, sendGoalReachedNotification } from '../goalNotifications.js';
import { buildPremiumKeyboard, isPremiumActive } from './premium.js';
import { recordBotEvent } from '../analytics.js';

const MEAL_TYPE_LABELS: Record<NutritionResult['mealType'], string> = {
  meal: '🍽 Прийом їжі',
  snack: '🥨 Перекус',
};

const DAILY_TOKEN_LIMIT = 30_000;
const PREMIUM_DAILY_ENTRY_LIMIT = 100;
const FREE_TRIAL_DAYS = 3;

function getFreeTrialExpiresAt(user: { createdAt?: Date }): Date | undefined {
  if (!user.createdAt) {
    return undefined;
  }

  return new Date(user.createdAt.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

function isFreeTrialActive(user: { createdAt?: Date }, now = new Date()): boolean {
  const expiresAt = getFreeTrialExpiresAt(user);
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

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

  const premiumActive = isPremiumActive(user);
  if (!premiumActive && !isFreeTrialActive(user)) {
    await ctx.reply(
      '⛔ Твій безкоштовний 3-денний пробний період завершився.\n\n' +
        'Оформи підписку, щоб продовжити розпізнавати страви.',
      { reply_markup: buildPremiumKeyboard(ctx) }
    );
    return;
  }

  if (!premiumActive && user.dailyTokensUsed >= DAILY_TOKEN_LIMIT) {
    await ctx.reply(
      '⛔ Ти досягнув ліміту розпізнавань на сьогодні. Ліміт оновиться завтра.\n\n' +
        '💎 Premium знімає добовий ліміт і відкриває розширену статистику.'
    );
    return;
  }

  const todayEntriesCount = await FoodEntry.countDocuments({
    telegramId: tgUser.id,
    createdAt: { $gte: today },
  });

  if (premiumActive && todayEntriesCount >= PREMIUM_DAILY_ENTRY_LIMIT) {
    await ctx.reply('⛔ Ти досягнув ліміту підписки: 100 записів на добу. Ліміт оновиться завтра.');
    return;
  }

  const waitMsg = await ctx.reply(options.waitText);

  try {
    const nutrition = await analyze();

    if (!isPremiumActive(user)) {
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

    await recordBotEvent(ctx, 'meal_logged', {
      entryId: String(entry._id),
      mealType: entry.mealType,
      hasPhoto: Boolean(options.photoFileId),
      calories: entry.calories,
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
    const mealTypeLabel = MEAL_TYPE_LABELS[nutrition.mealType];
    const keyboard = new InlineKeyboard().text('✏️ Редагувати', `edit_entry_${entry._id}`);

    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id);

    await ctx.reply(
      `🍽 *${nutrition.foodDescription}*\n\n` +
        `${mealTypeLabel}\n` +
        `🔥 Калорії: *${formatNumber(nutrition.calories)} ккал*\n` +
        `🥩 Білки: ${formatNumber(nutrition.protein)} г\n` +
        `🍞 Вуглеводи: ${formatNumber(nutrition.carbs)} г\n` +
        `🧈 Жири: ${formatNumber(nutrition.fat)} г\n\n` +
        `📊 *Усього сьогодні:* ${formatNumber(todayTotal)} ккал\n` +
        `${remaining >= 0 ? `✅ Залишилося: ${formatNumber(remaining)} ккал` : `⚠️ Перевищення цілі: ${formatNumber(Math.abs(remaining))} ккал`}`,
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
    waitText: '🔍 Аналізую їжу...',
    failureText: '❌ Не вдалося розпізнати їжу. Спробуй зробити чіткіше фото.',
  });
}

export async function handleFoodDescription(ctx: Context): Promise<void> {
  const description = ctx.message?.text?.trim();
  if (!ctx.from || !description) return;

  await processMeal(ctx, () => analyzeFoodDescription(description), {
    waitText: '🔍 Розраховую харчову цінність за описом...',
    failureText: '❌ Не вдалося розрахувати харчову цінність за описом. Спробуй перерахувати продукти та приблизні порції.',
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
    await ctx.reply('❌ Не вдалося отримати файл. Спробуй ще раз.');
    return;
  }

  const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  // Details are used only when sent as a photo caption.
  const caption = ctx.message?.caption?.trim();
  await processPhoto(ctx, imageUrl, bestPhoto.file_id, caption || undefined);
}
