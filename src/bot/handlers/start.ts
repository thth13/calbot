import { Context } from 'grammy';
import { User } from '../db/models/User.js';

export async function handleStart(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  await User.findOneAndUpdate(
    { telegramId: tgUser.id },
    {
      telegramId: tgUser.id,
      username: tgUser.username,
      firstName: tgUser.first_name,
    },
    { upsert: true, new: true }
  );

  await ctx.reply(
    `👋 Привет, ${tgUser.first_name}!\n\n` +
      `Я считаю калории по фото еды.\n\n` +
      `📸 *Как пользоваться:*\n` +
      `Просто отправь фото тарелки — я определю блюдо и подсчитаю КБЖУ.\n\n` +
      `📊 *Команды:*\n` +
      `/today — сводка за сегодня\n` +
      `/week — статистика за неделю\n` +
      `/history — последние 10 записей\n` +
      `/goal — установить дневную норму калорий`,
    { parse_mode: 'Markdown' }
  );
}
