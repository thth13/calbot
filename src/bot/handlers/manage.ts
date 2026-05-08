import { Context, InlineKeyboard } from 'grammy';
import type { MealType } from '../../db/models/FoodEntry.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { NutritionTotals, sendGoalReachedNotification } from '../goalNotifications.js';

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  meal: '🍽 Meal',
  snack: '🥨 Snack',
};

const CONFIDENCE_EMOJI: Record<string, string> = {
  high: '✅',
  medium: '⚠️',
  low: '❓',
};

const NUTRITION_FIELDS = ['calories', 'protein', 'carbs', 'fat'] as const;

interface EditState {
  entryId: string;
  field?: 'calories' | 'protein' | 'carbs' | 'fat';
}

export const editingState = new Map<number, EditState>();

function getTodayStart(): Date {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return todayStart;
}

function sumNutritionTotals(entries: Array<Pick<NutritionTotals, (typeof NUTRITION_FIELDS)[number]>>): NutritionTotals {
  return entries.reduce<NutritionTotals>(
    (sum, entry) => ({
      calories: sum.calories + entry.calories,
      protein: sum.protein + entry.protein,
      carbs: sum.carbs + entry.carbs,
      fat: sum.fat + entry.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export async function handleDeleteEntry(ctx: Context): Promise<void> {
  const entryId = ctx.match instanceof Array ? ctx.match[1] : ctx.match as string;
  const telegramId = ctx.from?.id;
  if (!entryId || !telegramId) return;

  const entry = await FoodEntry.findOneAndDelete({ _id: entryId, telegramId });
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Entry not found', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: '✅ Entry deleted' });
  await ctx.reply('🗑 Entry deleted. Stats updated.');
}

export async function handleEditEntryStart(ctx: Context): Promise<void> {
  const entryId = ctx.match instanceof Array ? ctx.match[1] : ctx.match as string;
  if (!entryId || !ctx.from) return;

  const entry = await FoodEntry.findOne({ _id: entryId, telegramId: ctx.from.id });
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Entry not found', show_alert: true });
    return;
  }

  editingState.set(ctx.from.id, { entryId: entryId as string });

  const keyboard = new InlineKeyboard()
    .text('🔥 Calories', `edit_field_${entryId}_calories`)
    .text('🥩 Protein', `edit_field_${entryId}_protein`)
    .row()
    .text('🍞 Carbs', `edit_field_${entryId}_carbs`)
    .text('🧈 Fat', `edit_field_${entryId}_fat`)
    .row()
    .text('🥨 Meal type', `edit_meal_type_${entryId}`)
    .row()
    .text('❌ Cancel', `cancel_edit_${entryId}`);

  await ctx.reply(
    `✏️ *Edit entry*\n\n` +
      `${entry.foodDescription}\n` +
      `${MEAL_TYPE_LABELS[entry.mealType ?? 'meal']}\n` +
      `🔥 ${entry.calories} kcal\n` +
      `🥩 ${entry.protein}g  |  🍞 ${entry.carbs}g  |  🧈 ${entry.fat}g\n\n` +
      `Choose what you want to change:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  await ctx.answerCallbackQuery();
}

async function replyWithEntrySummary(ctx: Context, entryId: string, telegramId: number): Promise<void> {
  const entry = await FoodEntry.findOne({ _id: entryId, telegramId });
  if (!entry) {
    await ctx.reply('❌ Entry not found');
    return;
  }

  const todayStart = getTodayStart();

  const [user, todayEntries] = await Promise.all([
    User.findOne({ telegramId }),
    FoodEntry.find({
      telegramId,
      createdAt: { $gte: todayStart },
    }),
  ]);

  const todayTotal = sumNutritionTotals(todayEntries).calories;
  const remaining = (user?.dailyCalorieGoal || 2000) - todayTotal;
  const confidenceLabel = CONFIDENCE_EMOJI[entry.confidence] ?? '⚠️';
  const mealTypeLabel = MEAL_TYPE_LABELS[entry.mealType ?? 'meal'];
  const keyboard = new InlineKeyboard().text('✏️ Edit', `edit_entry_${entry._id}`);

  await ctx.reply(
    `🍽 *${entry.foodDescription}*\n\n` +
      `${mealTypeLabel}\n` +
      `🔥 Calories: *${entry.calories} kcal*\n` +
      `🥩 Protein: ${entry.protein}g\n` +
      `🍞 Carbs: ${entry.carbs}g\n` +
      `🧈 Fat: ${entry.fat}g\n\n` +
      `${confidenceLabel} Confidence: ${entry.confidence}\n\n` +
      `📊 *Today total:* ${todayTotal} kcal\n` +
      `${remaining >= 0 ? `✅ Remaining: ${remaining} kcal` : `⚠️ Over goal: ${Math.abs(remaining)} kcal`}`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleSelectEditField(ctx: Context): Promise<void> {
  const match = ctx.match;
  const entryId = match instanceof Array ? match[1] : undefined;
  const field = match instanceof Array ? match[2] : undefined;

  if (!entryId || !field || !['calories', 'protein', 'carbs', 'fat'].includes(field)) return;

  const entry = ctx.from ? await FoodEntry.findOne({ _id: entryId, telegramId: ctx.from.id }) : null;
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Entry not found', show_alert: true });
    return;
  }

  if (ctx.from) {
    editingState.set(ctx.from.id, { entryId, field: field as EditState['field'] });
  }

  const labels = {
    calories: '🔥 Calories (kcal)',
    protein: '🥩 Protein (g)',
    carbs: '🍞 Carbs (g)',
    fat: '🧈 Fat (g)',
  };

  await ctx.reply(`Enter a new value for ${labels[field as keyof typeof labels]}:`);
  await ctx.answerCallbackQuery();
}

export async function handleSelectMealType(ctx: Context): Promise<void> {
  const entryId = ctx.match instanceof Array ? ctx.match[1] : ctx.match as string;
  if (!entryId || !ctx.from) return;

  const entry = await FoodEntry.findOne({ _id: entryId, telegramId: ctx.from.id });
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Entry not found', show_alert: true });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('🥨 Snack', `set_meal_type_${entryId}_snack`)
    .text('🍽 Meal', `set_meal_type_${entryId}_meal`)
    .row()
    .text('❌ Cancel', `cancel_edit_${entryId}`);

  await ctx.reply('Choose the meal type:', { reply_markup: keyboard });
  await ctx.answerCallbackQuery();
}

export async function handleSetMealType(ctx: Context): Promise<void> {
  const match = ctx.match;
  const entryId = match instanceof Array ? match[1] : undefined;
  const mealType = match instanceof Array ? match[2] : undefined;
  const telegramId = ctx.from?.id;

  if (!entryId || !telegramId || !mealType || !['meal', 'snack'].includes(mealType)) return;

  const entry = await FoodEntry.findOne({ _id: entryId, telegramId });
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Entry not found', show_alert: true });
    return;
  }

  entry.mealType = mealType as MealType;
  await entry.save();
  editingState.delete(telegramId);

  await ctx.answerCallbackQuery({ text: '✅ Meal type updated' });
  await replyWithEntrySummary(ctx, entryId, telegramId);
}

export async function handleEditFieldValue(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.message?.text) return false;

  const state = editingState.get(telegramId);
  if (!state?.field) return false;

  const value = parseFloat(ctx.message.text);
  if (isNaN(value) || value < 0) {
    await ctx.reply('❌ Enter a valid number (>= 0)');
    return true;
  }

  try {
    const entry = await FoodEntry.findOne({ _id: state.entryId, telegramId });
    if (!entry) {
      await ctx.reply('❌ Entry not found');
      editingState.delete(telegramId);
      return true;
    }

    const todayStart = getTodayStart();
    const isTodayEntry = entry.createdAt >= todayStart;
    const [user, todayEntries] = await Promise.all([
      User.findOne({ telegramId }),
      isTodayEntry ? FoodEntry.find({ telegramId, createdAt: { $gte: todayStart } }) : Promise.resolve([]),
    ]);
    const previousTotals = sumNutritionTotals(todayEntries);
    const oldValue = entry[state.field];

    entry[state.field] = value;
    await entry.save();

    editingState.delete(telegramId);

    await replyWithEntrySummary(ctx, state.entryId, telegramId);
    if (user && isTodayEntry) {
      await sendGoalReachedNotification(
        ctx,
        previousTotals,
        { ...previousTotals, [state.field]: previousTotals[state.field] - oldValue + value },
        user
      );
    }

    return true;
  } catch (err) {
    console.error('Edit field error:', err);
    await ctx.reply('❌ Error while saving');
    editingState.delete(telegramId);
    return true;
  }
}

export async function handleCancelEdit(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    editingState.delete(telegramId);
  }
  await ctx.answerCallbackQuery({ text: '❌ Editing canceled' });
}
