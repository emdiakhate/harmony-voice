import OpenAI from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
 * TTS provider priority: ElevenLabs > OpenAI > Gemini
 * Falls back through providers on quota errors.
 * Once a provider fails with quota, it's disabled for the rest of the server session.
 */
let elevenLabsDisabled = false;
let openAITTSDisabled = false;
let geminiTTSDisabled = false;

export async function generateSpeechChunk(text: string): Promise<Buffer> {
  // 1. Try ElevenLabs first (unless previously disabled)
  if (process.env.ELEVENLABS_API_KEY && !elevenLabsDisabled) {
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
      const chunks: Uint8Array[] = [];
      for await (const chunk of audio) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      const status = err?.status || err?.statusCode;
      const isQuotaExceeded = err?.body?.detail?.status === 'quota_exceeded';
      if (status === 429 || (status === 401 && isQuotaExceeded)) {
        console.warn('[TTS] ElevenLabs quota exceeded, disabling. Trying next provider...');
        elevenLabsDisabled = true;
      } else {
        throw err;
      }
    }
  }

  // 2. Try OpenAI TTS (unless previously disabled)
  if (process.env.OPENAI_API_KEY && !openAITTSDisabled) {
    try {
      console.log('[TTS] Using OpenAI TTS (tts-1, nova)');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: text,
        response_format: 'mp3',
      });
      return Buffer.from(await response.arrayBuffer());
    } catch (err: any) {
      const status = err?.status || err?.statusCode;
      if (status === 429) {
        console.warn('[TTS] OpenAI TTS quota exceeded, disabling. Trying next provider...');
        openAITTSDisabled = true;
      } else {
        throw err;
      }
    }
  }

  // 3. Fallback: Gemini TTS with retry (single-speaker mode)
  if (process.env.GOOGLE_API_KEY && !geminiTTSDisabled) {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[TTS] Using Gemini TTS fallback (gemini-2.5-flash-preview-tts)${attempt > 0 ? ` [retry ${attempt}/${MAX_RETRIES}]` : ''}`);
        return await generateWithGemini(text, process.env.GOOGLE_API_KEY);
      } catch (err: any) {
        const status = err?.status;
        if (status === 429) {
          console.warn('[TTS] Gemini TTS quota exceeded, disabling.');
          geminiTTSDisabled = true;
          break;
        }
        if (status === 500 || status === 503) {
          if (attempt < MAX_RETRIES) {
            const delay = (attempt + 1) * 2000;
            console.warn(`[TTS] Gemini TTS error ${status}, retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          console.warn(`[TTS] Gemini TTS failed after ${MAX_RETRIES + 1} attempts, disabling.`);
          geminiTTSDisabled = true;
          break;
        }
        throw err;
      }
    }
  }

  // 4. Ultimate fallback: Edge TTS (free, no API key needed)
  try {
    console.log('[TTS] Using Edge TTS fallback (free, fr-FR-DeniseNeural)');
    return await generateWithEdgeTTS(text);
  } catch (err: any) {
    console.error(`[TTS] Edge TTS failed: ${err.message}`);
  }

  throw new Error('Aucun provider TTS disponible. Tous les providers ont échoué ou sont désactivés.');
}

/**
 * Generate speech with Gemini TTS (single-speaker, Kore voice).
 * Returns MP3 buffer.
 */
async function generateWithGemini(text: string, apiKey: string): Promise<Buffer> {
  const GEMINI_MODEL = 'gemini-2.5-flash-preview-tts';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text }],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error: any = new Error(`Gemini TTS error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.response = { data: errorData };
    throw error;
  }

  const data = await response.json();

  const audioContent = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioContent) {
    throw new Error('Gemini TTS response missing audio data');
  }

  // Gemini returns raw PCM (s16le, 24kHz, mono) — convert to MP3
  const pcmBuffer = Buffer.from(audioContent, 'base64');
  return pcmToMp3(pcmBuffer);
}

// Edge TTS voice mapping per language
const EDGE_TTS_VOICES: Record<string, string> = {
  fr: 'fr-FR-DeniseNeural',
  en: 'en-US-JennyNeural',
  es: 'es-ES-ElviraNeural',
  de: 'de-DE-KatjaNeural',
  pt: 'pt-BR-FranciscaNeural',
  it: 'it-IT-ElsaNeural',
  ar: 'ar-SA-ZariyahNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  ru: 'ru-RU-SvetlanaNeural',
  hi: 'hi-IN-SwaraNeural',
};

let edgeTTSLang = 'fr'; // set by caller via setEdgeTTSLang

export function setEdgeTTSLang(lang: string) {
  edgeTTSLang = lang;
}

/**
 * Generate speech with Microsoft Edge TTS (free, no API key).
 * Returns MP3 buffer.
 */
async function generateWithEdgeTTS(text: string): Promise<Buffer> {
  const voice = EDGE_TTS_VOICES[edgeTTSLang] || EDGE_TTS_VOICES.fr;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(text);

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.from(chunk));
  }

  tts.close();

  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) {
    throw new Error('Edge TTS returned empty audio');
  }

  return buffer;
}

/**
 * Convert raw PCM audio (s16le, 24kHz, mono) to MP3 using ffmpeg.
 */
async function pcmToMp3(pcmBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const pcmPath = path.join(tmpDir, `tts_pcm_${Date.now()}.raw`);
  const mp3Path = path.join(tmpDir, `tts_mp3_${Date.now()}.mp3`);

  try {
    fs.writeFileSync(pcmPath, pcmBuffer);

    await execFileAsync('ffmpeg', [
      '-f', 's16le',
      '-ar', '24000',
      '-ac', '1',
      '-i', pcmPath,
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      '-y',
      mp3Path,
    ], { timeout: 30000 });

    return fs.readFileSync(mp3Path);
  } finally {
    try { fs.unlinkSync(pcmPath); } catch {}
    try { fs.unlinkSync(mp3Path); } catch {}
  }
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
