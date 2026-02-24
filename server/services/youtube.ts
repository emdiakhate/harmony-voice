import { getSubtitles } from 'youtube-captions-scraper';
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
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\n/g, ' ')
    .trim();
}

// Method 1: youtube-captions-scraper (more reliable)
async function fetchWithCaptionsScraper(videoId: string): Promise<TranscriptSegment[]> {
  // Try multiple language codes in order of preference
  const langCodes = ['en', 'fr', 'es', 'de', 'pt', 'it', 'auto'];

  for (const lang of langCodes) {
    try {
      const captions = await getSubtitles({ videoID: videoId, lang });
      if (captions && captions.length > 0) {
        return captions.map((item: any) => ({
          text: decodeHtmlEntities(item.text || ''),
          offset: parseFloat(item.start || '0') * 1000,
          duration: parseFloat(item.dur || '0') * 1000,
        }));
      }
    } catch {
      // Try next language
      continue;
    }
  }

  throw new Error('captions-scraper: no subtitles found');
}

// Method 2: youtube-transcript (fallback)
async function fetchWithYoutubeTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId);

  if (!transcript || transcript.length === 0) {
    throw new Error('youtube-transcript: empty result');
  }

  return transcript.map(item => ({
    text: decodeHtmlEntities(item.text),
    offset: item.offset,
    duration: item.duration,
  }));
}

export async function fetchYouTubeTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const errors: string[] = [];

  // Try method 1: youtube-captions-scraper
  try {
    const result = await fetchWithCaptionsScraper(videoId);
    console.log(`[YouTube] Transcript fetched via captions-scraper: ${result.length} segments`);
    return result;
  } catch (err: any) {
    errors.push(`captions-scraper: ${err.message}`);
    console.log(`[YouTube] captions-scraper failed: ${err.message}`);
  }

  // Try method 2: youtube-transcript
  try {
    const result = await fetchWithYoutubeTranscript(videoId);
    console.log(`[YouTube] Transcript fetched via youtube-transcript: ${result.length} segments`);
    return result;
  } catch (err: any) {
    errors.push(`youtube-transcript: ${err.message}`);
    console.log(`[YouTube] youtube-transcript failed: ${err.message}`);
  }

  throw new Error(
    `Aucun sous-titre disponible pour cette vidéo. Assurez-vous que la vidéo possède des sous-titres activés. Détails: ${errors.join(' | ')}`
  );
}
