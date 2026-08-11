import type { BotEventType } from '../db/models/BotEvent.js';
import { getAdminTelegramIds } from './analytics.js';

interface AdminNotification {
  type: BotEventType;
  telegramId?: number;
  username?: string;
  firstName?: string;
  command?: string;
  callbackData?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_NOTIFICATION_EVENTS = new Set<BotEventType>([
  'registration',
  'meal_logged',
  'entry_edited',
  'entry_deleted',
]);

const IGNORED_USER_TELEGRAM_IDS = new Set([782328120, 1835555772]);

function getNotificationBotToken(): string | undefined {
  return process.env.ADMIN_NOTIFICATION_BOT_TOKEN;
}

function getNotificationChatIds(): string[] {
  return getAdminTelegramIds().map(String);
}

function getEnabledEvents(): Set<string> {
  const raw = process.env.ADMIN_NOTIFICATION_EVENTS;
  if (!raw) {
    return DEFAULT_NOTIFICATION_EVENTS;
  }

  return new Set(
    raw
      .split(',')
      .map((event) => event.trim())
      .filter(Boolean)
  );
}

function shouldSendNotification(type: BotEventType): boolean {
  const enabledEvents = getEnabledEvents();
  return enabledEvents.has('all') || enabledEvents.has(type);
}

function formatUser(event: AdminNotification): string {
  const name = event.username ? `@${event.username}` : event.firstName;
  return name ? `${name} (${event.telegramId ?? 'unknown'})` : String(event.telegramId ?? 'unknown');
}

function formatAdminNotification(event: AdminNotification): string {
  const lines = [`CalBot event: ${event.type}`, `User: ${formatUser(event)}`];

  if (event.command) {
    lines.push(`Command: /${event.command}`);
  }
  if (event.callbackData) {
    lines.push(`Callback: ${event.callbackData}`);
  }
  if (event.metadata) {
    const details = Object.entries(event.metadata)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
    if (details) {
      lines.push(`Details: ${details}`);
    }
  }

  return lines.join('\n');
}

export async function sendAdminNotification(event: AdminNotification): Promise<void> {
  if (
    !shouldSendNotification(event.type) ||
    (event.telegramId !== undefined && IGNORED_USER_TELEGRAM_IDS.has(event.telegramId))
  ) {
    return;
  }

  const token = getNotificationBotToken();
  const chatIds = getNotificationChatIds();
  if (!token || chatIds.length === 0) {
    return;
  }

  const text = formatAdminNotification(event);

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        });

        if (!response.ok) {
          console.error('Admin notification error:', await response.text());
        }
      } catch (err) {
        console.error('Admin notification request error:', err);
      }
    })
  );
}
