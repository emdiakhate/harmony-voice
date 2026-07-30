import { chatComplete, resolveLlmConfig, describeChain, type LlmConfigInput } from './llm/router.js';

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

export function splitTextIntoChunks(text: string, maxLength: number): string[] {
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

interface TranslateCallbacks {
  onProgress?: (progress: number) => void;
  onPartialResult?: (partialText: string, progress: number) => void;
  onProviderSwitch?: (from: string, to: string) => void;
  onChunkTranslated?: (index: number, text: string, totalChunks: number) => void;
}

/**
 * Detect the language of a text sample via the LLM router.
 * Returns ISO 639-1 code (e.g. 'fr', 'en', 'es') or 'unknown'.
 */
export async function detectLanguage(text: string, llmConfig?: LlmConfigInput | null): Promise<string> {
  const sample = text.slice(0, 1000);
  const attempts = resolveLlmConfig(llmConfig);
  if (attempts.length === 0) return 'unknown';

  const systemPrompt = `Detect the language of the following text. Reply with ONLY the ISO 639-1 language code (e.g. "fr", "en", "es", "de", "pt", "it", "ar", "zh", "ja", "ko", "ru", "hi"). Nothing else.`;

  try {
    const result = await chatComplete({
      label: 'DetectLang',
      attempts,
      temperature: 0,
      maxTokens: 5,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sample },
      ],
    });
    const code = result.trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
    if (code && code.length === 2) {
      console.log(`[Translator] Detected language: ${code}`);
      return code;
    }
  } catch (err: any) {
    console.warn(`[Translator] Language detection failed: ${err?.message || err}`);
  }
  return 'unknown';
}

export async function translateText(
  text: string,
  targetLang: string,
  onProgress?: (progress: number) => void,
  callbacks?: TranslateCallbacks,
  llmConfig?: LlmConfigInput | null,
): Promise<string> {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const translatedChunks: string[] = [];

  const attempts = resolveLlmConfig(llmConfig);
  if (attempts.length === 0) {
    throw new Error('Aucun fournisseur LLM disponible pour la traduction (ajoutez une clé ou activez un tier gratuit).');
  }

  console.log(`[Translator] Chain: ${describeChain(attempts)} (${chunks.length} chunks)`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let translated: string;

    try {
      // Le routeur gère le failover entre fournisseurs/clés en interne.
      translated = await chatComplete({
        label: 'Translate',
        attempts,
        temperature: 0.3,
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT(langName) },
          { role: 'user', content: chunk },
        ],
        onProviderSwitch: callbacks?.onProviderSwitch,
      });
    } catch (error: any) {
      // Tous les fournisseurs ont échoué pour ce chunk → renvoyer le partiel si possible.
      if (translatedChunks.length > 0) {
        throw new PartialTranslationError(
          translatedChunks.join(' '),
          i,
          chunks.length,
          error?.message || 'Erreur de traduction',
        );
      }
      throw error;
    }

    translatedChunks.push(translated);
    const progress = Math.round(((i + 1) / chunks.length) * 100);
    onProgress?.(progress);
    callbacks?.onChunkTranslated?.(i, translated, chunks.length);
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
