import { Context } from 'grammy';
import { Keyboard } from 'grammy';
import { User } from '../../db/models/User.js';
import { sendOnboardingGoalPrompt } from './goal.js';
import { recordBotEvent } from '../analytics.js';
import { getWebAppUrl } from '../webApp.js';

export const mainKeyboard = new Keyboard()
  .webApp('📱 Open app', getWebAppUrl())
  .row()
  .text('📅 Today').text('📊 Week')
  .row()
  .text('📋 History').text('👤 My profile')
  .resized();

function buildInfoText(firstName?: string): string {
  const greeting = firstName
    ? `👋 Hi, ${firstName}! I am CalBot, your nutrition and calorie tracking assistant.`
    : `👋 Hi! I am CalBot, your nutrition and calorie tracking assistant.`;

  return (
    greeting +
    `\n\nSend a photo of your meal and optionally add a description. You can also send a description without a photo. For a more accurate estimate, include the ingredients and their weights in grams.\n\n` +
    `You get a free 14-day trial of CalBot. After that, the price is $4.99 per month or $39.99 per year (USD).`
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
