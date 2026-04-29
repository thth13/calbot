import { Context, InlineKeyboard } from 'grammy';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';

interface EditState {
  entryId: string;
  field?: 'calories' | 'protein' | 'carbs' | 'fat';
}

export const editingState = new Map<number, EditState>();

export async function handleDeleteEntry(ctx: Context): Promise<void> {
  const entryId = ctx.match instanceof Array ? ctx.match[1] : ctx.match as string;
  if (!entryId) return;

  const entry = await FoodEntry.findByIdAndDelete(entryId);
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

  const entry = await FoodEntry.findById(entryId);
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
    .text('❌ Отмена', `cancel_edit_${entryId}`);

  await ctx.reply(
    `✏️ *Редактирование записи*\n\n` +
      `${entry.foodDescription}\n` +
      `🔥 ${entry.calories} ккал\n` +
      `🥩 ${entry.protein}г  |  🍞 ${entry.carbs}г  |  🧈 ${entry.fat}г\n\n` +
      `Выбери, что хочешь изменить:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  await ctx.answerCallbackQuery();
}

export async function handleSelectEditField(ctx: Context): Promise<void> {
  const match = ctx.match instanceof Array ? ctx.match[1] : ctx.match;
  
  if (!match) return;

  const [entryId, field] = match.toString().split('_') || [];

  if (!entryId || !field || !['calories', 'protein', 'carbs', 'fat'].includes(field)) return;

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
    const entry = await FoodEntry.findById(state.entryId);
    if (!entry) {
      await ctx.reply('❌ Запись не найдена');
      editingState.delete(telegramId);
      return true;
    }

    const oldValue = entry[state.field];
    entry[state.field] = value;
    await entry.save();

    editingState.delete(telegramId);

    const labels = {
      calories: '🔥 Калории',
      protein: '🥩 Белки',
      carbs: '🍞 Углеводы',
      fat: '🧈 Жиры',
    };

    await ctx.reply(
      `✅ ${labels[state.field]} изменены\n` + `${oldValue} → ${value}`,
      { parse_mode: 'Markdown' }
    );

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
