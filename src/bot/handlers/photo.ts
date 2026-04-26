import { Context } from 'grammy';
import { analyzeFood } from '../../services/vision.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';

const CONFIDENCE_EMOJI: Record<string, string> = {
  high: '✅',
  medium: '⚠️',
  low: '❓',
};

export async function handlePhoto(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  const waitMsg = await ctx.reply('🔍 Анализирую блюдо...');

  try {
    // Берём самое высокое качество (последнее в массиве)
    const bestPhoto = photos[photos.length - 1];
    const file = await ctx.api.getFile(bestPhoto.file_id);

    if (!file.file_path) throw new Error('Не удалось получить файл');

    const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const nutrition = await analyzeFood(imageUrl);

    // Upsert пользователя и получаем его _id
    const user = await User.findOneAndUpdate(
      { telegramId: tgUser.id },
      { telegramId: tgUser.id, username: tgUser.username, firstName: tgUser.first_name },
      { upsert: true, new: true }
    );

    await FoodEntry.create({
      userId: user._id,
      telegramId: tgUser.id,
      foodDescription: nutrition.foodDescription,
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
      confidence: nutrition.confidence,
      photoFileId: bestPhoto.file_id,
    });

    // Считаем итого за сегодня
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEntries = await FoodEntry.find({
      telegramId: tgUser.id,
      createdAt: { $gte: todayStart },
    });

    const todayTotal = todayEntries.reduce((sum, e) => sum + e.calories, 0);
    const remaining = (user.dailyCalorieGoal || 2000) - todayTotal;

    const confidenceLabel = CONFIDENCE_EMOJI[nutrition.confidence] ?? '⚠️';

    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id);

    await ctx.reply(
      `🍽 *${nutrition.foodDescription}*\n\n` +
        `🔥 Калории: *${nutrition.calories} ккал*\n` +
        `🥩 Белки: ${nutrition.protein}г\n` +
        `🍞 Углеводы: ${nutrition.carbs}г\n` +
        `🧈 Жиры: ${nutrition.fat}г\n\n` +
        `${confidenceLabel} Точность: ${nutrition.confidence}\n\n` +
        `📊 *Сегодня итого:* ${todayTotal} ккал\n` +
        `${remaining >= 0 ? `✅ Остаток: ${remaining} ккал` : `⚠️ Превышение: ${Math.abs(remaining)} ккал`}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => null);

    console.error('Photo handler error:', err);
    await ctx.reply('❌ Не удалось распознать блюдо. Попробуй сделать более чёткое фото.');
  }
}
