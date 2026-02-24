import { YoutubeTranscript } from 'youtube-transcript';

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ')
    .trim();
}

export async function fetchYouTubeTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      throw new Error('Aucun sous-titre disponible pour cette vidéo.');
    }

    return transcript.map(item => ({
      text: decodeHtmlEntities(item.text),
      offset: item.offset,
      duration: item.duration,
    }));
  } catch (error: any) {
    if (error.message?.includes('Aucun sous-titre')) {
      throw error;
    }
    throw new Error(
      `Impossible de récupérer la transcription. Vérifiez que la vidéo a des sous-titres disponibles. (${error.message})`
    );
  }
}
