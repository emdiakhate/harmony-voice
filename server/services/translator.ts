import OpenAI from 'openai';
import Groq from 'groq-sdk';

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  hi: 'Hindi',
};

const CHUNK_SIZE = 3000;

function splitTextIntoChunks(text: string, maxLength: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLength && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  // If no sentence boundaries were found, split by word count
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.slice(i, i + maxLength));
    }
  }

  return chunks;
}

/**
 * Determine which LLM provider to use.
 * Priority: Groq > OpenRouter > OpenAI
 */
function getProvider(): 'groq' | 'openrouter' | 'openai' {
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return 'openai';
}

export async function translateText(
  text: string,
  targetLang: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const translatedChunks: string[] = [];

  const provider = getProvider();
  console.log(`[Translator] Using ${provider} for translation (${chunks.length} chunks)`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let translated: string;

    if (provider === 'groq') {
      translated = await translateWithGroq(chunk, langName);
    } else if (provider === 'openrouter') {
      translated = await translateWithOpenRouter(chunk, langName);
    } else {
      translated = await translateWithOpenAI(chunk, langName);
    }

    translatedChunks.push(translated);
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
  }

  return translatedChunks.join(' ');
}

const TRANSLATE_SYSTEM_PROMPT = (targetLang: string) =>
  `You are a professional translator. Translate the following text to ${targetLang}.
Keep the same meaning, tone, and style. Output ONLY the translation, nothing else.
If the text contains technical terms (programming, AI, etc.), translate naturally but keep well-known English technical terms when appropriate.`;

async function translateWithOpenAI(text: string, targetLang: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: TRANSLATE_SYSTEM_PROMPT(targetLang) },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || '';
}

async function translateWithOpenRouter(text: string, targetLang: string): Promise<string> {
  const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });

  const response = await openrouter.chat.completions.create({
    model: 'meta-llama/llama-3.3-70b-instruct',
    messages: [
      { role: 'system', content: TRANSLATE_SYSTEM_PROMPT(targetLang) },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || '';
}

async function translateWithGroq(text: string, targetLang: string): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: TRANSLATE_SYSTEM_PROMPT(targetLang) },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || '';
}
