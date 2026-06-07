import { Context } from 'grammy';
import { BotEvent } from '../../db/models/BotEvent.js';
import { FoodEntry } from '../../db/models/FoodEntry.js';
import { User } from '../../db/models/User.js';
import { isAdmin } from '../analytics.js';

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
    return 'No actions yet';
  }

  return counts.map((item) => `• ${item._id}: ${item.count}`).join('\n');
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
            return `• ${name} - ${user.createdAt.toLocaleString('en-US')}`;
          })
          .join('\n')
      : 'No users yet';

  await ctx.reply(
    `Admin stats\n\n` +
      `Users\n` +
      `• Total: ${totalUsers}\n` +
      `• Today: ${todayUsers}\n` +
      `• 7 days: ${weekUsers}\n` +
      `• 30 days: ${monthUsers}\n\n` +
      `Food entries\n` +
      `• Total: ${totalEntries}\n` +
      `• Today: ${todayEntries}\n` +
      `• 7 days: ${weekEntries}\n` +
      `• 30 days: ${monthEntries}\n\n` +
      `Actions\n` +
      `• Today: ${todayActions}\n` +
      `• 7 days: ${weekActions}\n` +
      `• 30 days: ${monthActions}\n` +
      `• Active users 7d: ${activeUsers7d.length}\n\n` +
      `Actions by type, 7d\n` +
      `${formatEventCounts(actionCounts)}\n\n` +
      `Latest registrations\n` +
      latestUsersText
  );
}
