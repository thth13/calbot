import { Bot } from 'grammy';
import { answerGeneralQuestion, classifyTextMessageIntent } from '../services/assistant.js';
import { handleInfo, handleStart, mainKeyboard } from './handlers/start.js';
import { handleFoodDescription, handlePhoto } from './handlers/photo.js';
import { handleToday, handleWeek, handleHistory, handleExtendedStats } from './handlers/stats.js';
import { handlePremium } from './handlers/premium.js';
import {
  handleActivityCallback,
  handleGenderCallback,
  handleGoal,
  handleGoalBackCallback,
  handleGoalCalcCallback,
  handleGoalCancelCallback,
  handleGoalChangeCallback,
  handleGoalExplainCallback,
  handleGoalManualCallback,
  handleGoalRestartCallback,
  handleGoalSaveCallback,
  handleGoalTypeCallback,
  handleManualGoalCancelCallback,
  handleManualGoalFieldCallback,
  handleManualGoalSaveCallback,
  handleSportCallback,
  handleSportTypeCallback,
  handleTrainingDurationCallback,
  handleTrainingFrequencyCallback,
  handleWizardMessage,
  wizardState,
} from './handlers/goal.js';
import {
  handleDeleteEntry,
  handleEditEntryStart,
  handleSelectEditField,
  handleEditFieldValue,
  handleCancelEdit,
  handleSelectMealType,
  handleSetMealType,
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
  bot.command('info', handleInfo);

  bot.hears('📅 Сегодня', handleToday);
  bot.hears('📊 Неделя', handleWeek);
  bot.hears('📋 История', handleHistory);
  bot.hears('📈 Расширенная', handleExtendedStats);
  bot.hears('👤 Мой профиль', handleGoal);
  bot.hears('💎 Premium', handlePremium);

  // Wizard callbacks
  bot.callbackQuery('goal_calc', handleGoalCalcCallback);
  bot.callbackQuery('goal_back', handleGoalBackCallback);
  bot.callbackQuery('goal_cancel', handleGoalCancelCallback);
  bot.callbackQuery('goal_save', handleGoalSaveCallback);
  bot.callbackQuery('goal_change', handleGoalChangeCallback);
  bot.callbackQuery('goal_restart', handleGoalRestartCallback);
  bot.callbackQuery('goal_explain', handleGoalExplainCallback);
  bot.callbackQuery('goal_type_lose_weight', (ctx) => handleGoalTypeCallback(ctx, 'lose_weight'));
  bot.callbackQuery('goal_type_maintain_weight', (ctx) => handleGoalTypeCallback(ctx, 'maintain_weight'));
  bot.callbackQuery('goal_type_gain_muscle', (ctx) => handleGoalTypeCallback(ctx, 'gain_muscle'));
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
  bot.callbackQuery('sport_no', (ctx) => handleSportCallback(ctx, false));
  bot.callbackQuery('sport_yes', (ctx) => handleSportCallback(ctx, true));
  bot.callbackQuery('sport_type_strength', (ctx) => handleSportTypeCallback(ctx, 'strength'));
  bot.callbackQuery('sport_type_cardio', (ctx) => handleSportTypeCallback(ctx, 'cardio'));
  bot.callbackQuery('sport_type_mixed', (ctx) => handleSportTypeCallback(ctx, 'mixed'));
  bot.callbackQuery('sport_type_team', (ctx) => handleSportTypeCallback(ctx, 'team'));
  bot.callbackQuery('sport_type_martial_arts', (ctx) => handleSportTypeCallback(ctx, 'martial_arts'));
  bot.callbackQuery('sport_type_other', (ctx) => handleSportTypeCallback(ctx, 'other'));
  bot.callbackQuery('training_frequency_low', (ctx) => handleTrainingFrequencyCallback(ctx, 'low'));
  bot.callbackQuery('training_frequency_medium', (ctx) => handleTrainingFrequencyCallback(ctx, 'medium'));
  bot.callbackQuery('training_frequency_high', (ctx) => handleTrainingFrequencyCallback(ctx, 'high'));
  bot.callbackQuery('training_duration_short', (ctx) => handleTrainingDurationCallback(ctx, 'short'));
  bot.callbackQuery('training_duration_medium', (ctx) => handleTrainingDurationCallback(ctx, 'medium'));
  bot.callbackQuery('training_duration_long', (ctx) => handleTrainingDurationCallback(ctx, 'long'));
  bot.callbackQuery('training_duration_extra_long', (ctx) => handleTrainingDurationCallback(ctx, 'extra_long'));

  // Edit/delete entry callbacks
  bot.callbackQuery(/^edit_entry_(.+)$/, handleEditEntryStart);
  bot.callbackQuery(/^delete_entry_(.+)$/, handleDeleteEntry);
  bot.callbackQuery(/^edit_field_(.+)_(calories|protein|carbs|fat)$/, handleSelectEditField);
  bot.callbackQuery(/^edit_meal_type_(.+)$/, handleSelectMealType);
  bot.callbackQuery(/^set_meal_type_(.+)_(meal|snack)$/, handleSetMealType);
  bot.callbackQuery(/^cancel_edit_(.+)$/, handleCancelEdit);

  // Route text messages: editing state takes priority, then wizard
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      if (editingState.has(telegramId)) {
        const handled = await handleEditFieldValue(ctx);
        if (handled) return;
      }
      if (wizardState.has(telegramId)) {
        const handled = await handleWizardMessage(ctx);
        if (handled) return;
      }
    }
    if (ctx.message.text.startsWith('/')) return next();

    try {
      const intent = await classifyTextMessageIntent(ctx.message.text);
      if (intent === 'meal_log') {
        await handleFoodDescription(ctx);
        return;
      }

      const answer = await answerGeneralQuestion(ctx.message.text);
      await ctx.reply(answer);
    } catch (err) {
      console.error('Text intent/assistant handler error:', err);
      await handleFoodDescription(ctx);
    }
  });

  bot.on('message:photo', handlePhoto);

  bot.catch((err) => {
    console.error('Bot error:', err.error);
  });

  return bot;
}
