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
    `\n\nМожеш надсилати:\n` +
    `• фото їжі — я оціню калорійність і харчову цінність за зображенням (можлива неточність)\n` +
    `• текст — просто напиши, що і скільки ти з'їв: що точніший опис, то точніша оцінка\n` +
    `• фото з описом — це найточніший варіант\n\n` +
    `Ти отримуєш безкоштовний 3-денний пробний період, щоб спробувати CalBot.\n\n` +
    `Не обов'язково описувати все детально, але якщо додаси, що саме на тарілці та в якій кількості, результат буде точнішим.`
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
    buildInfoText(tgUser.first_name) + `\n\nСкористайся кнопками нижче, щоб переглянути статистику та профіль.`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard }
  );

  if (!existingUser) {
    await sendOnboardingGoalPrompt(ctx);
  }
}

export async function handleInfo(ctx: Context): Promise<void> {
  await ctx.reply(buildInfoText(), { parse_mode: 'Markdown', reply_markup: mainKeyboard });
}
