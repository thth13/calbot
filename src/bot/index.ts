import { Bot } from 'grammy';
import { handleStart, mainKeyboard } from './handlers/start.js';
import { handlePhoto } from './handlers/photo.js';
import { handleToday, handleWeek, handleHistory } from './handlers/stats.js';
import {
  handleGoal,
  handleGoalCalcCallback,
  handleGoalManualCallback,
  handleGenderCallback,
  handleActivityCallback,
  handleWizardMessage,
  wizardState,
} from './handlers/goal.js';

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command('start', handleStart);
  bot.command('today', handleToday);
  bot.command('week', handleWeek);
  bot.command('history', handleHistory);

  bot.hears('📅 Сегодня', handleToday);
  bot.hears('📊 Неделя', handleWeek);
  bot.hears('📋 История', handleHistory);
  bot.hears('🎯 Норма', handleGoal);

  // Wizard callbacks
  bot.callbackQuery('goal_calc', handleGoalCalcCallback);
  bot.callbackQuery('goal_manual', handleGoalManualCallback);
  bot.callbackQuery('gender_male', (ctx) => handleGenderCallback(ctx, 'male'));
  bot.callbackQuery('gender_female', (ctx) => handleGenderCallback(ctx, 'female'));
  bot.callbackQuery('activity_sedentary', (ctx) => handleActivityCallback(ctx, 'sedentary'));
  bot.callbackQuery('activity_light', (ctx) => handleActivityCallback(ctx, 'light'));
  bot.callbackQuery('activity_moderate', (ctx) => handleActivityCallback(ctx, 'moderate'));
  bot.callbackQuery('activity_active', (ctx) => handleActivityCallback(ctx, 'active'));
  bot.callbackQuery('activity_very_active', (ctx) => handleActivityCallback(ctx, 'very_active'));

  // Route text messages: wizard takes priority
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId && wizardState.has(telegramId)) {
      const handled = await handleWizardMessage(ctx);
      if (handled) return;
    }
    return next();
  });

  bot.on('message:photo', handlePhoto);

  bot.catch((err) => {
    console.error('Bot error:', err.error);
  });

  return bot;
}
