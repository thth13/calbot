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
  { field: 'calories', goalField: 'dailyCalorieGoal', label: '🔥 Calories', unit: 'kcal' },
  { field: 'protein', goalField: 'dailyProteinGoal', label: '🥩 Protein', unit: 'g' },
  { field: 'carbs', goalField: 'dailyCarbsGoal', label: '🍞 Carbs', unit: 'g' },
  { field: 'fat', goalField: 'dailyFatGoal', label: '🧈 Fat', unit: 'g' },
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

  return `🎉 *Goal reached*\n\n${reachedGoals.join('\n')}`;
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
