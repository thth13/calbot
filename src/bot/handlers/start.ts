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

function buildInfoText(firstName?: string): string {
  const greeting = firstName ? `👋 Hi, ${firstName}! I'm CalBot — your nutrition and calorie tracking assistant.` : `👋 Hi! I'm CalBot — your nutrition and calorie tracking assistant.`;

  return (
    greeting +
    `\n\nYou can send:\n` +
    `• 📸 a food photo — I'll estimate calories and nutritional value from the image (some inaccuracy is possible)\n` +
    `• 📝 text — just write what you ate and how much: the more precise your description, the more accurate the estimate\n` +
    `• 📸 + 📝 a photo with a description — this is the most accurate option\n\n` +
    `📊 You don't have to describe everything in detail, but if you add what is on the plate and how much, the result will be more accurate.`
  );
}

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
    buildInfoText(tgUser.first_name) + `\n\nUse the buttons below to view your stats and profile.`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
  );
}

export async function handleInfo(ctx: Context): Promise<void> {
  await ctx.reply(buildInfoText(), { parse_mode: 'Markdown', reply_markup: mainKeyboard });
}
