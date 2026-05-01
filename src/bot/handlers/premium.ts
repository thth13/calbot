import { Context, InlineKeyboard } from 'grammy';
import { User } from '../../db/models/User.js';

const DEFAULT_PREMIUM_WEBAPP_URL = 'https://calbot-web-self.vercel.app/premium';

function getPremiumWebAppUrl(): string {
  return process.env.PREMIUM_WEBAPP_URL ?? process.env.WEBAPP_URL ?? DEFAULT_PREMIUM_WEBAPP_URL;
}

export function isPremiumActive(premiumUntil?: Date): boolean {
  return Boolean(premiumUntil && premiumUntil.getTime() > Date.now());
}

function buildPremiumUrl(ctx: Context): string {
  const url = new URL(getPremiumWebAppUrl());
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
  const webAppUrl = ctx ? buildPremiumUrl(ctx) : getPremiumWebAppUrl();
  return new InlineKeyboard().webApp('Открыть оплату', webAppUrl);
}

export async function handlePremium(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await User.findOne({ telegramId });
  const status = isPremiumActive(user?.premiumUntil)
    ? `\n\nТвой Premium активен до ${user!.premiumUntil!.toLocaleDateString('ru-RU')}.`
    : '';

  await ctx.reply(
    `💎 *Premium CalBot*\n\n` +
      `• Неограниченное количество сканирований\n` +
      `• Расширенная статистика питания\n\n` +
      `Тарифы:\n` +
      `• Месяц — *$9.99*\n` +
      `• Год — *$99*${status}`,
    { parse_mode: 'Markdown', reply_markup: buildPremiumKeyboard(ctx) }
  );
}
