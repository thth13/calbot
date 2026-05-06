import OpenAI from 'openai';

export type TextMessageIntent = 'meal_log' | 'general';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const INTENT_SYSTEM_PROMPT = `Classify Telegram bot user text.
Return valid JSON only.

Intent "meal_log" means the user wants to record a consumed or planned eating occasion, or gives a direct food/meal description suitable for calorie logging.
Examples: "съел рис 100 г и курицу", "яблоко 150 г", "на завтрак омлет", "coffee with milk", "2 яйца и хлеб".

Intent "general" means normal assistant chat, questions, requests, jokes, bot usage questions, or food/nutrition questions that are not asking to log a specific eaten meal.
Examples: "как дела?", "что такое белок?", "сколько калорий в яблоке?", "помоги написать письмо", "что мне приготовить?", "как пользоваться ботом?".

When unsure, use "general" unless the text is clearly a meal entry.`;

const ASSISTANT_SYSTEM_PROMPT = `You are CalBot's general AI assistant inside a nutrition tracking Telegram bot.
Answer naturally and helpfully in the user's language.
Be concise by default.
If the user asks about nutrition, food, or the bot, help them, but do not claim that you recorded a meal unless the user explicitly asked to log one.`;

function parseIntentResponse(content: string): TextMessageIntent {
  const jsonString = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonString) as { intent?: TextMessageIntent };

  return parsed.intent === 'meal_log' ? 'meal_log' : 'general';
}

export async function classifyTextMessageIntent(text: string): Promise<TextMessageIntent> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 50,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty intent response from OpenAI');

  return parseIntentResponse(content);
}

export async function answerGeneralQuestion(text: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 700,
    temperature: 0.7,
    messages: [
      { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty assistant response from OpenAI');

  return content;
}
