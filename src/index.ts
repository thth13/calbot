import 'dotenv/config';
import { connectDB } from './db/connection.js';
import { createBot } from './bot/index.js';

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set');

  await connectDB();

  const bot = createBot(token);
  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} started`),
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
