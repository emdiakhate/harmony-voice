import OpenAI from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isPiperAvailable, hasVoiceForLang, generateLongTextWithPiper } from './piper-tts.js';

const execFileAsync = promisify(execFile);

const GEMINI_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_GEMINI_CHARS = 8000;

// Gemini multi-speaker voice config
const SPEAKER_VOICES = {
  'Speaker 1': { voiceName: 'Charon' },
  'Speaker 2': { voiceName: 'Kore' },
};

// ElevenLabs fallback voices
const ELEVENLABS_VOICES: Record<string, string> = {
  'Speaker 1': 'EXAVITQu4vr4xnSDxMaL', // Sarah - female voice
  'Speaker 2': 'LivlNOmp4OEi5jd1LlSU', // second voice
};

// OpenAI fallback voices
const OPENAI_VOICES: Record<string, 'onyx' | 'nova'> = {
  'Speaker 1': 'onyx',
  'Speaker 2': 'nova',
};

interface PodcastTTSResult {
  audioBuffer: Buffer;
  provider: 'gemini' | 'elevenlabs' | 'openai' | 'piper';
}

/**
 * Generate podcast audio from a multi-speaker script.
 * Priority: Gemini > ElevenLabs > OpenAI
 */
export async function generatePodcastAudio(
  script: string,
  onProgress?: (progress: number, message: string, provider?: string) => void,
): Promise<PodcastTTSResult> {
  // 1. Try Gemini multi-speaker TTS
  if (process.env.GOOGLE_API_KEY) {
    try {
      console.log('[PodcastTTS] Attempting Gemini multi-speaker TTS...');
      onProgress?.(0, 'Génération avec Gemini...', 'gemini');
      const audioBuffer = await generateWithGemini(script, process.env.GOOGLE_API_KEY, onProgress);
      console.log(`[PodcastTTS] Gemini success: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      return { audioBuffer, provider: 'gemini' };
    } catch (error: any) {
      logGeminiError(error);
      console.log('[PodcastTTS] Gemini failed, trying next provider...');
    }
  }

  // 2. Try ElevenLabs multi-voice TTS
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      console.log('[PodcastTTS] Attempting ElevenLabs multi-voice TTS...');
      onProgress?.(0, 'Génération avec ElevenLabs...', 'elevenlabs');
      const audioBuffer = await generateWithElevenLabs(script, onProgress);
      console.log(`[PodcastTTS] ElevenLabs success: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      return { audioBuffer, provider: 'elevenlabs' };
    } catch (error: any) {
      console.error('[PodcastTTS] ElevenLabs error:', error.message);
      console.log('[PodcastTTS] ElevenLabs failed, trying next provider...');
    }
  }

  // 3. Fallback: OpenAI TTS
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('[PodcastTTS] Using OpenAI TTS fallback...');
      onProgress?.(0, 'Génération avec OpenAI...', 'openai');
      const audioBuffer = await generateWithOpenAI(script, onProgress);
      console.log(`[PodcastTTS] OpenAI fallback success: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      return { audioBuffer, provider: 'openai' };
    } catch (error: any) {
      console.error('[PodcastTTS] OpenAI error:', error.message);
    }
  }

  // 4. Piper TTS — local, free, two voices for podcast
  if (isPiperAvailable() && hasVoiceForLang('fr')) {
    try {
      console.log('[PodcastTTS] Attempting Piper TTS (local)...');
      onProgress?.(0, 'Génération avec Piper (local)...', 'piper');
      const audioBuffer = await generatePodcastWithPiper(script, onProgress);
      console.log(`[PodcastTTS] Piper success: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      return { audioBuffer, provider: 'piper' };
    } catch (error: any) {
      console.error('[PodcastTTS] Piper error:', error.message);
    }
  }

  throw new Error('Aucun provider Podcast TTS disponible. Configurez GOOGLE_API_KEY, ELEVENLABS_API_KEY, OPENAI_API_KEY ou installez Piper.');
}

/**
 * Log detailed Gemini API errors for debugging.
 */
function logGeminiError(error: any) {
  console.error('[PodcastTTS] Gemini TTS error:');

  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;
    console.error(`  HTTP Status: ${status}`);

    if (status === 429) {
      console.error('  Cause: Rate limit exceeded (quota épuisée)');
      console.error('  Action: Attendre avant de réessayer ou augmenter le quota Google Cloud');
    } else if (status === 401 || status === 403) {
      console.error('  Cause: Authentication error (clé API invalide ou permissions insuffisantes)');
      console.error('  Action: Vérifier GOOGLE_API_KEY et activer l\'API Generative Language');
    } else if (status === 400) {
      console.error('  Cause: Bad request (paramètres invalides)');
    } else if (status === 500 || status === 503) {
      console.error('  Cause: Gemini server error (service temporairement indisponible)');
    }
  }

  if (error.message) {
    console.error(`  Message: ${error.message}`);
  }

  if (error.response?.data) {
    console.error('  Response data:', JSON.stringify(error.response.data, null, 2));
  }

  if (error.error) {
    console.error('  Error details:', JSON.stringify(error.error, null, 2));
  }
}

/**
 * Split podcast script into chunks at speaker boundaries, respecting max char limit.
 */
function chunkScript(script: string): string[] {
  if (script.length <= MAX_GEMINI_CHARS) return [script];

  const lines = script.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const isSpeakerLine = /^Speaker [12]:/.test(line);

    if (isSpeakerLine && (current + '\n' + line).length > MAX_GEMINI_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/**
 * Generate audio with Gemini 2.5 Flash TTS multi-speaker.
 */
async function generateWithGemini(
  script: string,
  apiKey: string,
  onProgress?: (progress: number, message: string) => void,
): Promise<Buffer> {
  const chunks = chunkScript(script);
  console.log(`[PodcastTTS] Gemini: ${chunks.length} chunk(s) to process`);

  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(
      Math.round((i / chunks.length) * 100),
      `Génération podcast (partie ${i + 1}/${chunks.length})...`,
    );

    const pcmBuffer = await callGeminiTTS(chunks[i], apiKey);
    const mp3Buffer = await pcmToMp3(pcmBuffer);
    audioBuffers.push(mp3Buffer);

    console.log(`[PodcastTTS] Gemini chunk ${i + 1}/${chunks.length}: ${(mp3Buffer.length / 1024).toFixed(0)}KB`);
  }

  onProgress?.(100, 'Podcast audio généré avec Gemini');
  return Buffer.concat(audioBuffers);
}

/**
 * Call Gemini TTS API for a single chunk with multi-speaker config.
 */
async function callGeminiTTS(text: string, apiKey: string): Promise<Buffer> {
  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text }],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'Speaker 1', voiceConfig: { prebuiltVoiceConfig: SPEAKER_VOICES['Speaker 1'] } },
            { speaker: 'Speaker 2', voiceConfig: { prebuiltVoiceConfig: SPEAKER_VOICES['Speaker 2'] } },
          ],
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
    const error: any = new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.response = { data: errorData };
    throw error;
  }

  const data = await response.json();

  // Extract base64 audio from response
  const audioContent = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioContent) {
    throw new Error('Gemini response missing audio data');
  }

  return Buffer.from(audioContent, 'base64');
}

/**
 * Convert raw PCM audio (s16le, 24kHz, mono) to MP3 using ffmpeg.
 */
async function pcmToMp3(pcmBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const pcmPath = path.join(tmpDir, `podcast_pcm_${Date.now()}.raw`);
  const mp3Path = path.join(tmpDir, `podcast_mp3_${Date.now()}.mp3`);

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

    const mp3Buffer = fs.readFileSync(mp3Path);
    return mp3Buffer;
  } finally {
    try { fs.unlinkSync(pcmPath); } catch {}
    try { fs.unlinkSync(mp3Path); } catch {}
  }
}

/**
 * Generate podcast audio with ElevenLabs using alternating voices.
 */
async function generateWithElevenLabs(
  script: string,
  onProgress?: (progress: number, message: string, provider?: string) => void,
): Promise<Buffer> {
  const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

  const segments = parseScriptSegments(script);
  console.log(`[PodcastTTS] ElevenLabs: ${segments.length} segments`);

  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    const { speaker, text } = segments[i];
    const voiceId = ELEVENLABS_VOICES[speaker] || ELEVENLABS_VOICES['Speaker 1'];

    onProgress?.(
      Math.round((i / segments.length) * 100),
      `ElevenLabs (${i + 1}/${segments.length})...`,
      'elevenlabs',
    );

    const subChunks = splitLongText(text, 4096);

    for (const chunk of subChunks) {
      const audio = await elevenlabs.textToSpeech.convert(voiceId, {
        text: chunk,
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
      });

      const parts: Uint8Array[] = [];
      for await (const part of audio) {
        parts.push(part);
      }
      audioBuffers.push(Buffer.concat(parts));
    }
  }

  onProgress?.(100, 'Podcast audio généré avec ElevenLabs', 'elevenlabs');
  return Buffer.concat(audioBuffers);
}

/**
 * Fallback: Generate podcast audio with OpenAI TTS using alternating voices.
 */
async function generateWithOpenAI(
  script: string,
  onProgress?: (progress: number, message: string) => void,
): Promise<Buffer> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Parse script into speaker segments
  const segments = parseScriptSegments(script);
  console.log(`[PodcastTTS] OpenAI fallback: ${segments.length} segments`);

  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    const { speaker, text } = segments[i];
    const voice = OPENAI_VOICES[speaker] || 'nova';

    onProgress?.(
      Math.round((i / segments.length) * 100),
      `Génération audio OpenAI (${i + 1}/${segments.length})...`,
    );

    // Split long segments further if needed (OpenAI TTS limit ~4096 chars)
    const subChunks = splitLongText(text, 4096);

    for (const chunk of subChunks) {
      const response = await openai.audio.speech.create({
        model: 'tts-1',
        voice,
        input: chunk,
        response_format: 'mp3',
      });

      audioBuffers.push(Buffer.from(await response.arrayBuffer()));
    }
  }

  onProgress?.(100, 'Podcast audio généré avec OpenAI');
  return Buffer.concat(audioBuffers);
}

/**
 * Parse podcast script into speaker/text segments.
 */
function parseScriptSegments(script: string): Array<{ speaker: string; text: string }> {
  const segments: Array<{ speaker: string; text: string }> = [];
  const lines = script.split('\n');
  let currentSpeaker = 'Speaker 1';
  let currentText = '';

  for (const line of lines) {
    const speakerMatch = line.match(/^(Speaker [12]):\s*(.*)/);

    if (speakerMatch) {
      // Save previous segment
      if (currentText.trim()) {
        segments.push({ speaker: currentSpeaker, text: currentText.trim() });
      }
      currentSpeaker = speakerMatch[1];
      currentText = speakerMatch[2] || '';
    } else {
      currentText += ' ' + line;
    }
  }

  // Push last segment
  if (currentText.trim()) {
    segments.push({ speaker: currentSpeaker, text: currentText.trim() });
  }

  return segments;
}

/**
 * Split text into chunks of max length at sentence boundaries.
 */
function splitLongText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/**
 * Generate podcast audio with Piper using two different voices.
 * Speaker 1 = primary voice, Speaker 2 = alt voice.
 */
async function generatePodcastWithPiper(
  script: string,
  onProgress?: (progress: number, message: string, provider?: string) => void,
): Promise<Buffer> {
  const segments = parseScriptSegments(script);
  console.log(`[PodcastTTS] Piper: ${segments.length} segments`);

  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    const { speaker, text } = segments[i];
    const isAlt = speaker === 'Speaker 2';

    onProgress?.(
      Math.round((i / segments.length) * 100),
      `Piper (${i + 1}/${segments.length})...`,
      'piper',
    );

    const buffer = await generateLongTextWithPiper(text, 'fr', isAlt);
    audioBuffers.push(buffer);
  }

  onProgress?.(100, 'Podcast audio généré avec Piper', 'piper');
  return Buffer.concat(audioBuffers);
}
