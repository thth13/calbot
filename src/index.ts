import 'dotenv/config';
import { connectDB } from './db/connection.js';
import { createBot } from './bot/index.js';
import { startWeeklyWeightPrompts } from './bot/weightTracking.js';

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set');

  await connectDB();

  const bot = createBot(token);
  const weeklyWeightPrompts = startWeeklyWeightPrompts(bot);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`Received ${signal}, stopping bot...`);
    weeklyWeightPrompts.stop();
    await bot.stop();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} started`),
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
