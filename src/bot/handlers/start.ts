import { Context } from 'grammy';
import { Keyboard } from 'grammy';
import { User } from '../../db/models/User.js';

export const mainKeyboard = new Keyboard()
  .text('📅 Сегодня').text('📊 Неделя')
  .row()
  .text('📋 История').text('👤 Мой профиль')
  .resized();

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
      `📸 Просто отправь фото тарелки — я определю блюдо и подсчитаю КБЖУ.\n\n` +
      `Используй кнопки ниже для просмотра статистики.`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
  );
}
