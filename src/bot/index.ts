import { Bot } from 'grammy';
import { handleStart, mainKeyboard } from './handlers/start.js';
import { handlePhoto } from './handlers/photo.js';
import { handleToday, handleWeek, handleHistory, handleGoal } from './handlers/stats.js';

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command('start', handleStart);
  bot.command('today', handleToday);
  bot.command('week', handleWeek);
  bot.command('history', handleHistory);
  bot.command('goal', handleGoal);

  bot.hears('📅 Сегодня', handleToday);
  bot.hears('📊 Неделя', handleWeek);
  bot.hears('📋 История', handleHistory);
  bot.hears('🎯 Норма', handleGoal);

  bot.on('message:photo', handlePhoto);

  bot.catch((err) => {
    console.error('Bot error:', err.error);
  });

  return bot;
}
