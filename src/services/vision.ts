import OpenAI from 'openai';

export interface NutritionResult {
  foodDescription: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'low' | 'medium' | 'high';
  tokensUsed: number;
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a nutrition expert. Estimate nutritional content.
Always respond with valid JSON only, no markdown, no extra text.
Be realistic about portion sizes.
If multiple dishes are present, sum everything up.`;

const USER_PROMPT = `Analyze this food image and estimate nutritional content.
Return ONLY a JSON object with these exact fields:
{
  "foodDescription": "brief description of what you see",
  "calories": <number>,
  "protein": <number in grams>,
  "carbs": <number in grams>,
  "fat": <number in grams>,
  "confidence": "low" | "medium" | "high"
}
Use confidence "low" if image is blurry or food is hard to identify, "high" if clearly visible standard dishes.`;

const TEXT_USER_PROMPT = `Analyze this user-described meal and estimate nutritional content.
Return ONLY a JSON object with these exact fields:
{
  "foodDescription": "brief normalized description of the meal",
  "calories": <number>,
  "protein": <number in grams>,
  "carbs": <number in grams>,
  "fat": <number in grams>,
  "confidence": "low" | "medium" | "high"
}
Use confidence "low" when portion size or ingredients are unclear, "medium" for a reasonable everyday estimate, and "high" only when the description includes clear quantities.`;

function parseNutritionResponse(content: string, tokensUsed: number): NutritionResult {
  const jsonString = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonString) as NutritionResult;

  // Базовая валидация
  if (
    typeof parsed.calories !== 'number' ||
    typeof parsed.protein !== 'number' ||
    typeof parsed.carbs !== 'number' ||
    typeof parsed.fat !== 'number' ||
    typeof parsed.foodDescription !== 'string' ||
    !['low', 'medium', 'high'].includes(parsed.confidence)
  ) {
    throw new Error('Invalid nutrition data from OpenAI');
  }

  return { ...parsed, tokensUsed };
}

export async function analyzeFood(imageUrl: string, details?: string): Promise<NutritionResult> {
  const userText = details
    ? `${USER_PROMPT}\n\nAdditional details from user: ${details}`
    : USER_PROMPT;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const tokensUsed = response.usage?.total_tokens ?? 0;

  return parseNutritionResponse(content, tokensUsed);
}

export async function analyzeFoodDescription(description: string): Promise<NutritionResult> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${TEXT_USER_PROMPT}\n\nMeal description from user: ${description}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const tokensUsed = response.usage?.total_tokens ?? 0;
  return parseNutritionResponse(content, tokensUsed);
}
