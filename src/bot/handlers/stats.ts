import { Context, InlineKeyboard } from 'grammy';
import type { MealType } from '../../db/models/FoodEntry.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { buildPremiumKeyboard, isPremiumActive } from './premium.js';

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  meal: 'meal',
  snack: 'snack',
};

function getMealTypeLabel(mealType?: MealType): string {
  return MEAL_TYPE_LABELS[mealType ?? 'meal'];
}

function formatEntry(entry: { foodDescription: string; mealType?: MealType; calories: number; createdAt: Date }): string {
  const time = entry.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `  • ${time} - ${entry.foodDescription} (${getMealTypeLabel(entry.mealType)}, ${entry.calories} kcal)`;
}

function buildSummaryLine(calories: number, goal: number): string {
  const pct = Math.round((calories / goal) * 100);
  const bar = buildProgressBar(pct);
  return `${bar} ${pct}% of goal`;
}

function formatMacroGoal(current: number, goal?: number): string {
  return goal !== undefined ? `${current}g / ${goal}g` : `${current}g`;
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
    await ctx.reply('📭 No entries today. Send a food photo!');
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
    ? `🔥 Calories: *${totals.calories}* / ${goal} kcal\n${buildSummaryLine(totals.calories, goal)}`
    : `🔥 Calories: *${totals.calories}* kcal _(goal not set)_`;
  const macroLine =
    `🥩 Protein: ${formatMacroGoal(totals.protein, user?.dailyProteinGoal)}  |  ` +
    `🍞 Carbs: ${formatMacroGoal(totals.carbs, user?.dailyCarbsGoal)}  |  ` +
    `🧈 Fat: ${formatMacroGoal(totals.fat, user?.dailyFatGoal)}`;

  await ctx.reply(
    `📅 *Today, ${new Date().toLocaleDateString('en-US')}*\n\n` +
      `${lines}\n\n` +
      `─────────────────\n` +
      `${goalLine}\n\n` +
      macroLine,
    { parse_mode: 'Markdown' }
  );
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
    await ctx.reply('📭 No entries in the last 7 days.');
    return;
  }

  const goal = user?.dailyCalorieGoal;

  // Group by day.
  const byDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number; mealCount: number }>();

  for (const e of entries) {
    const day = e.createdAt.toLocaleDateString('en-US');
    const cur = byDay.get(day) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 };
    byDay.set(day, {
      calories: cur.calories + e.calories,
      protein: cur.protein + e.protein,
      carbs: cur.carbs + e.carbs,
      fat: cur.fat + e.fat,
      mealCount: cur.mealCount + (e.mealType === 'snack' ? 0 : 1),
    });
  }

  const dayLines = Array.from(byDay.entries())
    .map(([date, d]) => {
      const icon = goal
        ? d.calories > goal ? '🔴' : d.calories > goal * 0.8 ? '🟡' : '🟢'
        : '⚪';
      return `${icon} ${date}: *${d.calories}* kcal (${d.mealCount} meals)`;
    })
    .join('\n');

  const totalCalories = entries.reduce((s, e) => s + e.calories, 0);
  const totalProtein = entries.reduce((s, e) => s + e.protein, 0);
  const totalCarbs = entries.reduce((s, e) => s + e.carbs, 0);
  const totalFat = entries.reduce((s, e) => s + e.fat, 0);
  const days = byDay.size;

  await ctx.reply(
    `📊 *7-day stats*\n\n` +
      `${dayLines}\n\n` +
      `─────────────────\n` +
      `📈 Average/day: *${Math.round(totalCalories / days)}* kcal\n` +
      `🔥 Total: ${totalCalories} kcal\n` +
      `🥩 Protein: ${totalProtein}g  |  🍞 Carbs: ${totalCarbs}g  |  🧈 Fat: ${totalFat}g` +
      (goal ? `\n\n🟢 < 80% of goal  🟡 80-100%  🔴 > goal` : ''),
    { parse_mode: 'Markdown' }
  );
}

export async function handleHistory(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const entries = await FoodEntry.find({ telegramId }).sort({ createdAt: -1 }).limit(10);

  if (entries.length === 0) {
    await ctx.reply('📭 History is empty. Send a food photo!');
    return;
  }

  await ctx.reply(`📋 *Last ${entries.length} entries:*`, { parse_mode: 'Markdown' });

  for (const e of entries) {
    const dt = e.createdAt.toLocaleString('en-US', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const keyboard = new InlineKeyboard()
      .text('✏️ Edit', `edit_entry_${e._id}`)
      .text('🗑 Delete', `delete_entry_${e._id}`);

    const text =
      `${dt} - *${e.foodDescription}*\n` +
      `🔥 ${e.calories} kcal  |  🥩 ${e.protein}g  |  🍞 ${e.carbs}g  |  🧈 ${e.fat}g`;

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function handleExtendedStats(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  if (!isPremiumActive(user?.premiumUntil)) {
    await ctx.reply(
      `📈 *Extended stats are available in Premium*\n\n` +
        `Premium unlocks 30-day trends, average nutrition, and goal-based day analysis.`,
      { parse_mode: 'Markdown', reply_markup: buildPremiumKeyboard(ctx) }
    );
    return;
  }

  const start = new Date();
  start.setDate(start.getDate() - 29);
  start.setHours(0, 0, 0, 0);

  const entries = await FoodEntry.find({ telegramId, createdAt: { $gte: start } }).sort({ createdAt: 1 });

  if (entries.length === 0) {
    await ctx.reply('📭 No entries in the last 30 days.');
    return;
  }

  const byDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number; count: number }>();

  for (const entry of entries) {
    const day = entry.createdAt.toLocaleDateString('en-US');
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
    `📈 *30-day extended stats*\n\n` +
      `Days with entries: *${days}*\n` +
      `Eating occasions: *${totals.count}*\n\n` +
      `Daily average:\n` +
      `🔥 ${Math.round(totals.calories / days)} kcal\n` +
      `🥩 ${Math.round(totals.protein / days)}g  |  🍞 ${Math.round(totals.carbs / days)}g  |  🧈 ${Math.round(totals.fat / days)}g\n\n` +
      (goal ? `Days near goal: *${goalHits}* of ${days}\n` : `Calorie goal is not set\n`) +
      `Highest-calorie day: *${bestDay[0]}* - ${bestDay[1].calories} kcal`,
    { parse_mode: 'Markdown' }
  );
}
