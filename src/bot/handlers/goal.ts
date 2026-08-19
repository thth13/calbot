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
import { getNextWeightPromptAt } from '../weightTracking.js';

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
  lose_weight: 'схуднення',
  maintain_weight: 'підтримання ваги',
  gain_muscle: 'набір м’язової маси',
};

const MANUAL_GOAL_USER_FIELDS: Record<ManualGoalField, keyof IUser> = {
  calories: 'dailyCalorieGoal',
  protein: 'dailyProteinGoal',
  carbs: 'dailyCarbsGoal',
  fat: 'dailyFatGoal',
};

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Переважно сидячий спосіб життя',
  light: 'Легкі прогулянки',
  moderate: 'Помірна активність',
  active: 'Висока активність',
};

const ACTIVITY_COEFFICIENTS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.3,
  moderate: 1.45,
  active: 1.6,
};

const SPORT_TYPE_LABELS: Record<SportType, string> = {
  strength: 'Силові тренування',
  cardio: 'Кардіо',
  mixed: 'Змішані тренування',
  team: 'Командні види спорту',
  martial_arts: 'Бойові мистецтва',
  other: 'Інше',
};

const TRAINING_FREQUENCY_LABELS: Record<TrainingFrequency, string> = {
  low: '1–2 рази на тиждень',
  medium: '3–4 рази на тиждень',
  high: '5+ разів на тиждень',
};

const TRAINING_FREQUENCY_BONUS: Record<TrainingFrequency, number> = {
  low: 0.05,
  medium: 0.1,
  high: 0.15,
};

const TRAINING_DURATION_LABELS: Record<TrainingDuration, string> = {
  short: 'До 30 хвилин',
  medium: '30–60 хвилин',
  long: '60–90 хвилин',
  extra_long: '90+ хвилин',
};

const TRAINING_DURATION_BONUS: Record<TrainingDuration, number> = {
  short: 0,
  medium: 0.025,
  long: 0.05,
  extra_long: 0.075,
};

function buildNavKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Назад', 'goal_back').text('❌ Скасувати', 'goal_cancel');
}

function withNav(kb: InlineKeyboard): InlineKeyboard {
  return kb.row().text('⬅️ Назад', 'goal_back').text('❌ Скасувати', 'goal_cancel');
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
  return value !== undefined ? `${value}${suffix}` : 'не встановлено';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('uk-UA').format(value);
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
        ? 'Розрахована ціль занадто низька. Без консультації з фахівцем краще не опускатися нижче рівня базального обміну речовин.'
        : undefined,
  };
}

function buildManualGoalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔥 Калорії', 'manual_goal_calories')
    .text('🥩 Білки', 'manual_goal_protein')
    .row()
    .text('🍚 Вуглеводи', 'manual_goal_carbs')
    .text('🥑 Жири', 'manual_goal_fat');
}

function buildManualGoalText(goals: Partial<Record<ManualGoalField, number>>): string {
  return (
    `✏️ *Цілі вручну*\n\n` +
    `🔥 Калорії: ${formatGoalValue(goals.calories, ' ккал')}\n` +
    `🥩 Білки: ${formatGoalValue(goals.protein, ' г')}\n` +
    `🍚 Вуглеводи: ${formatGoalValue(goals.carbs, ' г')}\n` +
    `🥑 Жири: ${formatGoalValue(goals.fat, ' г')}\n\n` +
    `Обери, що хочеш встановити. Значення застосується відразу після введення.`
  );
}

function buildResultText(state: WizardState, result: CalculationResult): string {
  const warning = result.warning ? `\n\n⚠️ ${result.warning}` : '';

  return (
    `🎯 *Твоя добова ціль*\n\n` +
    `Ціль: ${GOAL_LABELS[state.goal!]}\n` +
    `Калорії: *${formatNumber(result.targetCalories)} ккал/добу*\n\n` +
    `Макронутрієнти:\n` +
    `🥩 Білки: ${result.protein} г\n` +
    `🥑 Жири: ${result.fat} г\n` +
    `🍚 Вуглеводи: ${result.carbs} г${warning}\n\n` +
    `Це початкова точка. Через 2–3 тижні можна відкоригувати ціль за динамікою ваги та самопочуттям.`
  );
}

function buildResultKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Зберегти ціль', 'goal_save')
    .row()
    .text('✏️ Змінити дані', 'goal_change')
    .text('🔁 Пройти опитування знову', 'goal_restart')
    .row()
    .text('🧮 Як це розраховано?', 'goal_explain')
    .row()
    .text('❌ Скасувати', 'goal_cancel');
}

function buildExplanationText(state: WizardState, result: CalculationResult): string {
  const sign = result.adjustmentPercent > 0 ? 'профіцит' : result.adjustmentPercent < 0 ? 'дефіцит' : 'без змін';
  const percent = Math.abs(Math.round(result.adjustmentPercent * 100));
  const adjustmentLine = result.adjustmentPercent === 0 ? '0%, підтримання ваги' : `${percent}%, ${sign}`;

  return (
    `🧮 *Як це розраховано*\n\n` +
    `BMR: *${result.bmr} ккал* за формулою Міффліна—Сан Жеора\n` +
    `Коефіцієнт активності: *${result.activityCoefficient}*\n` +
    `TDEE: *${result.tdee} ккал*\n` +
    `Ціль: *${GOAL_LABELS[state.goal!]}*\n` +
    `Коригування: *${adjustmentLine}*\n\n` +
    `Макронутрієнти:\n` +
    `• Білки: ${state.goal === 'lose_weight' ? '2,0' : state.goal === 'gain_muscle' ? '1,8' : '1,6'} г на кг маси тіла\n` +
    `• Жири: 0,8 г на кг маси тіла, у межах 20–35% калорій\n` +
    `• Вуглеводи: калорії, що залишилися після білків і жирів\n\n` +
    `Білки та вуглеводи рахуються як 4 ккал/г, жири — як 9 ккал/г.`
  );
}

function buildProfileInfo(user: IUser | null): string {
  if (!user?.weight || !user?.height || !user?.age || !user?.gender || !user?.activityLevel) return '';

  return (
    `\n\n👤 *Твій профіль:*\n` +
    `Стать: ${user.gender === 'male' ? 'Чоловіча' : 'Жіноча'}\n` +
    `Вік: ${user.age}\n` +
    `Зріст: ${user.height} см\n` +
    `Вага: ${user.weight} кг\n` +
    `Ціль: ${user.fitnessGoal ? GOAL_LABELS[user.fitnessGoal] : 'не встановлено'}\n` +
    `Активність: ${ACTIVITY_LABELS[user.activityLevel]}`
  );
}

async function askGender(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Чоловіча', 'gender_male')
    .text('Жіноча', 'gender_female')
    .row()
    .text('❌ Скасувати', 'goal_cancel');

  await ctx.reply('Крок 1 — обери стать:', { reply_markup: kb });
}

async function askGoal(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Схуднення', 'goal_type_lose_weight')
    .row()
    .text('Підтримання ваги', 'goal_type_maintain_weight')
    .row()
    .text('Набір м’язової маси', 'goal_type_gain_muscle');

  await ctx.reply('Крок 5 — яка твоя ціль?', { reply_markup: withNav(kb) });
}

async function askActivity(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Переважно сидяча', 'activity_sedentary')
    .row()
    .text('Легкі прогулянки', 'activity_light')
    .row()
    .text('Помірна активність', 'activity_moderate')
    .row()
    .text('Висока активність', 'activity_active');

  await ctx.reply('Крок 6 — рівень щоденної активності:', { reply_markup: withNav(kb) });
}

async function askSport(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard().text('Ні', 'sport_no').text('Так', 'sport_yes');
  await ctx.reply('Крок 7 — чи займаєшся ти спортом?', { reply_markup: withNav(kb) });
}

async function askSportType(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Силові', 'sport_type_strength')
    .text('Кардіо', 'sport_type_cardio')
    .row()
    .text('Змішані', 'sport_type_mixed')
    .text('Командні', 'sport_type_team')
    .row()
    .text('Бойові мистецтва', 'sport_type_martial_arts')
    .text('Інше', 'sport_type_other');

  await ctx.reply('Крок 8 — який тип тренувань?', { reply_markup: withNav(kb) });
}

async function askTrainingFrequency(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('1–2 рази на тиждень', 'training_frequency_low')
    .row()
    .text('3–4 рази на тиждень', 'training_frequency_medium')
    .row()
    .text('5+ разів на тиждень', 'training_frequency_high');

  await ctx.reply('Крок 9 — як часто ти тренуєшся?', { reply_markup: withNav(kb) });
}

async function askTrainingDuration(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('До 30 хвилин', 'training_duration_short')
    .row()
    .text('30–60 хвилин', 'training_duration_medium')
    .row()
    .text('60–90 хвилин', 'training_duration_long')
    .row()
    .text('90+ хвилин', 'training_duration_extra_long');

  await ctx.reply('Крок 10 — скільки триває звичайне тренування?', { reply_markup: withNav(kb) });
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

function buildGoalSelectionKeyboard(includeBodyMeasurements = true): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('📋 Пройти опитування', 'goal_calc')
    .row()
    .text('✏️ Ввести вручну', 'goal_manual');

  if (includeBodyMeasurements) {
    kb.row().text('📏 Заміри тіла', 'body_measurements');
  }

  return kb;
}

export async function sendOnboardingGoalPrompt(ctx: Context): Promise<void> {
  await ctx.reply(
    `🎯 Встановімо твої щоденні цілі харчування.\n\n` +
      `Пройди коротке опитування, щоб я розрахував для тебе калорії та макронутрієнти, або введи цілі вручну.`,
    { reply_markup: buildGoalSelectionKeyboard(false) }
  );
}

export async function sendGoalSetupPrompt(ctx: Context, user: IUser | null = null): Promise<void> {
  const hasAnyGoal =
    user?.dailyCalorieGoal !== undefined ||
    user?.dailyProteinGoal !== undefined ||
    user?.dailyCarbsGoal !== undefined ||
    user?.dailyFatGoal !== undefined;
  const currentLine = hasAnyGoal
    ? `Поточна ціль:\n` +
      `🔥 ${formatGoalValue(user?.dailyCalorieGoal, ' ккал')}\n` +
      `🥩 ${formatGoalValue(user?.dailyProteinGoal, ' г')}  |  ` +
      `🍚 ${formatGoalValue(user?.dailyCarbsGoal, ' г')}  |  ` +
      `🥑 ${formatGoalValue(user?.dailyFatGoal, ' г')}`
    : `Ціль не встановлена`;

  await ctx.reply(
    `🎯 *Щоденна ціль за калоріями*\n\n${currentLine}${buildProfileInfo(user)}\n\nЗмінити ціль`,
    { parse_mode: 'Markdown', reply_markup: buildGoalSelectionKeyboard() }
  );
}

export async function handleGoal(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();

  const user = await User.findOne({ telegramId });
  await sendGoalSetupPrompt(ctx, user);
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
    await ctx.reply('Це перший крок опитування.', { reply_markup: buildNavKeyboard() });
    return;
  }

  state.step = previousStep;
  wizardState.set(telegramId, state);

  if (previousStep === 'gender') return askGender(ctx);
  if (previousStep === 'age') {
    await ctx.reply('Крок 2 — скільки тобі років? Введи число від 13 до 90:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'height') {
    await ctx.reply('Крок 3 — зріст у сантиметрах. Введи число від 120 до 230:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'weight') {
    await ctx.reply('Крок 4 — вага в кілограмах. Введи число від 30 до 250:', { reply_markup: buildNavKeyboard() });
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
  await ctx.answerCallbackQuery({ text: 'Опитування скасовано' });
  await ctx.reply('❌ Опитування скасовано. Твою ціль не змінено.');
}

export async function handleGenderCallback(ctx: Context, gender: Gender): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.gender = gender;
  moveToStep(telegramId, state, 'age');
  await ctx.reply('Крок 2 — скільки тобі років? Введи число від 13 до 90:', { reply_markup: buildNavKeyboard() });
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
    await ctx.answerCallbackQuery({ text: 'Спочатку пройди опитування', show_alert: true });
    return;
  }

  const measuredAt = new Date();

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
        nextWeightPromptAt: getNextWeightPromptAt(measuredAt),
        awaitingWeightUpdate: false,
      },
      $push: {
        weightHistory: {
          weight: state.weight,
          measuredAt,
        },
      },
    },
    { upsert: true }
  );

  wizardState.delete(telegramId);
  await ctx.answerCallbackQuery({ text: '✅ Ціль збережено' });
  await ctx.reply('✅ Ціль збережено. Також я зберіг твою поточну вагу і раз на тиждень проситиму її оновити.');
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
  await ctx.reply('Спочатку онови вагу. Введи поточну вагу в кілограмах від 30 до 250:', {
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
    await ctx.answerCallbackQuery({ text: 'Спочатку розрахуй ціль', show_alert: true });
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
    calories: 'калорії в ккал',
    protein: 'білки в грамах',
    carbs: 'вуглеводи в грамах',
    fat: 'жири в грамах',
  };

  await ctx.answerCallbackQuery();
  await ctx.reply(`Введи значення для показника «${labels[field]}»:`);
}

export async function handleManualGoalSaveCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = wizardState.get(telegramId);
  const goals = state?.manualGoals ?? {};
  const hasAnyGoal = Object.values(goals).some((value) => value !== undefined);

  if (!hasAnyGoal) {
    await ctx.answerCallbackQuery({ text: 'Спочатку встанови хоча б одне значення', show_alert: true });
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
  await ctx.answerCallbackQuery({ text: '✅ Ціль збережено' });
  await ctx.reply(
    `✅ *Щоденну ціль збережено*\n\n` +
      `🔥 ${formatGoalValue(goals.calories, ' ккал')}\n` +
      `🥩 ${formatGoalValue(goals.protein, ' г')}  |  ` +
      `🍚 ${formatGoalValue(goals.carbs, ' г')}  |  ` +
      `🥑 ${formatGoalValue(goals.fat, ' г')}`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleManualGoalCancelCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    wizardState.delete(telegramId);
  }
  await ctx.answerCallbackQuery({ text: '❌ Ручне введення скасовано' });
  await ctx.reply('❌ Ручне введення скасовано.');
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
      await ctx.reply('❌ Введи число.');
      return true;
    }

    if (field === 'calories' && (value < 500 || value > 10000)) {
      await ctx.reply('❌ Кількість калорій має бути від 500 до 10 000.');
      return true;
    }

    if (field !== 'calories' && (value < 0 || value > 1000)) {
      await ctx.reply('❌ Білки, вуглеводи та жири мають бути від 0 до 1000 г.');
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
      await ctx.reply('❌ Введи вік числом від 13 до 90:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.age = age;
    moveToStep(telegramId, state, 'height');
    await ctx.reply('Крок 3 — зріст у сантиметрах. Введи число від 120 до 230:', { reply_markup: buildNavKeyboard() });
    return true;
  }

  if (state.step === 'height') {
    const height = Number(text.replace(',', '.'));
    if (!Number.isInteger(height) || height < 120 || height > 230) {
      await ctx.reply('❌ Введи зріст у сантиметрах числом від 120 до 230:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.height = height;
    moveToStep(telegramId, state, 'weight');
    await ctx.reply('Крок 4 — вага в кілограмах. Можна вводити дробові числа, наприклад 72,5:', {
      reply_markup: buildNavKeyboard(),
    });
    return true;
  }

  if (state.step === 'weight') {
    const weight = Number(text.replace(',', '.'));
    if (Number.isNaN(weight) || weight < 30 || weight > 250) {
      await ctx.reply('❌ Введи вагу в кілограмах числом від 30 до 250:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.weight = Math.round(weight * 10) / 10;
    moveToStep(telegramId, state, 'goal');
    await askGoal(ctx);
    return true;
  }

  await ctx.reply('Обери варіант нижче або натисни «Назад» / «Скасувати».');
  return true;
}
