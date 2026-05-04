import OpenAI from 'openai';

export interface NutritionResult {
  foodDescription: string;
  mealType: 'meal' | 'snack';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'low' | 'medium' | 'high';
  tokensUsed: number;
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a nutrition expert. Estimate nutritional content and classify eating occasion type.
Always respond with valid JSON only, no markdown, no extra text.
Be realistic about portion sizes.
If multiple dishes are present, sum everything up.`;

const USER_PROMPT = `Analyze this food image and estimate nutritional content.
Classify the eating occasion:
- "snack" if it looks like a small bite, drink, dessert, fruit, bar, nuts, yogurt, sandwich half, or other light food that is not a complete meal;
- "meal" if it looks like breakfast, lunch, dinner, a full plate, or a substantial combined dish.
Return ONLY a JSON object with these exact fields:
{
  "foodDescription": "brief description of what you see",
  "mealType": "meal" | "snack",
  "calories": <number>,
  "protein": <number in grams>,
  "carbs": <number in grams>,
  "fat": <number in grams>,
  "confidence": "low" | "medium" | "high"
}
Use confidence "low" if image is blurry or food is hard to identify, "high" if clearly visible standard dishes.`;

const TEXT_USER_PROMPT = `Analyze this user-described meal and estimate nutritional content.
The user may write in Russian, Ukrainian, English, or a mix of them.
Classify the eating occasion:
- "snack" if the user describes a small bite, drink, dessert, fruit, bar, nuts, yogurt, a small sandwich, "перекус", "снек", "snack", or other light food that is not a complete meal;
- "meal" if the user describes breakfast, lunch, dinner, a full plate, or a substantial combined dish.
Treat explicit quantities as authoritative:
- grams/g/г/гр/грамм mean the exact edible weight of that product;
- kilograms/kg/кг must be converted to grams and scaled exactly;
- milliliters/ml/мл and liters/l/л are liquid volume, not grams unless the product density is obvious;
- pieces/шт/штуки are count-based portions and should use typical item weights only if no gram weight is provided;
- if a product has both count and grams, use grams for nutrition scaling.
Do not replace explicit gram quantities with a "standard serving". If the user says "рис 100 г", estimate nutrition for 100 g rice, not for a full plate.
If the user lists several products, calculate each product from its own quantity and sum the meal.
Return ONLY a JSON object with these exact fields:
{
  "foodDescription": "brief normalized description of the meal",
  "mealType": "meal" | "snack",
  "calories": <number>,
  "protein": <number in grams>,
  "carbs": <number in grams>,
  "fat": <number in grams>,
  "confidence": "low" | "medium" | "high"
}
Use confidence "low" when portion size or ingredients are unclear, "medium" for a reasonable everyday estimate, and "high" only when the description includes clear quantities.`;

const UNIT_REPLACEMENTS: Array<[RegExp, (value: number) => string]> = [
  [/(\d+(?:\.\d+)?)\s*(?:кг\.?|килограмм(?:а|ов)?|kilograms?|kgs?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value * 1000)} g`],
  [/(\d+(?:\.\d+)?)\s*(?:г\.?|гр\.?|грамм(?:а|ов)?|grams?|g\.?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value)} g`],
  [/(\d+(?:\.\d+)?)\s*(?:мл\.?|миллилитр(?:а|ов)?|milliliters?|millilitres?|ml\.?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value)} ml`],
  [/(\d+(?:\.\d+)?)\s*(?:л\.?|литр(?:а|ов)?|liters?|litres?|l\.?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value)} l`],
  [/(\d+(?:\.\d+)?)\s*(?:шт\.?|штук(?:и)?|штуки?|pieces?|pcs?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value)} pcs`],
  [/(\d+(?:\.\d+)?)\s*(?:ст\.?\s*л\.?|столов(?:ая|ые|ых)\s+лож(?:ка|ки|ек)|tbsp|tablespoons?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value)} tbsp`],
  [/(\d+(?:\.\d+)?)\s*(?:ч\.?\s*л\.?|чай(?:ная|ные|ных)\s+лож(?:ка|ки|ек)|tsp|teaspoons?)(?![\p{L}\p{N}_])/giu, (value) => `${formatQuantity(value)} tsp`],
];

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeMealDescription(description: string): string {
  let normalized = description
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(^|[^\p{L}\p{N}_])пол\s*(?:кг\.?|килограмма|килограмм|kg)(?![\p{L}\p{N}_])/giu, (_match, prefix) => `${prefix}500 g`)
    .replace(/(^|[^\p{L}\p{N}_])пол\s*(?:л\.?|литра|литр|l)(?![\p{L}\p{N}_])/giu, (_match, prefix) => `${prefix}0.5 l`)
    .replace(/(^|[^\p{L}\p{N}_])полкило(?![\p{L}\p{N}_])/giu, (_match, prefix) => `${prefix}500 g`)
    .replace(/(^|[^\p{L}\p{N}_])половин[ау]\s+(?:кг\.?|килограмма|килограмм|kg)(?![\p{L}\p{N}_])/giu, (_match, prefix) => `${prefix}500 g`)
    .replace(/(^|[^\p{L}\p{N}_])половин[ау]\s+(?:л\.?|литра|литр|l)(?![\p{L}\p{N}_])/giu, (_match, prefix) => `${prefix}0.5 l`);

  for (const [pattern, replacer] of UNIT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, (_match, rawValue: string) => replacer(Number(rawValue)));
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

function buildTextAnalysisPrompt(description: string): string {
  const normalizedDescription = normalizeMealDescription(description);
  const normalizedBlock =
    normalizedDescription === description.trim()
      ? ''
      : `\nNormalized description with standardized units: ${normalizedDescription}`;

  return `${TEXT_USER_PROMPT}\n\nMeal description from user: ${description}${normalizedBlock}`;
}

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
    !['meal', 'snack'].includes(parsed.mealType) ||
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
    temperature: 0.2,
    response_format: { type: 'json_object' },
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
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildTextAnalysisPrompt(description),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  const tokensUsed = response.usage?.total_tokens ?? 0;
  return parseNutritionResponse(content, tokensUsed);
}
