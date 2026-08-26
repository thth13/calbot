import { Context } from 'grammy';
import { Keyboard } from 'grammy';
import { User } from '../../db/models/User.js';
import { sendOnboardingGoalPrompt } from './goal.js';
import { recordBotEvent } from '../analytics.js';

export const mainKeyboard = new Keyboard()
  .text('📅 Сьогодні').text('📊 Тиждень')
  .row()
  .text('📋 Історія').text('👤 Мій профіль')
  .resized();

function buildInfoText(firstName?: string): string {
  const greeting = firstName
    ? `👋 Привіт, ${firstName}! Я CalBot — твій помічник з відстеження харчування та калорій.`
    : `👋 Привіт! Я CalBot — твій помічник з відстеження харчування та калорій.`;

  return (
    greeting +
    `\n\nПросто надішли сюди фото своєї страви та, за бажанням, додай опис. Також можеш надіслати лише опис без фото. Для точнішої оцінки вкажи, які інгредієнти та скільки грамів було додано.\n\n` +
    `Ти отримуєш безкоштовний 14-денний пробний період, щоб спробувати CalBot. Після цього вартість становитиме 200 грн на місяць.`
  );
}

export async function handleStart(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const existingUser = await User.findOne({ telegramId: tgUser.id });
  await User.findOneAndUpdate(
    { telegramId: tgUser.id },
    {
      telegramId: tgUser.id,
      username: tgUser.username,
      firstName: tgUser.first_name,
    },
    { upsert: true, new: true }
  );

  await recordBotEvent(ctx, 'bot_started');

  await ctx.reply(
    buildInfoText(tgUser.first_name),
    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
  );

  if (!existingUser) {
    await sendOnboardingGoalPrompt(ctx);
  }
}

export async function handleInfo(ctx: Context): Promise<void> {
  await ctx.reply(buildInfoText(), { parse_mode: 'Markdown', reply_markup: mainKeyboard });
}
