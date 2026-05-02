import { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { User, Gender, ActivityLevel } from '../../db/models/User.js';

type WizardStep = 'gender' | 'age' | 'height' | 'weight' | 'activity' | 'manual';
type ManualGoalField = 'calories' | 'protein' | 'carbs' | 'fat';

interface WizardState {
  step: WizardStep;
  gender?: Gender;
  age?: number;
  height?: number;
  weight?: number;
  manualField?: ManualGoalField;
  manualGoals?: Partial<Record<ManualGoalField, number>>;
}

interface MacroGoals {
  protein: number;
  carbs: number;
  fat: number;
}

// In-memory state per telegramId
export const wizardState = new Map<number, WizardState>();

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: '🪑 Сидячий (нет физ. нагрузки)',
  light: '🚶 Лёгкий (1–3 дня/нед)',
  moderate: '🏃 Умеренный (3–5 дней/нед)',
  active: '💪 Активный (6–7 дней/нед)',
  very_active: '🔥 Очень активный (2× в день)',
};

function calcTDEE(gender: Gender, age: number, height: number, weight: number, activity: ActivityLevel): number {
  // Mifflin-St Jeor BMR
  const bmr =
    gender === 'male'
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

  const multipliers: Record<ActivityLevel, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  return Math.round(bmr * multipliers[activity]);
}

function calcMacroGoals(calories: number, weight: number): MacroGoals {
  const protein = Math.round(weight * 1.6);
  const fat = Math.round(weight * 0.8);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  return { protein, carbs, fat };
}

function formatGoalValue(value: number | undefined, suffix: string): string {
  return value !== undefined ? `${value}${suffix}` : 'не указано';
}

function buildManualGoalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔥 Калории', 'manual_goal_calories')
    .text('🥩 Белки', 'manual_goal_protein')
    .row()
    .text('🍞 Углеводы', 'manual_goal_carbs')
    .text('🧈 Жиры', 'manual_goal_fat')
    .row()
    .text('✅ Сохранить', 'manual_goal_save');
}

function buildManualGoalText(goals: Partial<Record<ManualGoalField, number>>): string {
  return (
    `✏️ *Ручной ввод нормы*\n\n` +
    `🔥 Калории: ${formatGoalValue(goals.calories, ' ккал')}\n` +
    `🥩 Белки: ${formatGoalValue(goals.protein, 'г')}\n` +
    `🍞 Углеводы: ${formatGoalValue(goals.carbs, 'г')}\n` +
    `🧈 Жиры: ${formatGoalValue(goals.fat, 'г')}\n\n` +
    `Выбери кнопкой, что хочешь указать.`
  );
}

export async function handleGoal(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  const hasProfile = user?.weight && user?.height && user?.age && user?.gender && user?.activityLevel;

  const hasAnyGoal =
    user?.dailyCalorieGoal !== undefined ||
    user?.dailyProteinGoal !== undefined ||
    user?.dailyCarbsGoal !== undefined ||
    user?.dailyFatGoal !== undefined;
  const currentLine = hasAnyGoal
    ? `Текущая норма:\n` +
      `🔥 ${formatGoalValue(user?.dailyCalorieGoal, ' ккал')}\n` +
      `🥩 ${formatGoalValue(user?.dailyProteinGoal, 'г')}  |  ` +
      `🍞 ${formatGoalValue(user?.dailyCarbsGoal, 'г')}  |  ` +
      `🧈 ${formatGoalValue(user?.dailyFatGoal, 'г')}`
    : `Норма не установлена`;

  const kb = new InlineKeyboard()
    .text('📋 Рассчитать по параметрам', 'goal_calc').row()
    .text('✏️ Ввести вручную', 'goal_manual');

  const profileInfo = hasProfile
    ? `\n\n👤 *Твой профиль:*\n` +
      `Пол: ${user!.gender === 'male' ? 'Мужской' : 'Женский'}\n` +
      `Возраст: ${user!.age} лет\n` +
      `Рост: ${user!.height} см\n` +
      `Вес: ${user!.weight} кг\n` +
      `Активность: ${ACTIVITY_LABELS[user!.activityLevel!]}`
    : '';

  await ctx.reply(
    `🎯 *Дневная норма калорий*\n\n${currentLine}${profileInfo}\n\nВыбери способ установки нормы:`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export async function handleGoalCalcCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  wizardState.set(telegramId, { step: 'gender' });

  const kb = new InlineKeyboard()
    .text('👨 Мужской', 'gender_male')
    .text('👩 Женский', 'gender_female');

  await ctx.reply('Шаг 1/5 — Укажи пол:', { reply_markup: kb });
}

export async function handleGenderCallback(ctx: Context, gender: Gender): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state) return;

  state.gender = gender;
  state.step = 'age';
  wizardState.set(telegramId, state);

  await ctx.reply('Шаг 2/5 — Сколько тебе лет? (введи число, например: 25)');
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

  const field = ctx.match instanceof Array ? ctx.match[1] as ManualGoalField : undefined;
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
      `🍞 ${formatGoalValue(goals.carbs, 'г')}  |  ` +
      `🧈 ${formatGoalValue(goals.fat, 'г')}`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleManualGoalCancelCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) {
    wizardState.delete(telegramId);
  }
  await ctx.answerCallbackQuery({ text: '❌ Ручной ввод отменён' });
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
    if (isNaN(value)) {
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
    const age = parseInt(text, 10);
    if (isNaN(age) || age < 10 || age > 120) {
      await ctx.reply('❌ Введи корректный возраст (10–120):');
      return true;
    }
    state.age = age;
    state.step = 'height';
    wizardState.set(telegramId, state);
    await ctx.reply('Шаг 3/5 — Рост в сантиметрах (например: 175):');
    return true;
  }

  if (state.step === 'height') {
    const height = parseInt(text, 10);
    if (isNaN(height) || height < 100 || height > 250) {
      await ctx.reply('❌ Введи корректный рост в см (100–250):');
      return true;
    }
    state.height = height;
    state.step = 'weight';
    wizardState.set(telegramId, state);
    await ctx.reply('Шаг 4/5 — Вес в килограммах (например: 70):');
    return true;
  }

  if (state.step === 'weight') {
    const weight = parseFloat(text.replace(',', '.'));
    if (isNaN(weight) || weight < 30 || weight > 300) {
      await ctx.reply('❌ Введи корректный вес в кг (30–300):');
      return true;
    }
    state.weight = weight;
    state.step = 'activity';
    wizardState.set(telegramId, state);

    const kb = new InlineKeyboard()
      .text('🪑 Сидячий', 'activity_sedentary').row()
      .text('🚶 Лёгкий (1–3 дня/нед)', 'activity_light').row()
      .text('🏃 Умеренный (3–5 дней/нед)', 'activity_moderate').row()
      .text('💪 Активный (6–7 дней/нед)', 'activity_active').row()
      .text('🔥 Очень активный (2× в день)', 'activity_very_active');

    await ctx.reply('Шаг 5/5 — Уровень физической активности:', { reply_markup: kb });
    return true;
  }

  return false;
}

export async function handleActivityCallback(ctx: Context, activity: ActivityLevel): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  await ctx.answerCallbackQuery();

  const state = wizardState.get(telegramId);
  if (!state || !state.gender || !state.age || !state.height || !state.weight) {
    await ctx.reply('❌ Что-то пошло не так. Начни заново — нажми 👤 Мой профиль.');
    wizardState.delete(telegramId);
    return;
  }

  const tdee = calcTDEE(state.gender, state.age, state.height, state.weight, activity);
  const macros = calcMacroGoals(tdee, state.weight);

  await User.findOneAndUpdate(
    { telegramId },
    {
      dailyCalorieGoal: tdee,
      dailyProteinGoal: macros.protein,
      dailyCarbsGoal: macros.carbs,
      dailyFatGoal: macros.fat,
      gender: state.gender,
      age: state.age,
      height: state.height,
      weight: state.weight,
      activityLevel: activity,
    },
    { upsert: true }
  );

  wizardState.delete(telegramId);

  const genderLabel = state.gender === 'male' ? 'Мужской' : 'Женский';
  const activityLabel = ACTIVITY_LABELS[activity];

  await ctx.reply(
    `✅ *Норма рассчитана!*\n\n` +
      `👤 Пол: ${genderLabel}\n` +
      `🎂 Возраст: ${state.age} лет\n` +
      `📏 Рост: ${state.height} см\n` +
      `⚖️ Вес: ${state.weight} кг\n` +
      `🏋️ Активность: ${activityLabel}\n\n` +
      `🔥 *Дневная норма: ${tdee} ккал*\n` +
      `🥩 Белки: ${macros.protein}г\n` +
      `🍞 Углеводы: ${macros.carbs}г\n` +
      `🧈 Жиры: ${macros.fat}г\n\n` +
      `_Рассчитано по формуле Миффлина-Сан Жеора_`,
    { parse_mode: 'Markdown' }
  );
}
