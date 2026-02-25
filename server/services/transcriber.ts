import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
 * Transcribe an audio file using Whisper API (Groq or OpenAI).
 * Automatically splits files >25MB into chunks.
 */
export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  const useGroq = !!process.env.GROQ_API_KEY;

  // OpenRouter ne supporte pas Whisper, on utilise Groq ou OpenAI
  if (!useGroq && !process.env.OPENAI_API_KEY) {
    throw new Error('GROQ_API_KEY ou OPENAI_API_KEY requis pour la transcription Whisper (OpenRouter ne supporte pas Whisper)');
  }

  console.log(`[Transcriber] Using ${useGroq ? 'Groq Whisper (whisper-large-v3-turbo)' : 'OpenAI Whisper (whisper-1)'}`);

  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / 1024 / 1024;

  if (sizeMB <= MAX_FILE_SIZE_MB) {
    // File is small enough, transcribe directly
    return useGroq ? transcribeWithGroq(audioPath) : transcribeWithOpenAI(audioPath);
  }

  // File is too large - split into chunks and transcribe each
  console.log(`[Transcriber] File too large (${sizeMB.toFixed(1)}MB). Splitting into chunks...`);
  return transcribeInChunks(audioPath, sizeMB, useGroq);
}

/**
 * Split a large audio file into chunks <25MB using ffmpeg, then transcribe each.
 */
async function transcribeInChunks(
  audioPath: string,
  sizeMB: number,
  useGroq: boolean
): Promise<TranscriptionResult> {
  // Calculate chunk duration: aim for ~20MB per chunk to stay safely under 25MB
  const audioDuration = await getAudioDuration(audioPath);
  const targetChunkSizeMB = 20;
  const numberOfChunks = Math.ceil(sizeMB / targetChunkSizeMB);
  const chunkDurationSecs = Math.floor(audioDuration / numberOfChunks);

  console.log(`[Transcriber] Audio: ${audioDuration.toFixed(0)}s, ${sizeMB.toFixed(1)}MB → ${numberOfChunks} chunks of ~${chunkDurationSecs}s`);

  const tmpDir = path.join(os.tmpdir(), 'harmony-voice', 'chunks');
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

    // Transcribe each chunk
    const allSegments: TranscriptSegment[] = [];
    const allTexts: string[] = [];
    let timeOffset = 0;

    for (let i = 0; i < chunkPaths.length; i++) {
      console.log(`[Transcriber] Transcribing chunk ${i + 1}/${chunkPaths.length}...`);

      const result = useGroq
        ? await transcribeWithGroq(chunkPaths[i])
        : await transcribeWithOpenAI(chunkPaths[i]);

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

async function transcribeWithGroq(audioPath: string): Promise<TranscriptionResult> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
  });

  const responseAny = response as any;
  const segments: TranscriptSegment[] = responseAny.segments?.map((seg: any) => ({
    text: (seg.text || '').trim(),
    offset: (seg.start || 0) * 1000,
    duration: ((seg.end || 0) - (seg.start || 0)) * 1000,
  })) || [];

  const text = responseAny.text || segments.map(s => s.text).join(' ');

  console.log(`[Transcriber] Groq Whisper: ${segments.length} segments, ${text.length} chars`);

  return { text, segments };
}

async function transcribeWithOpenAI(audioPath: string): Promise<TranscriptionResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
  });

  const responseAny = response as any;
  const segments: TranscriptSegment[] = responseAny.segments?.map((seg: any) => ({
    text: (seg.text || '').trim(),
    offset: (seg.start || 0) * 1000,
    duration: ((seg.end || 0) - (seg.start || 0)) * 1000,
  })) || [];

  const text = responseAny.text || segments.map(s => s.text).join(' ');

  console.log(`[Transcriber] OpenAI Whisper: ${segments.length} segments, ${text.length} chars`);

  return { text, segments };
}
