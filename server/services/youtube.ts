import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Detect how to invoke yt-dlp on this system.
 * Tries: 'yt-dlp' (PATH), then 'python -m yt_dlp' as fallback.
 */
async function findYtDlp(): Promise<{ command: string; useShell: boolean }> {
  // Try direct yt-dlp command
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
    return { command: 'yt-dlp', useShell: false };
  } catch {
    // Not in PATH
  }

  // Try python -m yt_dlp (works even if Scripts/ is not in PATH)
  try {
    await execAsync('python -m yt_dlp --version', { timeout: 5000 });
    return { command: 'python -m yt_dlp', useShell: true };
  } catch {
    // Not available via python either
  }

  // Try python3 -m yt_dlp (Linux/macOS)
  try {
    await execAsync('python3 -m yt_dlp --version', { timeout: 5000 });
    return { command: 'python3 -m yt_dlp', useShell: true };
  } catch {
    // Not available
  }

  throw new Error(
    'yt-dlp non trouvé. Installez-le avec: pip install yt-dlp\n' +
    'Puis ajoutez le dossier Scripts au PATH, ou redémarrez votre terminal.'
  );
}

/**
 * Download audio from a YouTube video using yt-dlp.
 * Returns the path to the downloaded MP3 file.
 */
export async function downloadYouTubeAudio(videoId: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), 'harmony-voice');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const outputTemplate = path.join(tmpDir, `${videoId}.%(ext)s`);
  const expectedOutput = path.join(tmpDir, `${videoId}.mp3`);

  // Clean up previous download if exists
  if (fs.existsSync(expectedOutput)) fs.unlinkSync(expectedOutput);

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const { command, useShell } = await findYtDlp();

  console.log(`[YouTube] Using: ${command}`);

  const args = [
    '-x',                          // Extract audio only
    '--audio-format', 'mp3',       // Convert to mp3
    '--audio-quality', '64K',      // Low bitrate (sufficient for speech)
    '--no-playlist',               // Don't download playlists
    '--no-warnings',               // Suppress warnings
    '--postprocessor-args', '-ar 16000 -ac 1',  // 16kHz mono (optimal for Whisper)
    '-o', outputTemplate,
    url,
  ];

  try {
    if (useShell) {
      // For "python -m yt_dlp" we need shell execution
      const escapedArgs = args.map(a => `"${a}"`).join(' ');
      await execAsync(`${command} ${escapedArgs}`, { timeout: 120000 });
    } else {
      await execFileAsync(command, args, { timeout: 120000 });
    }
  } catch (err: any) {
    throw new Error(`Erreur lors du téléchargement audio: ${err.stderr || err.message}`);
  }

  // Verify file exists
  if (!fs.existsSync(expectedOutput)) {
    throw new Error("Échec de l'extraction audio. Vérifiez que ffmpeg est installé.");
  }

  const stats = fs.statSync(expectedOutput);
  console.log(`[YouTube] Audio downloaded: ${(stats.size / 1024 / 1024).toFixed(1)}MB → ${expectedOutput}`);

  return expectedOutput;
}

/**
 * Download the full video (with original audio) from YouTube.
 * Returns the path to the downloaded video file.
 */
export async function downloadYouTubeVideo(videoId: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), 'harmony-voice');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const outputTemplate = path.join(tmpDir, `${videoId}_video.%(ext)s`);
  const expectedOutput = path.join(tmpDir, `${videoId}_video.mp4`);

  if (fs.existsSync(expectedOutput)) fs.unlinkSync(expectedOutput);

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const { command, useShell } = await findYtDlp();

  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
    '-o', outputTemplate,
    url,
  ];

  try {
    if (useShell) {
      const escapedArgs = args.map(a => `"${a}"`).join(' ');
      await execAsync(`${command} ${escapedArgs}`, { timeout: 300000 });
    } else {
      await execFileAsync(command, args, { timeout: 300000 });
    }
  } catch (err: any) {
    throw new Error(`Erreur téléchargement vidéo: ${err.stderr || err.message}`);
  }

  if (!fs.existsSync(expectedOutput)) {
    throw new Error("Échec du téléchargement vidéo.");
  }

  const stats = fs.statSync(expectedOutput);
  console.log(`[YouTube] Video downloaded: ${(stats.size / 1024 / 1024).toFixed(1)}MB → ${expectedOutput}`);

  return expectedOutput;
}

/**
 * Language code mapping for ffmpeg metadata.
 */
const langToISO: Record<string, string> = {
  fr: 'fre', en: 'eng', es: 'spa', de: 'ger', it: 'ita', pt: 'por',
  ar: 'ara', zh: 'chi', ja: 'jpn', ko: 'kor', ru: 'rus', hi: 'hin',
  tr: 'tur', nl: 'dut', pl: 'pol', sv: 'swe', da: 'dan', no: 'nor',
};

/**
 * Get media duration in seconds using ffprobe.
 */
async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 10000 }
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) throw new Error('Invalid duration');
    return duration;
  } catch {
    return 0;
  }
}

/**
 * Build atempo filter chain for ffmpeg.
 * atempo only accepts values between 0.5 and 100.0,
 * so we chain multiple filters for extreme ratios.
 */
function buildAtempoFilter(ratio: number): string {
  const filters: string[] = [];
  let remaining = ratio;
  while (remaining > 100.0) {
    filters.push('atempo=100.0');
    remaining /= 100.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(',');
}

/**
 * Merge a video file with a translated audio track using ffmpeg.
 * Includes both original and translated audio tracks with language metadata,
 * so users can switch audio tracks in their video player (VLC, etc.).
 * Automatically adjusts translated audio speed to match video duration.
 */
export async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  targetLanguage?: string,
): Promise<void> {
  const targetISO = langToISO[targetLanguage || ''] || 'und';

  // Get durations to calculate speed adjustment
  const [videoDuration, audioDuration] = await Promise.all([
    getMediaDuration(videoPath),
    getMediaDuration(audioPath),
  ]);

  console.log(`[Merge] Video duration: ${videoDuration.toFixed(1)}s, Audio duration: ${audioDuration.toFixed(1)}s`);

  // Calculate speed ratio: if audio is longer than video, speed it up
  // Only adjust if both durations are valid and difference is > 5%
  let atempoFilter = '';
  if (videoDuration > 0 && audioDuration > 0) {
    const ratio = audioDuration / videoDuration;
    if (ratio > 1.05 || ratio < 0.95) {
      // Clamp ratio to reasonable bounds (0.5x to 2.5x speed)
      const clampedRatio = Math.min(2.5, Math.max(0.5, ratio));
      atempoFilter = buildAtempoFilter(clampedRatio);
      console.log(`[Merge] Adjusting audio speed: ${clampedRatio.toFixed(2)}x (atempo=${atempoFilter})`);
    }
  }

  // Build ffmpeg command
  // If we need atempo, we must pre-process the translated audio through a filter
  // and use filter_complex to handle it properly
  try {
    if (atempoFilter) {
      // Use filter_complex to adjust translated audio speed before merging
      await execAsync(
        `ffmpeg -i "${videoPath}" -i "${audioPath}" ` +
        `-filter_complex "[1:a]${atempoFilter}[adjusted]" ` +
        `-c:v copy -c:a aac -b:a 192k ` +
        `-map 0:v:0 -map 0:a:0? -map "[adjusted]" ` +
        `-disposition:a:0 none -disposition:a:1 default ` +
        `-metadata:s:a:0 language=eng -metadata:s:a:0 title="Audio original" ` +
        `-metadata:s:a:1 language=${targetISO} -metadata:s:a:1 title="Audio traduit" ` +
        `-shortest -y "${outputPath}"`,
        { timeout: 300000 }
      );
    } else {
      // No speed adjustment needed
      await execAsync(
        `ffmpeg -i "${videoPath}" -i "${audioPath}" ` +
        `-c:v copy -c:a aac -b:a 192k ` +
        `-map 0:v:0 -map 0:a:0? -map 1:a:0 ` +
        `-disposition:a:0 none -disposition:a:1 default ` +
        `-metadata:s:a:0 language=eng -metadata:s:a:0 title="Audio original" ` +
        `-metadata:s:a:1 language=${targetISO} -metadata:s:a:1 title="Audio traduit" ` +
        `-shortest -y "${outputPath}"`,
        { timeout: 300000 }
      );
    }
  } catch (err: any) {
    throw new Error(`Erreur fusion vidéo/audio: ${err.stderr || err.message}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("Échec de la fusion vidéo/audio.");
  }

  console.log(`[Merge] Video merged with dual audio tracks: ${outputPath}`);
}

/**
 * Clean up a temporary file.
 */
export function cleanupAudioFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }
}
