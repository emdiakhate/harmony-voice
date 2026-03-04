import OpenAI from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs';

const MAX_TTS_CHARS = 4096;

export function splitForTTS(text: string): string[] {
  if (text.length <= MAX_TTS_CHARS) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > MAX_TTS_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  // Fallback: if a single sentence is too long, split by character count
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_TTS_CHARS) {
      result.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += MAX_TTS_CHARS) {
        result.push(chunk.slice(i, i + MAX_TTS_CHARS));
      }
    }
  }

  return result;
}

/**
 * TTS provider priority: ElevenLabs > OpenAI
 * Uses ElevenLabs first to preserve OpenAI quota. Falls back to OpenAI if ElevenLabs unavailable.
 */
export async function generateSpeechChunk(text: string): Promise<Buffer> {
  // Try ElevenLabs first
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      console.log('[TTS] Using ElevenLabs (eleven_multilingual_v2)');
      const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
      const audio = await elevenlabs.textToSpeech.convert(
        'EXAVITQu4vr4xnSDxMaL', // "Sarah" - clear female voice
        {
          text,
          modelId: 'eleven_multilingual_v2',
          outputFormat: 'mp3_44100_128',
        }
      );
      // Convert ReadableStream to Buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of audio) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err?.status === 429 || err?.statusCode === 429) {
        console.warn('[TTS] ElevenLabs quota exceeded, falling back to OpenAI...');
      } else {
        throw err;
      }
    }
  }

  // Fallback: OpenAI
  if (process.env.OPENAI_API_KEY) {
    console.log('[TTS] Using OpenAI TTS (tts-1, nova)');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      response_format: 'mp3',
    });
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error('Aucun provider TTS disponible. Configurez ELEVENLABS_API_KEY ou OPENAI_API_KEY dans .env');
}

export async function generateSpeech(
  text: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const chunks = splitForTTS(text);
  const audioBuffers: Buffer[] = [];

  console.log(`[TTS] Generating audio for ${chunks.length} chunks (${text.length} chars total)`);

  for (let i = 0; i < chunks.length; i++) {
    const buffer = await generateSpeechChunk(chunks[i]);
    audioBuffers.push(buffer);
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
  }

  const finalBuffer = Buffer.concat(audioBuffers);
  fs.writeFileSync(outputPath, finalBuffer);

  console.log(`[TTS] Audio saved to ${outputPath} (${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
}
