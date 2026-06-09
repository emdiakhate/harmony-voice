import OpenAI from 'openai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isPiperAvailable, hasVoiceForLang, generateLongTextWithPiper } from './piper-tts.js';
import { resolveTtsConfig, runWithFallback, type Attempt, type LlmConfigInput } from './llm/router.js';

const execFileAsync = promisify(execFile);

const GEMINI_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_GEMINI_CHARS = 8000;

// Available voice presets for user selection
export const AVAILABLE_VOICES = {
  gemini: [
    { id: 'Charon', label: 'Charon (Homme grave)', gender: 'M' },
    { id: 'Kore', label: 'Kore (Femme douce)', gender: 'F' },
    { id: 'Fenrir', label: 'Fenrir (Homme dynamique)', gender: 'M' },
    { id: 'Aoede', label: 'Aoede (Femme vive)', gender: 'F' },
    { id: 'Puck', label: 'Puck (Homme léger)', gender: 'M' },
    { id: 'Leda', label: 'Leda (Femme chaleureuse)', gender: 'F' },
  ],
  openai: [
    { id: 'onyx', label: 'Onyx (Homme grave)', gender: 'M' },
    { id: 'nova', label: 'Nova (Femme douce)', gender: 'F' },
    { id: 'echo', label: 'Echo (Homme clair)', gender: 'M' },
    { id: 'shimmer', label: 'Shimmer (Femme vive)', gender: 'F' },
    { id: 'fable', label: 'Fable (Homme narrateur)', gender: 'M' },
    { id: 'alloy', label: 'Alloy (Neutre)', gender: 'N' },
  ],
  elevenlabs: [
    { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah (Femme)', gender: 'F' },
    { id: 'LivlNOmp4OEi5jd1LlSU', label: 'Daniel (Homme)', gender: 'M' },
    { id: 'jBpfuIE2acCO8z3wKNLl', label: 'Emily (Femme vive)', gender: 'F' },
    { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Marcus (Homme grave)', gender: 'M' },
  ],
};

// Default voice assignments per speaker (up to 4 speakers)
const DEFAULT_GEMINI_VOICES: Record<string, { voiceName: string }> = {
  'Speaker 1': { voiceName: 'Charon' },
  'Speaker 2': { voiceName: 'Kore' },
  'Speaker 3': { voiceName: 'Fenrir' },
  'Speaker 4': { voiceName: 'Aoede' },
};

const DEFAULT_ELEVENLABS_VOICES: Record<string, string> = {
  'Speaker 1': 'EXAVITQu4vr4xnSDxMaL',
  'Speaker 2': 'LivlNOmp4OEi5jd1LlSU',
  'Speaker 3': 'jBpfuIE2acCO8z3wKNLl',
  'Speaker 4': 'onwK4e9ZLuTAKqWW03F9',
};

const DEFAULT_OPENAI_VOICES: Record<string, string> = {
  'Speaker 1': 'onyx',
  'Speaker 2': 'nova',
  'Speaker 3': 'echo',
  'Speaker 4': 'shimmer',
};

export interface PodcastVoiceConfig {
  [speaker: string]: string; // speaker label -> voice id
}

// Jingle / transition configuration
const JINGLE_INTRO_TEXT = '♪ ♪ ♪';
const TRANSITION_SILENCE_MS = 800; // 0.8 second silence between segments

interface PodcastTTSResult {
  audioBuffer: Buffer;
  provider: 'gemini' | 'elevenlabs' | 'openai' | 'piper';
}

/**
 * Generate a short silence buffer (MP3) for transitions between segments.
 */
async function generateSilenceBuffer(durationMs: number): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const silencePath = path.join(tmpDir, `silence_${Date.now()}.mp3`);

  try {
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi',
      '-i', `anullsrc=r=24000:cl=mono`,
      '-t', (durationMs / 1000).toString(),
      '-codec:a', 'libmp3lame',
      '-qscale:a', '9',
      '-y',
      silencePath,
    ], { timeout: 10000 });

    const buffer = fs.readFileSync(silencePath);
    return buffer;
  } catch {
    // Fallback: return an empty buffer (no transition)
    return Buffer.alloc(0);
  } finally {
    try { fs.unlinkSync(silencePath); } catch {}
  }
}

/**
 * Generate a simple jingle tone (intro/outro) using ffmpeg.
 */
async function generateJingleBuffer(type: 'intro' | 'outro' | 'transition'): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const jinglePath = path.join(tmpDir, `jingle_${type}_${Date.now()}.mp3`);

  // Different tones for intro/outro/transition
  const configs: Record<string, { freqs: string; duration: string }> = {
    intro: {
      freqs: 'sine=frequency=523:duration=0.2,sine=frequency=659:duration=0.2,sine=frequency=784:duration=0.3',
      duration: '1.5',
    },
    outro: {
      freqs: 'sine=frequency=784:duration=0.2,sine=frequency=659:duration=0.2,sine=frequency=523:duration=0.4',
      duration: '1.5',
    },
    transition: {
      freqs: 'sine=frequency=440:duration=0.15,sine=frequency=554:duration=0.15',
      duration: '0.8',
    },
  };

  const config = configs[type];

  try {
    // Generate a simple ascending/descending tone sequence
    const filterParts = config.freqs.split(',');
    const inputs: string[] = [];
    const filterInputs: string[] = [];

    filterParts.forEach((part, i) => {
      inputs.push('-f', 'lavfi', '-i', part);
      filterInputs.push(`[${i}]`);
    });

    // Add a small silence padding
    inputs.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono:d=0.3`);
    filterInputs.push(`[${filterParts.length}]`);

    const filterComplex = `${filterInputs.join('')}concat=n=${filterInputs.length}:v=0:a=1,volume=0.3[out]`;

    await execFileAsync('ffmpeg', [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-codec:a', 'libmp3lame',
      '-qscale:a', '5',
      '-y',
      jinglePath,
    ], { timeout: 15000 });

    const buffer = fs.readFileSync(jinglePath);
    return buffer;
  } catch (error: any) {
    console.warn(`[Jingle] Failed to generate ${type} jingle:`, error.message);
    // Fallback: return silence
    return generateSilenceBuffer(type === 'transition' ? 500 : 1000);
  } finally {
    try { fs.unlinkSync(jinglePath); } catch {}
  }
}

/**
 * Generate podcast audio from a multi-speaker script.
 * Priority: Gemini > ElevenLabs > OpenAI
 */
export async function generatePodcastAudio(
  script: string,
  onProgress?: (progress: number, message: string, provider?: string) => void,
  voiceConfig?: PodcastVoiceConfig,
  ttsConfig?: LlmConfigInput | null,
): Promise<PodcastTTSResult> {
  // Generate jingles
  onProgress?.(0, 'Génération des jingles...', 'jingle');
  let introJingle: Buffer;
  let outroJingle: Buffer;
  let transitionJingle: Buffer;
  try {
    [introJingle, outroJingle, transitionJingle] = await Promise.all([
      generateJingleBuffer('intro'),
      generateJingleBuffer('outro'),
      generateJingleBuffer('transition'),
    ]);
    console.log(`[PodcastTTS] Jingles generated: intro=${introJingle.length}B, outro=${outroJingle.length}B, transition=${transitionJingle.length}B`);
  } catch {
    introJingle = Buffer.alloc(0);
    outroJingle = Buffer.alloc(0);
    transitionJingle = Buffer.alloc(0);
  }

  let coreAudio: Buffer | null = null;
  let provider: PodcastTTSResult['provider'] = 'openai';

  // 1. Fournisseurs à clé (clés user injectées depuis la DB > repli .env), routés via le ledger.
  // Pour le podcast, Gemini fait du multi-speaker natif → on le privilégie s'il est présent.
  const resolved = resolveTtsConfig(ttsConfig);
  const attempts = [
    ...resolved.filter((a) => a.def.id === 'gemini'),
    ...resolved.filter((a) => a.def.id !== 'gemini'),
  ];
  if (attempts.length > 0) {
    try {
      const result = await runWithFallback<{ buffer: Buffer; provider: PodcastTTSResult['provider'] }>({
        attempts,
        label: 'PodcastTTS',
        isEmpty: (r) => !r.buffer || r.buffer.length === 0,
        run: async (a) => {
          onProgress?.(5, `Génération avec ${a.def.label}...`, a.def.id);
          const buffer = await callKeyedPodcastTTS(a, script, onProgress, voiceConfig);
          return { buffer, provider: a.def.id as PodcastTTSResult['provider'] };
        },
      });
      coreAudio = result.buffer;
      provider = result.provider;
    } catch (err: any) {
      console.warn(`[PodcastTTS] Tous les fournisseurs à clé ont échoué (${err?.message || err}). Fallback Piper...`);
    }
  }

  // 2. Piper TTS — local, free
  if (!coreAudio && isPiperAvailable() && hasVoiceForLang('fr')) {
    try {
      console.log('[PodcastTTS] Attempting Piper TTS (local)...');
      onProgress?.(5, 'Génération avec Piper (local)...', 'piper');
      coreAudio = await generatePodcastWithPiper(script, onProgress);
      provider = 'piper';
      console.log(`[PodcastTTS] Piper success: ${(coreAudio.length / 1024 / 1024).toFixed(2)}MB`);
    } catch (error: any) {
      console.error('[PodcastTTS] Piper error:', error.message);
    }
  }

  if (!coreAudio) {
    throw new Error('Aucun provider Podcast TTS disponible. Ajoutez une clé (Gemini/ElevenLabs/OpenAI) dans les Paramètres ou installez Piper.');
  }

  // Assemble: intro jingle + core audio + outro jingle
  const finalParts: Buffer[] = [];
  if (introJingle.length > 0) finalParts.push(introJingle);
  finalParts.push(coreAudio);
  if (outroJingle.length > 0) finalParts.push(outroJingle);

  const audioBuffer = Buffer.concat(finalParts);
  return { audioBuffer, provider };
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
    const isSpeakerLine = /^Speaker \d+:/.test(line);

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
/** Dispatch d'un essai podcast TTS « à clé » vers le bon fournisseur multi-speaker. */
function callKeyedPodcastTTS(
  attempt: Attempt,
  script: string,
  onProgress?: (progress: number, message: string, provider?: string) => void,
  voiceConfig?: PodcastVoiceConfig,
): Promise<Buffer> {
  switch (attempt.def.id) {
    case 'gemini':
      return generateWithGemini(script, attempt.apiKey, onProgress, voiceConfig);
    case 'elevenlabs':
      return generateWithElevenLabs(script, attempt.apiKey, onProgress, voiceConfig);
    case 'openai':
      return generateWithOpenAI(script, attempt.apiKey, onProgress, voiceConfig);
    default:
      throw new Error(`Fournisseur Podcast TTS non supporté: ${attempt.def.id}`);
  }
}

async function generateWithGemini(
  script: string,
  apiKey: string,
  onProgress?: (progress: number, message: string) => void,
  voiceConfig?: PodcastVoiceConfig,
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
async function callGeminiTTS(text: string, apiKey: string, voiceConfig?: PodcastVoiceConfig): Promise<Buffer> {
  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  // Build speaker configs from voiceConfig or defaults
  const speakerNumbers = text.match(/Speaker \d+/g) || ['Speaker 1', 'Speaker 2'];
  const uniqueSpeakers = [...new Set(speakerNumbers)];

  const speakerVoiceConfigs = uniqueSpeakers.map(speaker => ({
    speaker,
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: voiceConfig?.[speaker] || DEFAULT_GEMINI_VOICES[speaker]?.voiceName || 'Charon',
      },
    },
  }));

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
          speakerVoiceConfigs,
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
  apiKey: string,
  onProgress?: (progress: number, message: string, provider?: string) => void,
  voiceConfig?: PodcastVoiceConfig,
): Promise<Buffer> {
  const elevenlabs = new ElevenLabsClient({ apiKey });

  const segments = parseScriptSegments(script);
  console.log(`[PodcastTTS] ElevenLabs: ${segments.length} segments`);

  const transitionSilence = await generateSilenceBuffer(TRANSITION_SILENCE_MS);
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    // Add transition silence between segments
    if (i > 0 && transitionSilence.length > 0) {
      audioBuffers.push(transitionSilence);
    }

    const { speaker, text } = segments[i];
    const voiceId = voiceConfig?.[speaker] || DEFAULT_ELEVENLABS_VOICES[speaker] || DEFAULT_ELEVENLABS_VOICES['Speaker 1'];

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
  apiKey: string,
  onProgress?: (progress: number, message: string) => void,
  voiceConfig?: PodcastVoiceConfig,
): Promise<Buffer> {
  const openai = new OpenAI({ apiKey });

  // Parse script into speaker segments
  const segments = parseScriptSegments(script);
  console.log(`[PodcastTTS] OpenAI fallback: ${segments.length} segments`);

  const transitionSilence = await generateSilenceBuffer(TRANSITION_SILENCE_MS);
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    // Add transition silence between segments
    if (i > 0 && transitionSilence.length > 0) {
      audioBuffers.push(transitionSilence);
    }

    const { speaker, text } = segments[i];
    const voice = (voiceConfig?.[speaker] || DEFAULT_OPENAI_VOICES[speaker] || 'nova') as any;

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
    const speakerMatch = line.match(/^(Speaker \d+):\s*(.*)/);

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
