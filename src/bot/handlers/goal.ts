import { Context, InlineKeyboard } from 'grammy';
import {
  ActivityLevel,
  FitnessGoal,
  Gender,
  SportType,
  TrainingDuration,
  TrainingFrequency,
  User,
} from '../../db/models/User.js';
import type { IUser } from '../../db/models/User.js';

type WizardStep =
  | 'gender'
  | 'age'
  | 'height'
  | 'weight'
  | 'goal'
  | 'activity'
  | 'sport'
  | 'sportType'
  | 'trainingFrequency'
  | 'trainingDuration'
  | 'result'
  | 'manual';
type ManualGoalField = 'calories' | 'protein' | 'carbs' | 'fat';

interface CalculationResult {
  bmr: number;
  activityCoefficient: number;
  tdee: number;
  targetCalories: number;
  protein: number;
  fat: number;
  carbs: number;
  adjustmentPercent: number;
  warning?: string;
}

interface WizardState {
  step: WizardStep;
  history?: WizardStep[];
  gender?: Gender;
  age?: number;
  height?: number;
  weight?: number;
  goal?: FitnessGoal;
  activityLevel?: ActivityLevel;
  hasSport?: boolean;
  sportType?: SportType;
  trainingFrequency?: TrainingFrequency;
  trainingDuration?: TrainingDuration;
  result?: CalculationResult;
  manualField?: ManualGoalField;
  manualGoals?: Partial<Record<ManualGoalField, number>>;
}

// In-memory state per telegramId
export const wizardState = new Map<number, WizardState>();

const GOAL_ADJUSTMENTS: Record<FitnessGoal, number> = {
  lose_weight: -0.15,
  maintain_weight: 0,
  gain_muscle: 0.1,
};

const GOAL_LABELS: Record<FitnessGoal, string> = {
  lose_weight: 'weight loss',
  maintain_weight: 'weight maintenance',
  gain_muscle: 'muscle gain',
};

const MANUAL_GOAL_USER_FIELDS: Record<ManualGoalField, keyof IUser> = {
  calories: 'dailyCalorieGoal',
  protein: 'dailyProteinGoal',
  carbs: 'dailyCarbsGoal',
  fat: 'dailyFatGoal',
};

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Mostly sedentary',
  light: 'Light walking',
  moderate: 'Moderate activity',
  active: 'High activity',
};

const ACTIVITY_COEFFICIENTS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.3,
  moderate: 1.45,
  active: 1.6,
};

const SPORT_TYPE_LABELS: Record<SportType, string> = {
  strength: 'Strength training',
  cardio: 'Cardio',
  mixed: 'Mixed training',
  team: 'Team sports',
  martial_arts: 'Martial arts',
  other: 'Other',
};

const TRAINING_FREQUENCY_LABELS: Record<TrainingFrequency, string> = {
  low: '1-2 times per week',
  medium: '3-4 times per week',
  high: '5+ times per week',
};

const TRAINING_FREQUENCY_BONUS: Record<TrainingFrequency, number> = {
  low: 0.05,
  medium: 0.1,
  high: 0.15,
};

const TRAINING_DURATION_LABELS: Record<TrainingDuration, string> = {
  short: 'Up to 30 minutes',
  medium: '30-60 minutes',
  long: '60-90 minutes',
  extra_long: '90+ minutes',
};

const TRAINING_DURATION_BONUS: Record<TrainingDuration, number> = {
  short: 0,
  medium: 0.025,
  long: 0.05,
  extra_long: 0.075,
};

function buildNavKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Back', 'goal_back').text('❌ Cancel', 'goal_cancel');
}

function withNav(kb: InlineKeyboard): InlineKeyboard {
  return kb.row().text('⬅️ Back', 'goal_back').text('❌ Cancel', 'goal_cancel');
}

function moveToStep(telegramId: number, state: WizardState, step: WizardStep): void {
  state.history ??= [];
  state.history.push(state.step);
  state.step = step;
  wizardState.set(telegramId, state);
}

function roundCalories(value: number): number {
  return Math.round(value / 10) * 10;
}

function formatGoalValue(value: number | undefined, suffix: string): string {
  return value !== undefined ? `${value}${suffix}` : 'not set';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function calculateGoals(state: WizardState): CalculationResult {
  if (!state.gender || !state.age || !state.height || !state.weight || !state.goal || !state.activityLevel) {
    throw new Error('Incomplete goal wizard state');
  }

  const bmrRaw =
    state.gender === 'male'
      ? 10 * state.weight + 6.25 * state.height - 5 * state.age + 5
      : 10 * state.weight + 6.25 * state.height - 5 * state.age - 161;
  const bmr = Math.round(bmrRaw);

  const sportBonus = state.hasSport
    ? (state.trainingFrequency ? TRAINING_FREQUENCY_BONUS[state.trainingFrequency] : 0) +
      (state.trainingDuration ? TRAINING_DURATION_BONUS[state.trainingDuration] : 0)
    : 0;
  const activityCoefficient = Math.min(1.9, ACTIVITY_COEFFICIENTS[state.activityLevel] + sportBonus);
  const tdee = Math.round(bmrRaw * activityCoefficient);
  const adjustmentPercent = GOAL_ADJUSTMENTS[state.goal];
  const targetCalories = roundCalories(tdee * (1 + adjustmentPercent));

  const proteinPerKg: Record<FitnessGoal, number> = {
    lose_weight: 2.0,
    maintain_weight: 1.6,
    gain_muscle: 1.8,
  };
  const protein = Math.round(state.weight * proteinPerKg[state.goal]);

  const minFat = (targetCalories * 0.2) / 9;
  const maxFat = (targetCalories * 0.35) / 9;
  const baseFat = state.weight * 0.8;
  const fat = Math.round(Math.min(maxFat, Math.max(minFat, baseFat)));
  const carbs = Math.max(0, Math.round((targetCalories - protein * 4 - fat * 9) / 4));

  return {
    bmr,
    activityCoefficient: Math.round(activityCoefficient * 1000) / 1000,
    tdee,
    targetCalories,
    protein,
    fat,
    carbs,
    adjustmentPercent,
    warning:
      targetCalories < bmr
        ? 'The calculated target is too low. It is better not to go below your basal metabolic rate without consulting a specialist.'
        : undefined,
  };
}

function buildManualGoalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔥 Calories', 'manual_goal_calories')
    .text('🥩 Protein', 'manual_goal_protein')
    .row()
    .text('🍚 Carbs', 'manual_goal_carbs')
    .text('🥑 Fat', 'manual_goal_fat');
}

function buildManualGoalText(goals: Partial<Record<ManualGoalField, number>>): string {
  return (
    `✏️ *Manual goal entry*\n\n` +
    `🔥 Calories: ${formatGoalValue(goals.calories, ' kcal')}\n` +
    `🥩 Protein: ${formatGoalValue(goals.protein, 'g')}\n` +
    `🍚 Carbs: ${formatGoalValue(goals.carbs, 'g')}\n` +
    `🥑 Fat: ${formatGoalValue(goals.fat, 'g')}\n\n` +
    `Choose what you want to set. The value is applied right after you enter it.`
  );
}

function buildResultText(state: WizardState, result: CalculationResult): string {
  const warning = result.warning ? `\n\n⚠️ ${result.warning}` : '';

  return (
    `🎯 *Your daily goal*\n\n` +
    `Goal: ${GOAL_LABELS[state.goal!]}\n` +
    `Calories: *${formatNumber(result.targetCalories)} kcal/day*\n\n` +
    `Macros:\n` +
    `🥩 Protein: ${result.protein} g\n` +
    `🥑 Fat: ${result.fat} g\n` +
    `🍚 Carbs: ${result.carbs} g${warning}\n\n` +
    `This is a starting point. After 2-3 weeks, you can adjust it based on weight trends and how you feel.`
  );
}

function buildResultKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Save goal', 'goal_save')
    .row()
    .text('✏️ Change data', 'goal_change')
    .text('🔁 Retake quiz', 'goal_restart')
    .row()
    .text('🧮 How is this calculated?', 'goal_explain')
    .row()
    .text('❌ Cancel', 'goal_cancel');
}

function buildExplanationText(state: WizardState, result: CalculationResult): string {
  const sign = result.adjustmentPercent > 0 ? 'surplus' : result.adjustmentPercent < 0 ? 'deficit' : 'no change';
  const percent = Math.abs(Math.round(result.adjustmentPercent * 100));
  const adjustmentLine = result.adjustmentPercent === 0 ? '0%, weight maintenance' : `${percent}%, ${sign}`;

  return (
    `🧮 *How this is calculated*\n\n` +
    `BMR: *${result.bmr} kcal* using the Mifflin-St Jeor formula\n` +
    `Activity coefficient: *${result.activityCoefficient}*\n` +
    `TDEE: *${result.tdee} kcal*\n` +
    `Goal: *${GOAL_LABELS[state.goal!]}*\n` +
    `Adjustment: *${adjustmentLine}*\n\n` +
    `Macros:\n` +
    `• Protein: ${state.goal === 'lose_weight' ? '2.0' : state.goal === 'gain_muscle' ? '1.8' : '1.6'} g per kg of body weight\n` +
    `• Fat: 0.8 g per kg of body weight, within 20-35% of calories\n` +
    `• Carbs: remaining calories after protein and fat\n\n` +
    `Protein and carbs are counted as 4 kcal/g, fat as 9 kcal/g.`
  );
}

function buildProfileInfo(user: IUser | null): string {
  if (!user?.weight || !user?.height || !user?.age || !user?.gender || !user?.activityLevel) return '';

  return (
    `\n\n👤 *Your profile:*\n` +
    `Gender: ${user.gender === 'male' ? 'Male' : 'Female'}\n` +
    `Age: ${user.age}\n` +
    `Height: ${user.height} cm\n` +
    `Weight: ${user.weight} kg\n` +
    `Goal: ${user.fitnessGoal ? GOAL_LABELS[user.fitnessGoal] : 'not set'}\n` +
    `Activity: ${ACTIVITY_LABELS[user.activityLevel]}`
  );
}

async function askGender(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Male', 'gender_male')
    .text('Female', 'gender_female')
    .row()
    .text('❌ Cancel', 'goal_cancel');

  await ctx.reply('Step 1 - Select your gender:', { reply_markup: kb });
}

async function askGoal(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Weight loss', 'goal_type_lose_weight')
    .row()
    .text('Weight maintenance', 'goal_type_maintain_weight')
    .row()
    .text('Muscle gain', 'goal_type_gain_muscle');

  await ctx.reply('Step 5 - What is your goal?', { reply_markup: withNav(kb) });
}

async function askActivity(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Mostly sedentary', 'activity_sedentary')
    .row()
    .text('Light walking', 'activity_light')
    .row()
    .text('Moderate activity', 'activity_moderate')
    .row()
    .text('High activity', 'activity_active');

  await ctx.reply('Step 6 - Daily activity level:', { reply_markup: withNav(kb) });
}

async function askSport(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard().text('No', 'sport_no').text('Yes', 'sport_yes');
  await ctx.reply('Step 7 - Do you exercise?', { reply_markup: withNav(kb) });
}

async function askSportType(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Strength', 'sport_type_strength')
    .text('Cardio', 'sport_type_cardio')
    .row()
    .text('Mixed', 'sport_type_mixed')
    .text('Team sports', 'sport_type_team')
    .row()
    .text('Martial arts', 'sport_type_martial_arts')
    .text('Other', 'sport_type_other');

  await ctx.reply('Step 8 - What type of exercise?', { reply_markup: withNav(kb) });
}

async function askTrainingFrequency(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('1-2 times per week', 'training_frequency_low')
    .row()
    .text('3-4 times per week', 'training_frequency_medium')
    .row()
    .text('5+ times per week', 'training_frequency_high');

  await ctx.reply('Step 9 - How often do you train?', { reply_markup: withNav(kb) });
}

async function askTrainingDuration(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Up to 30 minutes', 'training_duration_short')
    .row()
    .text('30-60 minutes', 'training_duration_medium')
    .row()
    .text('60-90 minutes', 'training_duration_long')
    .row()
    .text('90+ minutes', 'training_duration_extra_long');

  await ctx.reply('Step 10 - How long is a typical workout?', { reply_markup: withNav(kb) });
}

async function showResult(ctx: Context, telegramId: number, state: WizardState): Promise<void> {
  const result = calculateGoals(state);
  state.result = result;
  state.step = 'result';
  wizardState.set(telegramId, state);

  await ctx.reply(buildResultText(state, result), {
    parse_mode: 'Markdown',
    reply_markup: buildResultKeyboard(),
  });
}

export async function handleGoal(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  const hasAnyGoal =
    user?.dailyCalorieGoal !== undefined ||
    user?.dailyProteinGoal !== undefined ||
    user?.dailyCarbsGoal !== undefined ||
    user?.dailyFatGoal !== undefined;
  const currentLine = hasAnyGoal
    ? `Current goal:\n` +
      `🔥 ${formatGoalValue(user?.dailyCalorieGoal, ' kcal')}\n` +
      `🥩 ${formatGoalValue(user?.dailyProteinGoal, 'g')}  |  ` +
      `🍚 ${formatGoalValue(user?.dailyCarbsGoal, 'g')}  |  ` +
      `🥑 ${formatGoalValue(user?.dailyFatGoal, 'g')}`
    : `Goal is not set`;

  const kb = new InlineKeyboard()
    .text('📋 Take quiz', 'goal_calc')
    .row()
    .text('✏️ Enter manually', 'goal_manual');

  await ctx.reply(
    `🎯 *Daily calorie goal*\n\n${currentLine}${buildProfileInfo(user)}\n\nChange goal`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleGoalCalcCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  wizardState.set(telegramId, { step: 'gender', history: [] });
  await askGender(ctx);
}

export async function handleGoalBackCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  const previousStep = state?.history?.pop();
  if (!state || !previousStep) {
    await ctx.reply('This is the first step of the quiz.', { reply_markup: buildNavKeyboard() });
    return;
  }

  state.step = previousStep;
  wizardState.set(telegramId, state);

  if (previousStep === 'gender') return askGender(ctx);
  if (previousStep === 'age') {
    await ctx.reply('Step 2 - How old are you? Enter a number from 13 to 90:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'height') {
    await ctx.reply('Step 3 - Height in centimeters. Enter a number from 120 to 230:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'weight') {
    await ctx.reply('Step 4 - Weight in kilograms. Enter a number from 30 to 250:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'goal') return askGoal(ctx);
  if (previousStep === 'activity') return askActivity(ctx);
  if (previousStep === 'sport') return askSport(ctx);
  if (previousStep === 'sportType') return askSportType(ctx);
  if (previousStep === 'trainingFrequency') return askTrainingFrequency(ctx);
  if (previousStep === 'trainingDuration') return askTrainingDuration(ctx);
}

export async function handleGoalCancelCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) wizardState.delete(telegramId);
  await ctx.answerCallbackQuery({ text: 'Quiz canceled' });
  await ctx.reply('❌ Quiz canceled. Your goal was not changed.');
}

export async function handleGenderCallback(ctx: Context, gender: Gender): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.gender = gender;
  moveToStep(telegramId, state, 'age');
  await ctx.reply('Step 2 - How old are you? Enter a number from 13 to 90:', { reply_markup: buildNavKeyboard() });
}

export async function handleGoalTypeCallback(ctx: Context, goal: FitnessGoal): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.goal = goal;
  moveToStep(telegramId, state, 'activity');
  await askActivity(ctx);
}

export async function handleActivityCallback(ctx: Context, activity: ActivityLevel): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.activityLevel = activity;
  moveToStep(telegramId, state, 'sport');
  await askSport(ctx);
}

export async function handleSportCallback(ctx: Context, hasSport: boolean): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.hasSport = hasSport;
  if (!hasSport) {
    state.sportType = undefined;
    state.trainingFrequency = undefined;
    state.trainingDuration = undefined;
    return showResult(ctx, telegramId, state);
  }

  moveToStep(telegramId, state, 'sportType');
  await askSportType(ctx);
}

export async function handleSportTypeCallback(ctx: Context, sportType: SportType): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.sportType = sportType;
  moveToStep(telegramId, state, 'trainingFrequency');
  await askTrainingFrequency(ctx);
}

export async function handleTrainingFrequencyCallback(ctx: Context, trainingFrequency: TrainingFrequency): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.trainingFrequency = trainingFrequency;
  moveToStep(telegramId, state, 'trainingDuration');
  await askTrainingDuration(ctx);
}

export async function handleTrainingDurationCallback(ctx: Context, trainingDuration: TrainingDuration): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.trainingDuration = trainingDuration;
  await showResult(ctx, telegramId, state);
}

export async function handleGoalSaveCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = wizardState.get(telegramId);
  if (!state?.result || !state.gender || !state.age || !state.height || !state.weight || !state.goal || !state.activityLevel) {
    await ctx.answerCallbackQuery({ text: 'Take the quiz first', show_alert: true });
    return;
  }

  await User.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        dailyCalorieGoal: state.result.targetCalories,
        dailyProteinGoal: state.result.protein,
        dailyCarbsGoal: state.result.carbs,
        dailyFatGoal: state.result.fat,
        gender: state.gender,
        age: state.age,
        height: state.height,
        weight: state.weight,
        fitnessGoal: state.goal,
        activityLevel: state.activityLevel,
        hasSport: state.hasSport ?? false,
        sportType: state.sportType,
        trainingFrequency: state.trainingFrequency,
        trainingDuration: state.trainingDuration,
        bmr: state.result.bmr,
        tdee: state.result.tdee,
        activityCoefficient: state.result.activityCoefficient,
        calorieAdjustmentPercent: state.result.adjustmentPercent,
      },
    },
    { upsert: true }
  );

  wizardState.delete(telegramId);
  await ctx.answerCallbackQuery({ text: '✅ Goal saved' });
  await ctx.reply('✅ Goal saved. Daily stats will now be compared with this target.');
}

export async function handleGoalChangeCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.step = 'weight';
  state.history = ['gender', 'age', 'height'];
  wizardState.set(telegramId, state);
  await ctx.reply('First, update your weight. Enter your current weight in kg from 30 to 250:', {
    reply_markup: buildNavKeyboard(),
  });
}

export async function handleGoalRestartCallback(ctx: Context): Promise<void> {
  await handleGoalCalcCallback(ctx);
}

export async function handleGoalExplainCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = wizardState.get(telegramId);
  if (!state?.result) {
    await ctx.answerCallbackQuery({ text: 'Calculate your goal first', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(buildExplanationText(state, state.result), {
    parse_mode: 'Markdown',
    reply_markup: buildResultKeyboard(),
  });
}

export async function handleGoalManualCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const user = await User.findOne({ telegramId });
  const manualGoals = {
    calories: user?.dailyCalorieGoal,
    protein: user?.dailyProteinGoal,
    carbs: user?.dailyCarbsGoal,
    fat: user?.dailyFatGoal,
  };

  wizardState.set(telegramId, { step: 'manual', manualGoals });
  await ctx.reply(buildManualGoalText(manualGoals), {
    parse_mode: 'Markdown',
    reply_markup: buildManualGoalKeyboard(),
  });
}

export async function handleManualGoalFieldCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const field = ctx.match instanceof Array ? (ctx.match[1] as ManualGoalField) : undefined;
  if (!field || !['calories', 'protein', 'carbs', 'fat'].includes(field)) return;

  const state = wizardState.get(telegramId) ?? { step: 'manual' as const };
  state.step = 'manual';
  state.manualField = field;
  if (!state.manualGoals) {
    const user = await User.findOne({ telegramId });
    state.manualGoals = {
      calories: user?.dailyCalorieGoal,
      protein: user?.dailyProteinGoal,
      carbs: user?.dailyCarbsGoal,
      fat: user?.dailyFatGoal,
    };
  }
  wizardState.set(telegramId, state);

  const labels: Record<ManualGoalField, string> = {
    calories: 'calories in kcal',
    protein: 'protein in grams',
    carbs: 'carbs in grams',
    fat: 'fat in grams',
  };

  await ctx.answerCallbackQuery();
  await ctx.reply(`Enter a value for ${labels[field]}:`);
}

export async function handleManualGoalSaveCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = wizardState.get(telegramId);
  const goals = state?.manualGoals ?? {};
  const hasAnyGoal = Object.values(goals).some((value) => value !== undefined);

  if (!hasAnyGoal) {
    await ctx.answerCallbackQuery({ text: 'Set at least one value first', show_alert: true });
    return;
  }

  await User.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        ...(goals.calories !== undefined ? { dailyCalorieGoal: goals.calories } : {}),
        ...(goals.protein !== undefined ? { dailyProteinGoal: goals.protein } : {}),
        ...(goals.carbs !== undefined ? { dailyCarbsGoal: goals.carbs } : {}),
        ...(goals.fat !== undefined ? { dailyFatGoal: goals.fat } : {}),
      },
    },
    { upsert: true }
  );

  wizardState.delete(telegramId);
  await ctx.answerCallbackQuery({ text: '✅ Goal saved' });
  await ctx.reply(
    `✅ *Daily goal saved*\n\n` +
      `🔥 ${formatGoalValue(goals.calories, ' kcal')}\n` +
      `🥩 ${formatGoalValue(goals.protein, 'g')}  |  ` +
      `🍚 ${formatGoalValue(goals.carbs, 'g')}  |  ` +
      `🥑 ${formatGoalValue(goals.fat, 'g')}`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleManualGoalCancelCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    wizardState.delete(telegramId);
  }
  await ctx.answerCallbackQuery({ text: '❌ Manual entry canceled' });
  await ctx.reply('❌ Manual entry canceled.');
}

export async function handleWizardMessage(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const state = wizardState.get(telegramId);
  if (!state) return false;

  const text = ctx.message?.text?.trim() ?? '';

  if (state.step === 'manual') {
    if (!state.manualField) {
      wizardState.delete(telegramId);
      return false;
    }

    const field = state.manualField;
    const value = Number(text.replace(',', '.'));
    if (Number.isNaN(value)) {
      await ctx.reply('❌ Enter a number.');
      return true;
    }

    if (field === 'calories' && (value < 500 || value > 10000)) {
      await ctx.reply('❌ Calories must be between 500 and 10000.');
      return true;
    }

    if (field !== 'calories' && (value < 0 || value > 1000)) {
      await ctx.reply('❌ Protein, carbs, and fat must be between 0 and 1000 g.');
      return true;
    }

    const roundedValue = Math.round(value);
    state.manualGoals ??= {};
    state.manualGoals[field] = roundedValue;
    state.manualField = undefined;

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { [MANUAL_GOAL_USER_FIELDS[field]]: roundedValue } },
      { upsert: true }
    );

    wizardState.delete(telegramId);

    await ctx.reply(buildManualGoalText(state.manualGoals), {
      parse_mode: 'Markdown',
      reply_markup: buildManualGoalKeyboard(),
    });
    return true;
  }

  if (state.step === 'age') {
    const age = Number(text.replace(',', '.'));
    if (!Number.isInteger(age) || age < 13 || age > 90) {
      await ctx.reply('❌ Enter your age as a number from 13 to 90:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.age = age;
    moveToStep(telegramId, state, 'height');
    await ctx.reply('Step 3 - Height in centimeters. Enter a number from 120 to 230:', { reply_markup: buildNavKeyboard() });
    return true;
  }

  if (state.step === 'height') {
    const height = Number(text.replace(',', '.'));
    if (!Number.isInteger(height) || height < 120 || height > 230) {
      await ctx.reply('❌ Enter your height in centimeters as a number from 120 to 230:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.height = height;
    moveToStep(telegramId, state, 'weight');
    await ctx.reply('Step 4 - Weight in kilograms. Decimals are allowed, for example 72.5:', {
      reply_markup: buildNavKeyboard(),
    });
    return true;
  }

  if (state.step === 'weight') {
    const weight = Number(text.replace(',', '.'));
    if (Number.isNaN(weight) || weight < 30 || weight > 250) {
      await ctx.reply('❌ Enter your weight in kg as a number from 30 to 250:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.weight = Math.round(weight * 10) / 10;
    moveToStep(telegramId, state, 'goal');
    await askGoal(ctx);
    return true;
  }

  await ctx.reply('Choose an option below or tap "Back" / "Cancel".');
  return true;
}
