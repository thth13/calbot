import { Context } from 'grammy';
import { BotEvent } from '../../db/models/BotEvent.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { isAdmin } from '../analytics.js';

const EVENT_LABELS: Record<string, string> = {
  bot_started: 'bot started',
  quiz_completed: 'questionnaire completed',
  onboarding_skipped: 'setup skipped',
  command: 'command',
  text_message: 'text message',
  photo_message: 'photo',
  callback_query: 'button clicked',
  meal_logged: 'meal logged',
  entry_edited: 'entry edited',
  entry_deleted: 'entry deleted',
  premium_offer_shown: 'Premium offer shown',
  premium_purchase_clicked: 'Premium purchase clicked',
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
    return 'No activity yet';
  }

  return counts.map((item) => `• ${EVENT_LABELS[item._id] ?? item._id}: ${item.count}`).join('\n');
}

export async function handleAdminStats(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) {
    await ctx.reply('Access denied.');
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
            return `• ${name} — ${user.createdAt.toLocaleString('en-GB')}`;
          })
          .join('\n')
      : 'No users yet';

  await ctx.reply(
    `Admin statistics\n\n` +
      `Users\n` +
      `• Total: ${totalUsers}\n` +
      `• Today: ${todayUsers}\n` +
      `• Last 7 days: ${weekUsers}\n` +
      `• Last 30 days: ${monthUsers}\n\n` +
      `Food entries\n` +
      `• Total: ${totalEntries}\n` +
      `• Today: ${todayEntries}\n` +
      `• Last 7 days: ${weekEntries}\n` +
      `• Last 30 days: ${monthEntries}\n\n` +
      `Activity\n` +
      `• Today: ${todayActions}\n` +
      `• Last 7 days: ${weekActions}\n` +
      `• Last 30 days: ${monthActions}\n` +
      `• Active users in the last 7 days: ${activeUsers7d.length}\n\n` +
      `Activity by type over the last 7 days\n` +
      `${formatEventCounts(actionCounts)}\n\n` +
      `Latest registrations\n` +
      latestUsersText
  );
}
