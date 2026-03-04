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

type Provider = 'groq' | 'openrouter' | 'openai';

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

  // If no sentence boundaries were found, split by character count
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.slice(i, i + maxLength));
    }
  }

  return chunks;
}

/**
 * Get ordered list of available providers.
 * Priority: Groq > OpenRouter > OpenAI
 */
function getAvailableProviders(): Provider[] {
  const providers: Provider[] = [];
  if (process.env.GROQ_API_KEY) providers.push('groq');
  if (process.env.OPENROUTER_API_KEY) providers.push('openrouter');
  if (process.env.OPENAI_API_KEY) providers.push('openai');
  return providers;
}

function isRateLimitError(error: any): boolean {
  if (error?.status === 429) return true;
  if (error?.statusCode === 429) return true;
  const msg = error?.message || error?.error?.message || '';
  return msg.includes('rate_limit') || msg.includes('Rate limit') || msg.includes('429');
}

interface TranslateCallbacks {
  onProgress?: (progress: number) => void;
  onPartialResult?: (partialText: string, progress: number) => void;
  onProviderSwitch?: (from: string, to: string) => void;
}

export async function translateText(
  text: string,
  targetLang: string,
  onProgress?: (progress: number) => void,
  callbacks?: TranslateCallbacks
): Promise<string> {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const translatedChunks: string[] = [];

  const availableProviders = getAvailableProviders();
  if (availableProviders.length === 0) {
    throw new Error('Aucune clé API configurée pour la traduction.');
  }

  // Track which providers are exhausted (rate limited)
  const exhaustedProviders = new Set<Provider>();
  let currentProviderIndex = 0;

  function getCurrentProvider(): Provider | null {
    while (currentProviderIndex < availableProviders.length) {
      const p = availableProviders[currentProviderIndex];
      if (!exhaustedProviders.has(p)) return p;
      currentProviderIndex++;
    }
    return null;
  }

  let provider = getCurrentProvider();
  if (!provider) throw new Error('Aucun fournisseur LLM disponible.');

  console.log(`[Translator] Using ${provider} for translation (${chunks.length} chunks)`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let translated: string | null = null;
    let lastError: any = null;

    // Try current provider, fallback on rate limit
    while (!translated) {
      if (!provider) {
        // All providers exhausted — return partial results
        if (translatedChunks.length > 0) {
          const partial = translatedChunks.join(' ');
          console.log(`[Translator] All providers rate-limited at chunk ${i}/${chunks.length}. Returning partial: ${translatedChunks.length} chunks translated.`);
          throw new PartialTranslationError(
            partial,
            i,
            chunks.length,
            `Tous les fournisseurs sont en limite de débit. ${translatedChunks.length}/${chunks.length} chunks traduits.`
          );
        }
        throw lastError || new Error('Tous les fournisseurs LLM sont en limite de débit.');
      }

      try {
        translated = await translateChunk(provider, chunk, langName);
      } catch (error: any) {
        lastError = error;

        if (isRateLimitError(error)) {
          const oldProvider = provider;
          exhaustedProviders.add(provider);
          currentProviderIndex++;
          provider = getCurrentProvider();

          if (provider) {
            console.log(`[Translator] Rate limit on ${oldProvider}, switching to ${provider} (chunk ${i + 1}/${chunks.length})`);
            callbacks?.onProviderSwitch?.(oldProvider, provider);
          }
          // Loop will retry with new provider or exit if null
        } else {
          // Non-rate-limit error: throw immediately
          if (translatedChunks.length > 0) {
            throw new PartialTranslationError(
              translatedChunks.join(' '),
              i,
              chunks.length,
              error.message || 'Erreur de traduction'
            );
          }
          throw error;
        }
      }
    }

    translatedChunks.push(translated);
    const progress = Math.round(((i + 1) / chunks.length) * 100);
    onProgress?.(progress);
    callbacks?.onPartialResult?.(translatedChunks.join(' '), progress);
  }

  return translatedChunks.join(' ');
}

/**
 * Error thrown when translation is partially complete.
 * Contains the partial translation so the frontend can use it.
 */
export class PartialTranslationError extends Error {
  public partialText: string;
  public completedChunks: number;
  public totalChunks: number;

  constructor(partialText: string, completedChunks: number, totalChunks: number, message: string) {
    super(message);
    this.name = 'PartialTranslationError';
    this.partialText = partialText;
    this.completedChunks = completedChunks;
    this.totalChunks = totalChunks;
  }
}

const TRANSLATE_SYSTEM_PROMPT = (targetLang: string) =>
  `You are a professional translator. Translate the following text to ${targetLang}.
Keep the same meaning, tone, and style. Output ONLY the translation, nothing else.
If the text contains technical terms (programming, AI, etc.), translate naturally but keep well-known English technical terms when appropriate.`;

async function translateChunk(provider: Provider, text: string, targetLang: string): Promise<string> {
  switch (provider) {
    case 'groq': return translateWithGroq(text, targetLang);
    case 'openrouter': return translateWithOpenRouter(text, targetLang);
    case 'openai': return translateWithOpenAI(text, targetLang);
  }
}

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
