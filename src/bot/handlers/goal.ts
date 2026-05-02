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
  lose_weight: 'похудение',
  maintain_weight: 'поддержание веса',
  gain_muscle: 'набор мышечной массы',
};

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Почти не двигаюсь',
  light: 'Немного хожу',
  moderate: 'Средняя активность',
  active: 'Высокая активность',
};

const ACTIVITY_COEFFICIENTS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.3,
  moderate: 1.45,
  active: 1.6,
};

const SPORT_TYPE_LABELS: Record<SportType, string> = {
  strength: 'Силовые тренировки',
  cardio: 'Кардио',
  mixed: 'Смешанные тренировки',
  team: 'Игровой/командный спорт',
  martial_arts: 'Единоборства',
  other: 'Другое',
};

const TRAINING_FREQUENCY_LABELS: Record<TrainingFrequency, string> = {
  low: '1-2 раза в неделю',
  medium: '3-4 раза в неделю',
  high: '5+ раз в неделю',
};

const TRAINING_FREQUENCY_BONUS: Record<TrainingFrequency, number> = {
  low: 0.05,
  medium: 0.1,
  high: 0.15,
};

const TRAINING_DURATION_LABELS: Record<TrainingDuration, string> = {
  short: 'До 30 минут',
  medium: '30-60 минут',
  long: '60-90 минут',
  extra_long: '90+ минут',
};

const TRAINING_DURATION_BONUS: Record<TrainingDuration, number> = {
  short: 0,
  medium: 0.025,
  long: 0.05,
  extra_long: 0.075,
};

function buildNavKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Назад', 'goal_back').text('❌ Отмена', 'goal_cancel');
}

function withNav(kb: InlineKeyboard): InlineKeyboard {
  return kb.row().text('⬅️ Назад', 'goal_back').text('❌ Отмена', 'goal_cancel');
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
  return value !== undefined ? `${value}${suffix}` : 'не указано';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
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
        ? 'Расчёт получился слишком низким. Лучше не опускаться ниже базового обмена без консультации специалиста.'
        : undefined,
  };
}

function buildManualGoalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔥 Калории', 'manual_goal_calories')
    .text('🥩 Белки', 'manual_goal_protein')
    .row()
    .text('🍚 Углеводы', 'manual_goal_carbs')
    .text('🥑 Жиры', 'manual_goal_fat')
    .row()
    .text('✅ Сохранить', 'manual_goal_save')
    .text('❌ Отмена', 'manual_goal_cancel');
}

function buildManualGoalText(goals: Partial<Record<ManualGoalField, number>>): string {
  return (
    `✏️ *Ручной ввод нормы*\n\n` +
    `🔥 Калории: ${formatGoalValue(goals.calories, ' ккал')}\n` +
    `🥩 Белки: ${formatGoalValue(goals.protein, 'г')}\n` +
    `🍚 Углеводы: ${formatGoalValue(goals.carbs, 'г')}\n` +
    `🥑 Жиры: ${formatGoalValue(goals.fat, 'г')}\n\n` +
    `Выбери кнопкой, что хочешь указать.`
  );
}

function buildResultText(state: WizardState, result: CalculationResult): string {
  const warning = result.warning ? `\n\n⚠️ ${result.warning}` : '';

  return (
    `🎯 *Твоя дневная норма*\n\n` +
    `Цель: ${GOAL_LABELS[state.goal!]}\n` +
    `Калории: *${formatNumber(result.targetCalories)} ккал/день*\n\n` +
    `БЖУ:\n` +
    `🥩 Белки: ${result.protein} г\n` +
    `🥑 Жиры: ${result.fat} г\n` +
    `🍚 Углеводы: ${result.carbs} г${warning}\n\n` +
    `Это стартовая точка. Через 2-3 недели можно скорректировать норму по динамике веса и самочувствию.`
  );
}

function buildResultKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Сохранить норму', 'goal_save')
    .row()
    .text('✏️ Изменить данные', 'goal_change')
    .text('🔁 Пройти тест заново', 'goal_restart')
    .row()
    .text('🧮 Как это рассчитано?', 'goal_explain')
    .row()
    .text('❌ Отмена', 'goal_cancel');
}

function buildExplanationText(state: WizardState, result: CalculationResult): string {
  const sign = result.adjustmentPercent > 0 ? 'профицит' : result.adjustmentPercent < 0 ? 'дефицит' : 'без изменения';
  const percent = Math.abs(Math.round(result.adjustmentPercent * 100));
  const adjustmentLine = result.adjustmentPercent === 0 ? '0%, поддержание веса' : `${percent}%, ${sign}`;

  return (
    `🧮 *Как это рассчитано*\n\n` +
    `BMR: *${result.bmr} ккал* по формуле Mifflin-St Jeor\n` +
    `Коэффициент активности: *${result.activityCoefficient}*\n` +
    `TDEE: *${result.tdee} ккал*\n` +
    `Цель: *${GOAL_LABELS[state.goal!]}*\n` +
    `Коррекция: *${adjustmentLine}*\n\n` +
    `БЖУ:\n` +
    `• Белки: ${state.goal === 'lose_weight' ? '2.0' : state.goal === 'gain_muscle' ? '1.8' : '1.6'} г на кг веса\n` +
    `• Жиры: 0.8 г на кг веса, но в пределах 20-35% калорий\n` +
    `• Углеводы: оставшиеся калории после белков и жиров\n\n` +
    `Белки и углеводы считаются по 4 ккал/г, жиры - по 9 ккал/г.`
  );
}

function buildProfileInfo(user: IUser | null): string {
  if (!user?.weight || !user?.height || !user?.age || !user?.gender || !user?.activityLevel) return '';

  return (
    `\n\n👤 *Твой профиль:*\n` +
    `Пол: ${user.gender === 'male' ? 'Мужской' : 'Женский'}\n` +
    `Возраст: ${user.age} лет\n` +
    `Рост: ${user.height} см\n` +
    `Вес: ${user.weight} кг\n` +
    `Цель: ${user.fitnessGoal ? GOAL_LABELS[user.fitnessGoal] : 'не указана'}\n` +
    `Активность: ${ACTIVITY_LABELS[user.activityLevel]}`
  );
}

async function askGender(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Мужской', 'gender_male')
    .text('Женский', 'gender_female')
    .row()
    .text('❌ Отмена', 'goal_cancel');

  await ctx.reply('Шаг 1 — Укажи пол:', { reply_markup: kb });
}

async function askGoal(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Похудение', 'goal_type_lose_weight')
    .row()
    .text('Поддержание веса', 'goal_type_maintain_weight')
    .row()
    .text('Набор мышечной массы', 'goal_type_gain_muscle');

  await ctx.reply('Шаг 5 — Какая цель?', { reply_markup: withNav(kb) });
}

async function askActivity(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Почти не двигаюсь', 'activity_sedentary')
    .row()
    .text('Немного хожу', 'activity_light')
    .row()
    .text('Средняя активность', 'activity_moderate')
    .row()
    .text('Высокая активность', 'activity_active');

  await ctx.reply('Шаг 6 — Уровень повседневной активности:', { reply_markup: withNav(kb) });
}

async function askSport(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard().text('Нет', 'sport_no').text('Да', 'sport_yes');
  await ctx.reply('Шаг 7 — Занимаешься спортом?', { reply_markup: withNav(kb) });
}

async function askSportType(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('Силовые', 'sport_type_strength')
    .text('Кардио', 'sport_type_cardio')
    .row()
    .text('Смешанные', 'sport_type_mixed')
    .text('Командный спорт', 'sport_type_team')
    .row()
    .text('Единоборства', 'sport_type_martial_arts')
    .text('Другое', 'sport_type_other');

  await ctx.reply('Шаг 8 — Какой тип спорта?', { reply_markup: withNav(kb) });
}

async function askTrainingFrequency(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('1-2 раза в неделю', 'training_frequency_low')
    .row()
    .text('3-4 раза в неделю', 'training_frequency_medium')
    .row()
    .text('5+ раз в неделю', 'training_frequency_high');

  await ctx.reply('Шаг 9 — Как часто тренируешься?', { reply_markup: withNav(kb) });
}

async function askTrainingDuration(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text('До 30 минут', 'training_duration_short')
    .row()
    .text('30-60 минут', 'training_duration_medium')
    .row()
    .text('60-90 минут', 'training_duration_long')
    .row()
    .text('90+ минут', 'training_duration_extra_long');

  await ctx.reply('Шаг 10 — Сколько длится обычная тренировка?', { reply_markup: withNav(kb) });
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
    ? `Текущая норма:\n` +
      `🔥 ${formatGoalValue(user?.dailyCalorieGoal, ' ккал')}\n` +
      `🥩 ${formatGoalValue(user?.dailyProteinGoal, 'г')}  |  ` +
      `🍚 ${formatGoalValue(user?.dailyCarbsGoal, 'г')}  |  ` +
      `🥑 ${formatGoalValue(user?.dailyFatGoal, 'г')}`
    : `Норма не установлена`;

  const kb = new InlineKeyboard()
    .text('📋 Пройти тест', 'goal_calc')
    .row()
    .text('✏️ Ввести вручную', 'goal_manual');

  await ctx.reply(
    `🎯 *Дневная норма калорий*\n\n${currentLine}${buildProfileInfo(user)}\n\nИзменить норму`,
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
    await ctx.reply('Это первый шаг теста.', { reply_markup: buildNavKeyboard() });
    return;
  }

  state.step = previousStep;
  wizardState.set(telegramId, state);

  if (previousStep === 'gender') return askGender(ctx);
  if (previousStep === 'age') {
    await ctx.reply('Шаг 2 — Сколько тебе лет? Введи число от 13 до 90:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'height') {
    await ctx.reply('Шаг 3 — Рост в сантиметрах. Введи число от 120 до 230:', { reply_markup: buildNavKeyboard() });
    return;
  }
  if (previousStep === 'weight') {
    await ctx.reply('Шаг 4 — Вес в килограммах. Введи число от 30 до 250:', { reply_markup: buildNavKeyboard() });
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
  await ctx.answerCallbackQuery({ text: 'Тест отменён' });
  await ctx.reply('❌ Тест отменён. Норма не изменилась.');
}

export async function handleGenderCallback(ctx: Context, gender: Gender): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.gender = gender;
  moveToStep(telegramId, state, 'age');
  await ctx.reply('Шаг 2 — Сколько тебе лет? Введи число от 13 до 90:', { reply_markup: buildNavKeyboard() });
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
    await ctx.answerCallbackQuery({ text: 'Сначала пройди тест', show_alert: true });
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
  await ctx.answerCallbackQuery({ text: '✅ Норма сохранена' });
  await ctx.reply('✅ Норма сохранена. Теперь дневная статистика будет сравниваться с этой целью.');
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
  await ctx.reply('Что меняем в первую очередь: вес. Введи актуальный вес в кг от 30 до 250:', {
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
    await ctx.answerCallbackQuery({ text: 'Сначала рассчитай норму', show_alert: true });
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
  state.manualGoals ??= {};
  wizardState.set(telegramId, state);

  const labels: Record<ManualGoalField, string> = {
    calories: 'калорий в ккал',
    protein: 'белков в граммах',
    carbs: 'углеводов в граммах',
    fat: 'жиров в граммах',
  };

  await ctx.answerCallbackQuery();
  await ctx.reply(`Введи значение для ${labels[field]}:`);
}

export async function handleManualGoalSaveCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = wizardState.get(telegramId);
  const goals = state?.manualGoals ?? {};
  const hasAnyGoal = Object.values(goals).some((value) => value !== undefined);

  if (!hasAnyGoal) {
    await ctx.answerCallbackQuery({ text: 'Сначала укажи хотя бы одно значение', show_alert: true });
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
  await ctx.answerCallbackQuery({ text: '✅ Норма сохранена' });
  await ctx.reply(
    `✅ *Дневная норма сохранена*\n\n` +
      `🔥 ${formatGoalValue(goals.calories, ' ккал')}\n` +
      `🥩 ${formatGoalValue(goals.protein, 'г')}  |  ` +
      `🍚 ${formatGoalValue(goals.carbs, 'г')}  |  ` +
      `🥑 ${formatGoalValue(goals.fat, 'г')}`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleManualGoalCancelCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    wizardState.delete(telegramId);
  }
  await ctx.answerCallbackQuery({ text: '❌ Ручной ввод отменён' });
  await ctx.reply('❌ Ручной ввод отменён.');
}

export async function handleWizardMessage(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const state = wizardState.get(telegramId);
  if (!state) return false;

  const text = ctx.message?.text?.trim() ?? '';

  if (state.step === 'manual') {
    if (!state.manualField) {
      await ctx.reply('Выбери кнопкой, что хочешь указать.', {
        reply_markup: buildManualGoalKeyboard(),
      });
      return true;
    }

    const value = Number(text.replace(',', '.'));
    if (Number.isNaN(value)) {
      await ctx.reply('❌ Введи число.');
      return true;
    }

    if (state.manualField === 'calories' && (value < 500 || value > 10000)) {
      await ctx.reply('❌ Калории должны быть от 500 до 10000.');
      return true;
    }

    if (state.manualField !== 'calories' && (value < 0 || value > 1000)) {
      await ctx.reply('❌ Белки, углеводы и жиры должны быть от 0 до 1000 г.');
      return true;
    }

    state.manualGoals ??= {};
    state.manualGoals[state.manualField] = Math.round(value);
    state.manualField = undefined;
    wizardState.set(telegramId, state);

    await ctx.reply(buildManualGoalText(state.manualGoals), {
      parse_mode: 'Markdown',
      reply_markup: buildManualGoalKeyboard(),
    });
    return true;
  }

  if (state.step === 'age') {
    const age = Number(text.replace(',', '.'));
    if (!Number.isInteger(age) || age < 13 || age > 90) {
      await ctx.reply('❌ Введи возраст числом от 13 до 90:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.age = age;
    moveToStep(telegramId, state, 'height');
    await ctx.reply('Шаг 3 — Рост в сантиметрах. Введи число от 120 до 230:', { reply_markup: buildNavKeyboard() });
    return true;
  }

  if (state.step === 'height') {
    const height = Number(text.replace(',', '.'));
    if (!Number.isInteger(height) || height < 120 || height > 230) {
      await ctx.reply('❌ Введи рост в сантиметрах числом от 120 до 230:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.height = height;
    moveToStep(telegramId, state, 'weight');
    await ctx.reply('Шаг 4 — Вес в килограммах. Можно с десятичной дробью, например 72.5:', {
      reply_markup: buildNavKeyboard(),
    });
    return true;
  }

  if (state.step === 'weight') {
    const weight = Number(text.replace(',', '.'));
    if (Number.isNaN(weight) || weight < 30 || weight > 250) {
      await ctx.reply('❌ Введи вес в кг числом от 30 до 250:', { reply_markup: buildNavKeyboard() });
      return true;
    }
    state.weight = Math.round(weight * 10) / 10;
    moveToStep(telegramId, state, 'goal');
    await askGoal(ctx);
    return true;
  }

  await ctx.reply('Выбери вариант кнопкой ниже или нажми “Назад” / “Отмена”.');
  return true;
}
