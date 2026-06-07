import { Context, InlineKeyboard } from 'grammy';
import { User } from '../../db/models/User.js';
import type { IUser } from '../../db/models/User.js';
import { recordBotEvent } from '../analytics.js';

const DEFAULT_WEBAPP_URL = 'https://calbot-web-self.vercel.app';

function getWebAppUrl(): string {
  return process.env.WEBAPP_URL ?? DEFAULT_WEBAPP_URL;
}

export function isPremiumActive(user?: Pick<IUser, 'premium'> | null): boolean {
  if (user?.premium?.active !== true) {
    return false;
  }

  const expiresAt = user.premium.expiresAt;
  return !expiresAt || expiresAt.getTime() > Date.now();
}

function formatPremiumStatus(user?: Pick<IUser, 'premium'> | null): string {
  if (!isPremiumActive(user)) {
    return '';
  }

  const expiresAt = user?.premium?.expiresAt;
  return expiresAt ? `\n\nYour Premium is active until ${expiresAt.toLocaleDateString('en-US')}.` : '\n\nYour Premium is active.';
}

function buildPremiumUrl(ctx: Context): string {
  const url = new URL('/premium', getWebAppUrl());
  const from = ctx.from;
  const chat = ctx.chat;

  url.searchParams.set('source', 'telegram_bot');
  if (from?.id) url.searchParams.set('telegramId', String(from.id));
  if (chat?.id) url.searchParams.set('chatId', String(chat.id));
  if (from?.username) url.searchParams.set('username', from.username);
  if (from?.first_name) url.searchParams.set('firstName', from.first_name);

  return url.toString();
}

export function buildPremiumKeyboard(ctx?: Context): InlineKeyboard {
  const webAppUrl = ctx ? buildPremiumUrl(ctx) : new URL('/premium', getWebAppUrl()).toString();
  return new InlineKeyboard().webApp('Subscribe', webAppUrl);
}

export async function handlePremium(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  const status = formatPremiumStatus(user);

  await recordBotEvent(ctx, 'premium_offer_shown');

  await ctx.reply(
    `💎 *Premium CalBot*\n\n` +
      `• Unlimited scans\n` +
      `• Extended nutrition stats\n\n` +
      `Plans:\n` +
      `• Monthly - *$9.99*\n` +
      `• Yearly - *$99*${status}`,
    { parse_mode: 'Markdown', reply_markup: buildPremiumKeyboard(ctx) }
  );
}

export async function handlePremiumWebAppData(ctx: Context): Promise<void> {
  const data = ctx.message?.web_app_data?.data;
  if (!data) return;

  try {
    const payload = JSON.parse(data) as { event?: string; plan?: string; source?: string };
    if (payload.event !== 'premium_purchase_clicked') {
      return;
    }

    await recordBotEvent(ctx, 'premium_purchase_clicked', {
      plan: payload.plan,
      source: payload.source,
    });
  } catch (err) {
    console.error('Premium web app data parse error:', err);
  }
}
