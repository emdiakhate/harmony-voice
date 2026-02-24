import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execFileAsync = promisify(execFile);

export function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
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

  try {
    await execFileAsync('yt-dlp', [
      '-x',                          // Extract audio only
      '--audio-format', 'mp3',       // Convert to mp3
      '--audio-quality', '64K',      // Low bitrate (sufficient for speech)
      '--no-playlist',               // Don't download playlists
      '--no-warnings',               // Suppress warnings
      '--postprocessor-args', '-ar 16000 -ac 1',  // 16kHz mono (optimal for Whisper)
      '-o', outputTemplate,
      url,
    ], { timeout: 120000 }); // 2 min timeout
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'yt-dlp non trouvé. Installez-le: pip install yt-dlp (ou winget install yt-dlp sur Windows)'
      );
    }
    throw new Error(`Erreur lors du téléchargement audio: ${err.message}`);
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
