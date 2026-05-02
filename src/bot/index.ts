import { Bot } from 'grammy';
import { handleStart, mainKeyboard } from './handlers/start.js';
import { handleFoodDescription, handlePhoto, handlePhotoDetails, handlePhotoSkip } from './handlers/photo.js';
import { handleToday, handleWeek, handleHistory, handleExtendedStats } from './handlers/stats.js';
import { handlePremium } from './handlers/premium.js';
import {
  handleGoal,
  handleGoalCalcCallback,
  handleGoalManualCallback,
  handleManualGoalCancelCallback,
  handleManualGoalFieldCallback,
  handleManualGoalSaveCallback,
  handleGenderCallback,
  handleActivityCallback,
  handleWizardMessage,
  wizardState,
} from './handlers/goal.js';
import {
  handleDeleteEntry,
  handleEditEntryStart,
  handleSelectEditField,
  handleEditFieldValue,
  handleCancelEdit,
  editingState,
} from './handlers/manage.js';

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command('start', handleStart);
  bot.command('today', handleToday);
  bot.command('week', handleWeek);
  bot.command('history', handleHistory);
  bot.command('premium', handlePremium);
  bot.command('extended', handleExtendedStats);

  bot.hears('📅 Сегодня', handleToday);
  bot.hears('📊 Неделя', handleWeek);
  bot.hears('📋 История', handleHistory);
  bot.hears('📈 Расширенная', handleExtendedStats);
  bot.hears('👤 Мой профиль', handleGoal);
  bot.hears('💎 Premium', handlePremium);

  // Wizard callbacks
  bot.callbackQuery('goal_calc', handleGoalCalcCallback);
  bot.callbackQuery('goal_manual', handleGoalManualCallback);
  bot.callbackQuery(/^manual_goal_(calories|protein|carbs|fat)$/, handleManualGoalFieldCallback);
  bot.callbackQuery('manual_goal_save', handleManualGoalSaveCallback);
  bot.callbackQuery('manual_goal_cancel', handleManualGoalCancelCallback);
  bot.callbackQuery('gender_male', (ctx) => handleGenderCallback(ctx, 'male'));
  bot.callbackQuery('gender_female', (ctx) => handleGenderCallback(ctx, 'female'));
  bot.callbackQuery('activity_sedentary', (ctx) => handleActivityCallback(ctx, 'sedentary'));
  bot.callbackQuery('activity_light', (ctx) => handleActivityCallback(ctx, 'light'));
  bot.callbackQuery('activity_moderate', (ctx) => handleActivityCallback(ctx, 'moderate'));
  bot.callbackQuery('activity_active', (ctx) => handleActivityCallback(ctx, 'active'));
  bot.callbackQuery('activity_very_active', (ctx) => handleActivityCallback(ctx, 'very_active'));

  // Edit/delete entry callbacks
  bot.callbackQuery(/^edit_entry_(.+)$/, handleEditEntryStart);
  bot.callbackQuery(/^delete_entry_(.+)$/, handleDeleteEntry);
  bot.callbackQuery(/^edit_field_.+_(calories|protein|carbs|fat)$/, handleSelectEditField);
  bot.callbackQuery(/^cancel_edit_(.+)$/, handleCancelEdit);

  // Route text messages: editing state takes priority, then wizard and pending photo
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      if (editingState.has(telegramId)) {
        const handled = await handleEditFieldValue(ctx);
        if (handled) return;
      }
      if (await handlePhotoDetails(ctx)) return;
      if (wizardState.has(telegramId)) {
        const handled = await handleWizardMessage(ctx);
        if (handled) return;
      }
    }
    if (ctx.message.text.startsWith('/')) return next();

    await handleFoodDescription(ctx);
  });

  bot.callbackQuery('photo_skip', handlePhotoSkip);
  bot.on('message:photo', handlePhoto);

  bot.catch((err) => {
    console.error('Bot error:', err.error);
  });

  return bot;
}
