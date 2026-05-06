import { Context, InlineKeyboard } from 'grammy';
import type { MealType } from '../../db/models/FoodEntry.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { NutritionTotals, sendGoalReachedNotification } from '../goalNotifications.js';

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  meal: '🍽 Приём пищи',
  snack: '🥨 Перекус',
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
    await ctx.answerCallbackQuery({ text: '❌ Запись не найдена', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: '✅ Запись удалена' });
  await ctx.reply('🗑 Запись удалена. Статистика обновлена.');
}

export async function handleEditEntryStart(ctx: Context): Promise<void> {
  const entryId = ctx.match instanceof Array ? ctx.match[1] : ctx.match as string;
  if (!entryId || !ctx.from) return;

  const entry = await FoodEntry.findOne({ _id: entryId, telegramId: ctx.from.id });
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Запись не найдена', show_alert: true });
    return;
  }

  editingState.set(ctx.from.id, { entryId: entryId as string });

  const keyboard = new InlineKeyboard()
    .text('🔥 Калории', `edit_field_${entryId}_calories`)
    .text('🥩 Белки', `edit_field_${entryId}_protein`)
    .row()
    .text('🍞 Углеводы', `edit_field_${entryId}_carbs`)
    .text('🧈 Жиры', `edit_field_${entryId}_fat`)
    .row()
    .text('🥨 Тип приёма', `edit_meal_type_${entryId}`)
    .row()
    .text('❌ Отмена', `cancel_edit_${entryId}`);

  await ctx.reply(
    `✏️ *Редактирование записи*\n\n` +
      `${entry.foodDescription}\n` +
      `${MEAL_TYPE_LABELS[entry.mealType ?? 'meal']}\n` +
      `🔥 ${entry.calories} ккал\n` +
      `🥩 ${entry.protein}г  |  🍞 ${entry.carbs}г  |  🧈 ${entry.fat}г\n\n` +
      `Выбери, что хочешь изменить:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  await ctx.answerCallbackQuery();
}

async function replyWithEntrySummary(ctx: Context, entryId: string, telegramId: number): Promise<void> {
  const entry = await FoodEntry.findOne({ _id: entryId, telegramId });
  if (!entry) {
    await ctx.reply('❌ Запись не найдена');
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
  const keyboard = new InlineKeyboard().text('✏️ Редактировать', `edit_entry_${entry._id}`);

  await ctx.reply(
    `🍽 *${entry.foodDescription}*\n\n` +
      `${mealTypeLabel}\n` +
      `🔥 Калории: *${entry.calories} ккал*\n` +
      `🥩 Белки: ${entry.protein}г\n` +
      `🍞 Углеводы: ${entry.carbs}г\n` +
      `🧈 Жиры: ${entry.fat}г\n\n` +
      `${confidenceLabel} Точность: ${entry.confidence}\n\n` +
      `📊 *Сегодня итого:* ${todayTotal} ккал\n` +
      `${remaining >= 0 ? `✅ Остаток: ${remaining} ккал` : `⚠️ Превышение: ${Math.abs(remaining)} ккал`}`,
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
    await ctx.answerCallbackQuery({ text: '❌ Запись не найдена', show_alert: true });
    return;
  }

  if (ctx.from) {
    editingState.set(ctx.from.id, { entryId, field: field as EditState['field'] });
  }

  const labels = {
    calories: '🔥 Калории (ккал)',
    protein: '🥩 Белки (г)',
    carbs: '🍞 Углеводы (г)',
    fat: '🧈 Жиры (г)',
  };

  await ctx.reply(`Введи новое значение для ${labels[field as keyof typeof labels]}:`);
  await ctx.answerCallbackQuery();
}

export async function handleSelectMealType(ctx: Context): Promise<void> {
  const entryId = ctx.match instanceof Array ? ctx.match[1] : ctx.match as string;
  if (!entryId || !ctx.from) return;

  const entry = await FoodEntry.findOne({ _id: entryId, telegramId: ctx.from.id });
  if (!entry) {
    await ctx.answerCallbackQuery({ text: '❌ Запись не найдена', show_alert: true });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('🥨 Перекус', `set_meal_type_${entryId}_snack`)
    .text('🍽 Приём пищи', `set_meal_type_${entryId}_meal`)
    .row()
    .text('❌ Отмена', `cancel_edit_${entryId}`);

  await ctx.reply('Выбери тип приёма:', { reply_markup: keyboard });
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
    await ctx.answerCallbackQuery({ text: '❌ Запись не найдена', show_alert: true });
    return;
  }

  entry.mealType = mealType as MealType;
  await entry.save();
  editingState.delete(telegramId);

  await ctx.answerCallbackQuery({ text: '✅ Тип приёма изменён' });
  await replyWithEntrySummary(ctx, entryId, telegramId);
}

export async function handleEditFieldValue(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId || !ctx.message?.text) return false;

  const state = editingState.get(telegramId);
  if (!state?.field) return false;

  const value = parseFloat(ctx.message.text);
  if (isNaN(value) || value < 0) {
    await ctx.reply('❌ Введи корректное число (≥ 0)');
    return true;
  }

  try {
    const entry = await FoodEntry.findOne({ _id: state.entryId, telegramId });
    if (!entry) {
      await ctx.reply('❌ Запись не найдена');
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
    await ctx.reply('❌ Ошибка при сохранении');
    editingState.delete(telegramId);
    return true;
  }
}

export async function handleCancelEdit(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    editingState.delete(telegramId);
  }
  await ctx.answerCallbackQuery({ text: '❌ Редактирование отменено' });
}
