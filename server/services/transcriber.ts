import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  resolveTranscribeConfig,
  runWithFallback,
  describeChain,
  type Attempt,
  type LlmConfigInput,
} from './llm/router.js';

const execAsync = promisify(exec);

const MAX_FILE_SIZE_MB = 25;

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
}

/**
 * Transcribe an audio file using Whisper (Groq ou OpenAI), en routant sur les clés
 * de l'utilisateur (puis repli .env) avec failover automatique.
 * Splits files >25MB into chunks.
 */
export async function transcribeAudio(
  audioPath: string,
  transcribeConfig?: LlmConfigInput | null,
): Promise<TranscriptionResult> {
  const attempts = resolveTranscribeConfig(transcribeConfig);
  if (attempts.length === 0) {
    throw new Error(
      'La transcription Whisper nécessite une clé Groq ou OpenAI (aucune clé fournie dans les Paramètres ni dans .env). OpenRouter et les tiers gratuits ne transcrivent pas l\'audio.',
    );
  }

  console.log(`[Transcriber] Chain: ${describeChain(attempts)}`);

  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / 1024 / 1024;

  if (sizeMB <= MAX_FILE_SIZE_MB) {
    return transcribeOnce(audioPath, attempts);
  }

  // File is too large - split into chunks and transcribe each
  console.log(`[Transcriber] File too large (${sizeMB.toFixed(1)}MB). Splitting into chunks...`);
  return transcribeInChunks(audioPath, sizeMB, attempts);
}

/**
 * Transcrit un fichier (≤25MB) en parcourant la chaîne de fournisseurs.
 */
function transcribeOnce(audioPath: string, attempts: Attempt[]): Promise<TranscriptionResult> {
  return runWithFallback<TranscriptionResult>({
    attempts,
    label: 'Transcribe',
    isEmpty: (r) => !r.text.trim() && r.segments.length === 0,
    run: (a) => callTranscribe(a, audioPath),
  });
}

/**
 * Appel transcription pour un essai donné. Groq et OpenAI exposent la même API
 * `audio.transcriptions.create` (verbose_json) ; on choisit le SDK selon le fournisseur.
 */
async function callTranscribe(attempt: Attempt, audioPath: string): Promise<TranscriptionResult> {
  let response: any;

  if (attempt.def.id === 'groq') {
    const groq = new Groq({ apiKey: attempt.apiKey });
    response = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: attempt.model,
      response_format: 'verbose_json',
    });
  } else {
    const openai = new OpenAI({ apiKey: attempt.apiKey });
    response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: attempt.model,
      response_format: 'verbose_json',
    });
  }

  const segments: TranscriptSegment[] = response.segments?.map((seg: any) => ({
    text: (seg.text || '').trim(),
    offset: (seg.start || 0) * 1000,
    duration: ((seg.end || 0) - (seg.start || 0)) * 1000,
  })) || [];

  const text = response.text || segments.map((s) => s.text).join(' ');

  console.log(`[Transcriber] ${attempt.def.label}: ${segments.length} segments, ${text.length} chars`);

  return { text, segments };
}

/**
 * Split a large audio file into chunks <25MB using ffmpeg, then transcribe each.
 */
async function transcribeInChunks(
  audioPath: string,
  sizeMB: number,
  attempts: Attempt[],
): Promise<TranscriptionResult> {
  // Calculate chunk duration: aim for ~20MB per chunk to stay safely under 25MB
  const audioDuration = await getAudioDuration(audioPath);
  const targetChunkSizeMB = 20;
  const numberOfChunks = Math.ceil(sizeMB / targetChunkSizeMB);
  const chunkDurationSecs = Math.floor(audioDuration / numberOfChunks);

  console.log(`[Transcriber] Audio: ${audioDuration.toFixed(0)}s, ${sizeMB.toFixed(1)}MB → ${numberOfChunks} chunks of ~${chunkDurationSecs}s`);

  const tmpDir = path.join(os.tmpdir(), 'vocaleez-ai', 'chunks');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const chunkPaths: string[] = [];

  try {
    // Split audio into chunks using ffmpeg
    for (let i = 0; i < numberOfChunks; i++) {
      const startTime = i * chunkDurationSecs;
      const chunkPath = path.join(tmpDir, `chunk_${Date.now()}_${i}.mp3`);

      await execAsync(
        `ffmpeg -i "${audioPath}" -ss ${startTime} -t ${chunkDurationSecs} -c:a libmp3lame -q:a 4 -y "${chunkPath}"`,
        { timeout: 60000 }
      );

      if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 0) {
        chunkPaths.push(chunkPath);
        const chunkSize = (fs.statSync(chunkPath).size / 1024 / 1024).toFixed(1);
        console.log(`[Transcriber] Chunk ${i + 1}/${numberOfChunks}: ${chunkSize}MB`);
      }
    }

    // Transcribe each chunk (le routeur gère le failover par chunk)
    const allSegments: TranscriptSegment[] = [];
    const allTexts: string[] = [];
    let timeOffset = 0;

    for (let i = 0; i < chunkPaths.length; i++) {
      console.log(`[Transcriber] Transcribing chunk ${i + 1}/${chunkPaths.length}...`);

      const result = await transcribeOnce(chunkPaths[i], attempts);

      allTexts.push(result.text);

      // Adjust segment timestamps with offset
      for (const seg of result.segments) {
        allSegments.push({
          text: seg.text,
          offset: seg.offset + timeOffset,
          duration: seg.duration,
        });
      }

      timeOffset += chunkDurationSecs * 1000; // offset in ms
    }

    const fullText = allTexts.join(' ');
    console.log(`[Transcriber] All chunks transcribed: ${allSegments.length} segments, ${fullText.length} chars`);

    return { text: fullText, segments: allSegments };
  } finally {
    // Cleanup chunk files
    for (const p of chunkPaths) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { }
    }
  }
}

/**
 * Get audio duration in seconds using ffprobe.
 */
async function getAudioDuration(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      { timeout: 10000 }
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) throw new Error('Invalid duration');
    return duration;
  } catch {
    // Fallback: estimate from file size (64kbps MP3 ≈ 8KB/s)
    const stats = fs.statSync(audioPath);
    return stats.size / 8000;
  }
}
