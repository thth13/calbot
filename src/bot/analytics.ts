import type { Context, NextFunction } from 'grammy';
import {
  BotEvent,
  BotEventType,
  PERSISTED_BOT_EVENT_TYPES,
} from '../db/models/BotEvent.js';
import { sendAdminNotification } from './adminNotifications.js';

function getCommand(text?: string): string | undefined {
  if (!text?.startsWith('/')) {
    return undefined;
  }

  return text.split(/\s+/)[0]?.slice(1).split('@')[0]?.toLowerCase();
}

export function getAdminTelegramIds(): number[] {
  return (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id));
}

export function isAdmin(ctx: Context): boolean {
  const telegramId = ctx.from?.id;
  return Boolean(telegramId && getAdminTelegramIds().includes(telegramId));
}

export async function recordBotEvent(
  ctx: Context,
  type: BotEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  const from = ctx.from;

  try {
    const event = {
      type,
      telegramId: from?.id,
      username: from?.username,
      firstName: from?.first_name,
      command: getCommand(ctx.message?.text),
      callbackData: ctx.callbackQuery?.data,
      metadata,
    };

    if (PERSISTED_BOT_EVENT_TYPES.has(type)) {
      await BotEvent.create(event);
    }
    await sendAdminNotification(event);
  } catch (err) {
    console.error('Analytics event error:', err);
  }
}

export async function trackBotEvent(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.message?.text) {
    await recordBotEvent(ctx, getCommand(ctx.message.text) ? 'command' : 'text_message');
  } else if (ctx.message?.photo) {
    await recordBotEvent(ctx, 'photo_message');
  } else if (ctx.callbackQuery) {
    await recordBotEvent(ctx, 'callback_query');
  }

  await next();
}
