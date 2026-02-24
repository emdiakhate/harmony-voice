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

export async function translateText(
  text: string,
  targetLang: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const translatedChunks: string[] = [];

  const useGroq = !!process.env.GROQ_API_KEY;

  console.log(`[Translator] Using ${useGroq ? 'Groq' : 'OpenAI'} for translation (${chunks.length} chunks)`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const translated = useGroq
      ? await translateWithGroq(chunk, langName)
      : await translateWithOpenAI(chunk, langName);
    translatedChunks.push(translated);
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
  }

  return translatedChunks.join(' ');
}

async function translateWithOpenAI(text: string, targetLang: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate the following text to ${targetLang}.
Keep the same meaning, tone, and style. Output ONLY the translation, nothing else.
If the text contains technical terms (programming, AI, etc.), translate naturally but keep well-known English technical terms when appropriate.`
      },
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
      {
        role: 'system',
        content: `You are a professional translator. Translate the following text to ${targetLang}.
Keep the same meaning, tone, and style. Output ONLY the translation, nothing else.
If the text contains technical terms (programming, AI, etc.), translate naturally but keep well-known English technical terms when appropriate.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || '';
}
