import Groq from 'groq-sdk';
import OpenAI from 'openai';
import fs from 'fs';

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
 * Groq is preferred (faster and free for Whisper).
 */
export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  const useGroq = !!process.env.GROQ_API_KEY;

  console.log(`[Transcriber] Using ${useGroq ? 'Groq Whisper (whisper-large-v3-turbo)' : 'OpenAI Whisper (whisper-1)'}`);

  // Check file size (API limit: 25MB)
  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / 1024 / 1024;
  if (sizeMB > 25) {
    throw new Error(
      `Le fichier audio est trop volumineux (${sizeMB.toFixed(1)}MB). Limite: 25MB. Essayez avec une vidéo plus courte.`
    );
  }

  if (useGroq) {
    return transcribeWithGroq(audioPath);
  } else {
    return transcribeWithOpenAI(audioPath);
  }
}

async function transcribeWithGroq(audioPath: string): Promise<TranscriptionResult> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
  });

  // verbose_json response includes segments with timestamps
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
