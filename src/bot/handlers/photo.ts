import { Context, InlineKeyboard } from 'grammy';
import { analyzeFood, analyzeFoodDescription, NutritionResult } from '../../services/vision.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { isPremiumActive } from './premium.js';

const CONFIDENCE_EMOJI: Record<string, string> = {
  high: '✅',
  medium: '⚠️',
  low: '❓',
};

const MEAL_TYPE_LABELS: Record<NutritionResult['mealType'], string> = {
  meal: '🍽 Приём пищи',
  snack: '🥨 Перекус',
};

const DAILY_TOKEN_LIMIT = 30_000;

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

  // Сбрасываем счётчик если новый день
  const resetDate = new Date(user.tokensResetDate);
  resetDate.setHours(0, 0, 0, 0);
  if (resetDate < today) {
    user.dailyTokensUsed = 0;
    user.tokensResetDate = today;
    await user.save();
  }

  if (!isPremiumActive(user.premiumUntil) && user.dailyTokensUsed >= DAILY_TOKEN_LIMIT) {
    await ctx.reply(
      '⛔ Ты достиг лимита сканирований на сегодня. Лимиты обновятся завтра.\n\n' +
        '💎 Premium снимает дневной лимит и открывает расширенную статистику.'
    );
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

    const todayTotal = todayEntries.reduce((sum, e) => sum + e.calories, 0);
    const remaining = (user.dailyCalorieGoal || 2000) - todayTotal;
    const confidenceLabel = CONFIDENCE_EMOJI[nutrition.confidence] ?? '⚠️';
    const mealTypeLabel = MEAL_TYPE_LABELS[nutrition.mealType];
    const keyboard = new InlineKeyboard().text('✏️ Редактировать', `edit_entry_${entry._id}`);

    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id);

    await ctx.reply(
      `🍽 *${nutrition.foodDescription}*\n\n` +
        `${mealTypeLabel}\n` +
        `🔥 Калории: *${nutrition.calories} ккал*\n` +
        `🥩 Белки: ${nutrition.protein}г\n` +
        `🍞 Углеводы: ${nutrition.carbs}г\n` +
        `🧈 Жиры: ${nutrition.fat}г\n\n` +
        `${confidenceLabel} Точность: ${nutrition.confidence}\n\n` +
        `📊 *Сегодня итого:* ${todayTotal} ккал\n` +
        `${remaining >= 0 ? `✅ Остаток: ${remaining} ккал` : `⚠️ Превышение: ${Math.abs(remaining)} ккал`}`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => null);
    console.error('Meal handler error:', err);
    await ctx.reply(options.failureText);
  }
}

async function processPhoto(ctx: Context, imageUrl: string, fileId: string, details?: string): Promise<void> {
  await processMeal(ctx, () => analyzeFood(imageUrl, details), {
    photoFileId: fileId,
    waitText: '🔍 Анализирую еду...',
    failureText: '❌ Не удалось распознать еду. Попробуй сделать более чёткое фото.',
  });
}

export async function handleFoodDescription(ctx: Context): Promise<void> {
  const description = ctx.message?.text?.trim();
  if (!ctx.from || !description) return;

  await processMeal(ctx, () => analyzeFoodDescription(description), {
    waitText: '🔍 Считаю КБЖУ по описанию...',
    failureText: '❌ Не удалось посчитать КБЖУ по описанию. Попробуй указать продукты и примерный размер порции.',
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
    await ctx.reply('❌ Не удалось получить файл. Попробуй ещё раз.');
    return;
  }

  const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  // Детали учитываются только если они отправлены подписью к фото.
  const caption = ctx.message?.caption?.trim();
  await processPhoto(ctx, imageUrl, bestPhoto.file_id, caption || undefined);
}
