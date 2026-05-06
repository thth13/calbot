import { Context } from 'grammy';

type NutritionField = 'calories' | 'protein' | 'carbs' | 'fat';

export type NutritionTotals = Record<NutritionField, number>;

type GoalUser = {
  dailyCalorieGoal?: number;
  dailyProteinGoal?: number;
  dailyCarbsGoal?: number;
  dailyFatGoal?: number;
};

const GOALS: Array<{
  field: NutritionField;
  goalField: keyof GoalUser;
  label: string;
  unit: string;
}> = [
  { field: 'calories', goalField: 'dailyCalorieGoal', label: '🔥 Калории', unit: 'ккал' },
  { field: 'protein', goalField: 'dailyProteinGoal', label: '🥩 Белки', unit: 'г' },
  { field: 'carbs', goalField: 'dailyCarbsGoal', label: '🍞 Углеводы', unit: 'г' },
  { field: 'fat', goalField: 'dailyFatGoal', label: '🧈 Жиры', unit: 'г' },
];

export function buildGoalReachedMessage(
  previousTotals: NutritionTotals,
  currentTotals: NutritionTotals,
  user: GoalUser
): string | null {
  const reachedGoals = GOALS.flatMap(({ field, goalField, label, unit }) => {
    const goal = user[goalField];
    if (!goal || goal <= 0) return [];
    if (previousTotals[field] >= goal || currentTotals[field] < goal) return [];

    return [`${label}: *${Math.round(currentTotals[field])}* / ${Math.round(goal)} ${unit}`];
  });

  if (reachedGoals.length === 0) return null;

  return `🎉 *Норма набрана*\n\n${reachedGoals.join('\n')}`;
}

export async function sendGoalReachedNotification(
  ctx: Context,
  previousTotals: NutritionTotals,
  currentTotals: NutritionTotals,
  user: GoalUser
): Promise<void> {
  const message = buildGoalReachedMessage(previousTotals, currentTotals, user);
  if (!message) return;

  await ctx.reply(message, { parse_mode: 'Markdown' });
}
