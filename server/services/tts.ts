import OpenAI from 'openai';
import fs from 'fs';

const MAX_TTS_CHARS = 4096;

function splitForTTS(text: string): string[] {
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

export async function generateSpeech(
  text: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = splitForTTS(text);
  const audioBuffers: Buffer[] = [];

  console.log(`[TTS] Generating audio for ${chunks.length} chunks (${text.length} chars total)`);

  for (let i = 0; i < chunks.length; i++) {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: chunks[i],
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    audioBuffers.push(buffer);
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
  }

  // Concatenate MP3 buffers (MP3 frame concatenation works correctly)
  const finalBuffer = Buffer.concat(audioBuffers);
  fs.writeFileSync(outputPath, finalBuffer);

  console.log(`[TTS] Audio saved to ${outputPath} (${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
}
