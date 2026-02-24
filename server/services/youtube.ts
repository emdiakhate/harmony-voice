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
 * Clean up a downloaded audio file.
 */
export function cleanupAudioFile(audioPath: string) {
  try {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  } catch {
    // Ignore cleanup errors
  }
}
