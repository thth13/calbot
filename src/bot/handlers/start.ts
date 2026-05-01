import { Context } from 'grammy';
import { Keyboard } from 'grammy';
import { User } from '../../db/models/User.js';

export const mainKeyboard = new Keyboard()
  .text('📅 Сегодня').text('📊 Неделя')
  .row()
  .text('📋 История').text('📈 Расширенная')
  .row()
  .text('👤 Мой профиль').text('💎 Premium')
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
      `Я считаю калории по фото еды или описанию тарелки.\n\n` +
      `📸 Отправь фото тарелки — я определю блюдо и подсчитаю КБЖУ.\n` +
      `📝 Или просто напиши, что было на тарелке, если фото нет.\n\n` +
      `Используй кнопки ниже для просмотра статистики и профиля.`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
  );
}
