import { Context } from 'grammy';
import { BotEvent } from '../../db/models/BotEvent.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { isAdmin } from '../analytics.js';

const EVENT_LABELS: Record<string, string> = {
  bot_started: 'запуск бота',
  quiz_completed: 'опитування успішно завершено',
  command: 'команда',
  text_message: 'текстове повідомлення',
  photo_message: 'фото',
  callback_query: 'натискання кнопки',
  meal_logged: 'прийом їжі записано',
  entry_edited: 'запис відредаговано',
  entry_deleted: 'запис видалено',
  premium_offer_shown: 'показано пропозицію Premium',
  premium_purchase_clicked: 'натиснуто купівлю Premium',
};

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function countSince(model: { countDocuments: (filter: Record<string, unknown>) => Promise<number> }, since: Date) {
  return model.countDocuments({ createdAt: { $gte: since } });
}

function formatEventCounts(counts: Array<{ _id: string; count: number }>): string {
  if (counts.length === 0) {
    return 'Дій ще немає';
  }

  return counts.map((item) => `• ${EVENT_LABELS[item._id] ?? item._id}: ${item.count}`).join('\n');
}

export async function handleAdminStats(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) {
    await ctx.reply('Доступ заборонено.');
    return;
  }

  const today = startOfToday();
  const last7Days = daysAgo(7);
  const last30Days = daysAgo(30);

  const [
    totalUsers,
    todayUsers,
    weekUsers,
    monthUsers,
    totalEntries,
    todayEntries,
    weekEntries,
    monthEntries,
    todayActions,
    weekActions,
    monthActions,
    actionCounts,
    activeUsers7d,
    latestUsers,
  ] = await Promise.all([
    User.countDocuments({}),
    countSince(User, today),
    countSince(User, last7Days),
    countSince(User, last30Days),
    FoodEntry.countDocuments({}),
    countSince(FoodEntry, today),
    countSince(FoodEntry, last7Days),
    countSince(FoodEntry, last30Days),
    countSince(BotEvent, today),
    countSince(BotEvent, last7Days),
    countSince(BotEvent, last30Days),
    BotEvent.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: last7Days } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    BotEvent.distinct('telegramId', { createdAt: { $gte: last7Days }, telegramId: { $exists: true } }),
    User.find({}).sort({ createdAt: -1 }).limit(5).select('telegramId username firstName createdAt'),
  ]);

  const latestUsersText =
    latestUsers.length > 0
      ? latestUsers
          .map((user) => {
            const name = user.username ? `@${user.username}` : user.firstName ?? String(user.telegramId);
            return `• ${name} — ${user.createdAt.toLocaleString('uk-UA')}`;
          })
          .join('\n')
      : 'Користувачів ще немає';

  await ctx.reply(
    `Статистика адміністратора\n\n` +
      `Користувачі\n` +
      `• Усього: ${totalUsers}\n` +
      `• Сьогодні: ${todayUsers}\n` +
      `• За 7 днів: ${weekUsers}\n` +
      `• За 30 днів: ${monthUsers}\n\n` +
      `Записи про їжу\n` +
      `• Усього: ${totalEntries}\n` +
      `• Сьогодні: ${todayEntries}\n` +
      `• За 7 днів: ${weekEntries}\n` +
      `• За 30 днів: ${monthEntries}\n\n` +
      `Дії\n` +
      `• Сьогодні: ${todayActions}\n` +
      `• За 7 днів: ${weekActions}\n` +
      `• За 30 днів: ${monthActions}\n` +
      `• Активні користувачі за 7 днів: ${activeUsers7d.length}\n\n` +
      `Дії за типами за 7 днів\n` +
      `${formatEventCounts(actionCounts)}\n\n` +
      `Останні реєстрації\n` +
      latestUsersText
  );
}
