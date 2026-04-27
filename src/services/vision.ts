import OpenAI from 'openai';

export interface NutritionResult {
  foodDescription: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'low' | 'medium' | 'high';
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a nutrition expert. Analyze food photos and estimate nutritional content.
Always respond with valid JSON only, no markdown, no extra text.
Be realistic about portion sizes visible in the image.
If multiple dishes are visible, sum everything up.`;

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

  const jsonString = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonString) as NutritionResult;

  // Базовая валидация
  if (
    typeof parsed.calories !== 'number' ||
    typeof parsed.protein !== 'number' ||
    typeof parsed.carbs !== 'number' ||
    typeof parsed.fat !== 'number' ||
    typeof parsed.foodDescription !== 'string'
  ) {
    throw new Error('Invalid nutrition data from OpenAI');
  }

  return parsed;
}
