import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Piper TTS — local, free, high-quality neural TTS.
 *
 * Directory structure:
 *   server/piper/
 *     piper.exe (Windows) or piper (Linux/Mac)
 *     voices/
 *       fr_FR-siwis-medium.onnx
 *       fr_FR-siwis-medium.onnx.json
 *       en_US-lessac-medium.onnx
 *       ...
 *
 * Setup: run `npm run setup:piper` or download manually from
 * https://github.com/rhasspy/piper/releases
 */

const __dirname = path.dirname(new URL(import.meta.url).pathname);
// Fix Windows path (remove leading / from /C:/...)
const piperDir = path.join(
  os.platform() === 'win32' ? __dirname.replace(/^\/([A-Z]:)/, '$1') : __dirname,
  '..', 'piper'
);
const voicesDir = path.join(piperDir, 'voices');

// Piper binary name depends on OS
const PIPER_BINARY = os.platform() === 'win32' ? 'piper.exe' : 'piper';
const piperBinaryPath = path.join(piperDir, PIPER_BINARY);

// Voice models per language (medium quality = best balance of speed/quality)
// Download from: https://huggingface.co/rhasspy/piper-voices/tree/main
const VOICE_MAP: Record<string, { model: string; speaker?: number }> = {
  fr: { model: 'fr_FR-siwis-medium' },
  en: { model: 'en_US-lessac-medium' },
  es: { model: 'es_ES-davefx-medium' },
  de: { model: 'de_DE-thorsten-medium' },
  it: { model: 'it_IT-riccardo-x_low' },
  pt: { model: 'pt_BR-faber-medium' },
  ru: { model: 'ru_RU-irina-medium' },
  zh: { model: 'zh_CN-huayan-medium' },
  ja: { model: 'ja_JP-takumi-medium' },
  ko: { model: 'ko_KR-kagayaki-medium' },
  ar: { model: 'ar_JO-kareem-medium' },
  hi: { model: 'hi_IN-hindi-medium' },
};

// Second voice per language (for podcast Speaker 2)
const VOICE_MAP_ALT: Record<string, { model: string; speaker?: number }> = {
  fr: { model: 'fr_FR-upmc-medium' },
  en: { model: 'en_US-amy-medium' },
  es: { model: 'es_ES-davefx-medium', speaker: 1 },
  de: { model: 'de_DE-thorsten-medium', speaker: 1 },
};

/**
 * Check if Piper is installed and ready to use.
 */
export function isPiperAvailable(): boolean {
  if (!fs.existsSync(piperBinaryPath)) {
    return false;
  }
  return true;
}

/**
 * Check if a voice model is available for a given language.
 */
export function hasVoiceForLang(lang: string): boolean {
  const voice = VOICE_MAP[lang];
  if (!voice) return false;
  const modelPath = path.join(voicesDir, `${voice.model}.onnx`);
  return fs.existsSync(modelPath);
}

/**
 * Get available languages that have downloaded voice models.
 */
export function getAvailableLanguages(): string[] {
  if (!fs.existsSync(voicesDir)) return [];
  return Object.entries(VOICE_MAP)
    .filter(([_, v]) => fs.existsSync(path.join(voicesDir, `${v.model}.onnx`)))
    .map(([lang]) => lang);
}

/**
 * Generate speech with Piper TTS.
 * Returns MP3 buffer.
 */
export async function generateWithPiper(
  text: string,
  lang: string = 'fr',
  altVoice: boolean = false,
): Promise<Buffer> {
  if (!isPiperAvailable()) {
    throw new Error('Piper TTS not installed. Run: npm run setup:piper');
  }

  const voiceMap = altVoice ? VOICE_MAP_ALT : VOICE_MAP;
  const voice = voiceMap[lang] || VOICE_MAP[lang];
  if (!voice) {
    throw new Error(`Piper: no voice model configured for language '${lang}'`);
  }

  const modelPath = path.join(voicesDir, `${voice.model}.onnx`);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Piper: voice model not found: ${voice.model}.onnx. Download it to ${voicesDir}`);
  }

  const tmpDir = os.tmpdir();
  const wavPath = path.join(tmpDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
  const mp3Path = wavPath.replace('.wav', '.mp3');

  try {
    // Piper reads from stdin and writes WAV to --output_file
    const args = [
      '--model', modelPath,
      '--output_file', wavPath,
    ];
    if (voice.speaker !== undefined) {
      args.push('--speaker', String(voice.speaker));
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(piperBinaryPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Piper exited with code ${code}: ${stderr}`));
      });
      proc.on('error', reject);

      proc.stdin.write(text);
      proc.stdin.end();
    });

    if (!fs.existsSync(wavPath)) {
      throw new Error('Piper produced no output');
    }

    // Convert WAV to MP3 with ffmpeg
    await execFileAsync('ffmpeg', [
      '-y', '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-ab', '192k',
      '-ar', '44100',
      mp3Path,
    ], { timeout: 60000 });

    const mp3Buffer = fs.readFileSync(mp3Path);
    console.log(`[Piper] Generated ${(mp3Buffer.length / 1024).toFixed(0)}KB audio (${lang}, ${voice.model})`);
    return mp3Buffer;
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(mp3Path); } catch {}
  }
}

/**
 * Generate speech for a long text by splitting into sentences and concatenating.
 * Piper handles long texts natively, but very long texts may need splitting.
 */
export async function generateLongTextWithPiper(
  text: string,
  lang: string = 'fr',
  altVoice: boolean = false,
): Promise<Buffer> {
  // Piper handles long text well natively (up to ~10k chars),
  // but split at ~5000 chars for safety
  const MAX_PIPER_CHARS = 5000;

  if (text.length <= MAX_PIPER_CHARS) {
    return generateWithPiper(text, lang, altVoice);
  }

  // Split at sentence boundaries
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > MAX_PIPER_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const audioBuffers: Buffer[] = [];
  for (const chunk of chunks) {
    const buffer = await generateWithPiper(chunk, lang, altVoice);
    audioBuffers.push(buffer);
  }

  return Buffer.concat(audioBuffers);
}

/**
 * Piper status info for debugging.
 */
export function getPiperStatus(): {
  installed: boolean;
  binaryPath: string;
  voicesDir: string;
  availableLanguages: string[];
} {
  return {
    installed: isPiperAvailable(),
    binaryPath: piperBinaryPath,
    voicesDir,
    availableLanguages: getAvailableLanguages(),
  };
}
