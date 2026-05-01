import { Context, InlineKeyboard } from 'grammy';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { buildPremiumKeyboard, isPremiumActive } from './premium.js';

function formatEntry(entry: { foodDescription: string; calories: number; createdAt: Date }): string {
  const time = entry.createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `  • ${time} — ${entry.foodDescription} (${entry.calories} ккал)`;
}

function buildSummaryLine(calories: number, goal: number): string {
  const pct = Math.round((calories / goal) * 100);
  const bar = buildProgressBar(pct);
  return `${bar} ${pct}% от нормы`;
}

function buildProgressBar(pct: number): string {
  const filled = Math.min(10, Math.round(pct / 10));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export async function handleToday(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [entries, user] = await Promise.all([
    FoodEntry.find({ telegramId, createdAt: { $gte: start } }).sort({ createdAt: 1 }),
    User.findOne({ telegramId }),
  ]);

  if (entries.length === 0) {
    await ctx.reply('📭 Сегодня записей нет. Отправь фото еды!');
    return;
  }

  const goal = user?.dailyCalorieGoal;
  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const lines = entries.map(formatEntry).join('\n');
  const goalLine = goal
    ? `🔥 Калории: *${totals.calories}* / ${goal} ккал\n${buildSummaryLine(totals.calories, goal)}`
    : `🔥 Калории: *${totals.calories}* ккал _(норма не задана)_`;

  await ctx.reply(
    `📅 *Сегодня, ${new Date().toLocaleDateString('ru-RU')}*\n\n` +
      `${lines}\n\n` +
      `─────────────────\n` +
      `${goalLine}\n\n` +
      `🥩 Белки: ${totals.protein}г  |  🍞 Углеводы: ${totals.carbs}г  |  🧈 Жиры: ${totals.fat}г`,
    { parse_mode: 'Markdown' }
  );

  // Показываем кнопки редактирования для каждой записи
  for (const entry of entries) {
    const keyboard = new InlineKeyboard()
      .text('✏️ Редактировать', `edit_entry_${entry._id}`)
      .text('🗑 Удалить', `delete_entry_${entry._id}`);

    await ctx.reply(`${entry.foodDescription} — ${entry.calories} ккал`, { reply_markup: keyboard });
  }
}

export async function handleWeek(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);

  const [entries, user] = await Promise.all([
    FoodEntry.find({ telegramId, createdAt: { $gte: weekAgo } }).sort({ createdAt: 1 }),
    User.findOne({ telegramId }),
  ]);

  if (entries.length === 0) {
    await ctx.reply('📭 За последние 7 дней записей нет.');
    return;
  }

  const goal = user?.dailyCalorieGoal;

  // Группируем по дням
  const byDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number; count: number }>();

  for (const e of entries) {
    const day = e.createdAt.toLocaleDateString('ru-RU');
    const cur = byDay.get(day) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    byDay.set(day, {
      calories: cur.calories + e.calories,
      protein: cur.protein + e.protein,
      carbs: cur.carbs + e.carbs,
      fat: cur.fat + e.fat,
      count: cur.count + 1,
    });
  }

  const dayLines = Array.from(byDay.entries())
    .map(([date, d]) => {
      const icon = goal
        ? d.calories > goal ? '🔴' : d.calories > goal * 0.8 ? '🟡' : '🟢'
        : '⚪';
      return `${icon} ${date}: *${d.calories}* ккал (${d.count} приёма)`;
    })
    .join('\n');

  const totalCalories = entries.reduce((s, e) => s + e.calories, 0);
  const totalProtein = entries.reduce((s, e) => s + e.protein, 0);
  const totalCarbs = entries.reduce((s, e) => s + e.carbs, 0);
  const totalFat = entries.reduce((s, e) => s + e.fat, 0);
  const days = byDay.size;

  await ctx.reply(
    `📊 *Статистика за 7 дней*\n\n` +
      `${dayLines}\n\n` +
      `─────────────────\n` +
      `📈 Среднее/день: *${Math.round(totalCalories / days)}* ккал\n` +
      `🔥 Всего: ${totalCalories} ккал\n` +
      `🥩 Белки: ${totalProtein}г  |  🍞 Углеводы: ${totalCarbs}г  |  🧈 Жиры: ${totalFat}г` +
      (goal ? `\n\n🟢 < 80% нормы  🟡 80–100%  🔴 > нормы` : ''),
    { parse_mode: 'Markdown' }
  );
}

export async function handleHistory(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const entries = await FoodEntry.find({ telegramId }).sort({ createdAt: -1 }).limit(10);

  if (entries.length === 0) {
    await ctx.reply('📭 История пуста. Отправь фото еды!');
    return;
  }

  await ctx.reply(`📋 *Последние ${entries.length} записей:*`, { parse_mode: 'Markdown' });

  for (const e of entries) {
    const dt = e.createdAt.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const keyboard = new InlineKeyboard()
      .text('✏️ Редактировать', `edit_entry_${e._id}`)
      .text('🗑 Удалить', `delete_entry_${e._id}`);

    const text =
      `${dt} — *${e.foodDescription}*\n` +
      `🔥 ${e.calories} ккал  |  🥩 ${e.protein}г  |  🍞 ${e.carbs}г  |  🧈 ${e.fat}г`;

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function handleExtendedStats(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  if (!isPremiumActive(user?.premiumUntil)) {
    await ctx.reply(
      `📈 *Расширенная статистика доступна в Premium*\n\n` +
        `Premium открывает 30-дневную динамику, средние КБЖУ и анализ дней относительно цели.`,
      { parse_mode: 'Markdown', reply_markup: buildPremiumKeyboard(ctx) }
    );
    return;
  }

  const start = new Date();
  start.setDate(start.getDate() - 29);
  start.setHours(0, 0, 0, 0);

  const entries = await FoodEntry.find({ telegramId, createdAt: { $gte: start } }).sort({ createdAt: 1 });

  if (entries.length === 0) {
    await ctx.reply('📭 За последние 30 дней записей нет.');
    return;
  }

  const byDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number; count: number }>();

  for (const entry of entries) {
    const day = entry.createdAt.toLocaleDateString('ru-RU');
    const current = byDay.get(day) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    byDay.set(day, {
      calories: current.calories + entry.calories,
      protein: current.protein + entry.protein,
      carbs: current.carbs + entry.carbs,
      fat: current.fat + entry.fat,
      count: current.count + 1,
    });
  }

  const totals = Array.from(byDay.values()).reduce(
    (acc, day) => ({
      calories: acc.calories + day.calories,
      protein: acc.protein + day.protein,
      carbs: acc.carbs + day.carbs,
      fat: acc.fat + day.fat,
      count: acc.count + day.count,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 }
  );

  const days = byDay.size;
  const goal = user?.dailyCalorieGoal;
  const goalHits = goal
    ? Array.from(byDay.values()).filter((day) => day.calories >= goal * 0.9 && day.calories <= goal * 1.1).length
    : 0;
  const bestDay = Array.from(byDay.entries()).sort((a, b) => b[1].calories - a[1].calories)[0];

  await ctx.reply(
    `📈 *Расширенная статистика за 30 дней*\n\n` +
      `Дней с записями: *${days}*\n` +
      `Приёмов пищи: *${totals.count}*\n\n` +
      `Среднее в день:\n` +
      `🔥 ${Math.round(totals.calories / days)} ккал\n` +
      `🥩 ${Math.round(totals.protein / days)}г  |  🍞 ${Math.round(totals.carbs / days)}г  |  🧈 ${Math.round(totals.fat / days)}г\n\n` +
      (goal ? `Дней около цели: *${goalHits}* из ${days}\n` : `Цель по калориям не задана\n`) +
      `Самый калорийный день: *${bestDay[0]}* — ${bestDay[1].calories} ккал`,
    { parse_mode: 'Markdown' }
  );
}
