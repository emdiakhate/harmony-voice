import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { downloadYouTubeAudio, downloadYouTubeVideo, mergeVideoAudio, extractVideoId, cleanupAudioFile } from './services/youtube.js';
import { transcribeAudio } from './services/transcriber.js';
import { translateText } from './services/translator.js';
import { splitForTTS, generateSpeechChunk } from './services/tts.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

// Serve generated audio files
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
app.use('/api/audio', express.static(outputDir));

// Serve generated video files
const videoOutputDir = path.join(__dirname, 'output', 'videos');
if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });
app.use('/api/video', express.static(videoOutputDir));

// SSE helper
function sendSSE(res: express.Response, data: any) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Main processing endpoint (SSE stream with streaming TTS)
app.post('/api/process', async (req, res) => {
  const { url, targetLanguage = 'fr' } = req.body;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let audioPath: string | null = null;

  try {
    // Validate URL
    const videoId = extractVideoId(url);
    if (!videoId) {
      sendSSE(res, { step: 'error', message: 'URL YouTube invalide. Formats acceptés: youtube.com/watch?v=..., youtu.be/...' });
      return res.end();
    }

    // Validate API keys
    if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
      sendSSE(res, { step: 'error', message: 'Aucune clé API configurée. Ajoutez GROQ_API_KEY ou OPENAI_API_KEY dans le fichier .env' });
      return res.end();
    }

    // Step 1: Download audio from YouTube
    sendSSE(res, { step: 'download', message: 'Extraction audio de la vidéo YouTube...' });

    audioPath = await downloadYouTubeAudio(videoId);

    const fileSize = (fs.statSync(audioPath).size / 1024 / 1024).toFixed(1);
    sendSSE(res, { step: 'download_done', data: { fileSize: `${fileSize}MB` } });

    // Step 2: Transcribe with Whisper
    sendSSE(res, { step: 'transcript', message: 'Transcription avec Whisper IA...' });

    const { text: fullTranscript, segments } = await transcribeAudio(audioPath);

    console.log(`[Process] Transcript: ${segments.length} segments, ${fullTranscript.length} chars`);

    sendSSE(res, {
      step: 'transcript_done',
      data: { transcript: fullTranscript, segmentCount: segments.length }
    });

    // Clean up source audio file (no longer needed)
    cleanupAudioFile(audioPath);
    audioPath = null;

    // Step 3: Translate
    sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });

    const translatedText = await translateText(fullTranscript, targetLanguage, (progress) => {
      sendSSE(res, { step: 'translating_progress', data: { progress } });
    });

    console.log(`[Process] Translation done: ${translatedText.length} chars`);

    sendSSE(res, { step: 'translation_done', data: { translatedText } });

    // Step 4: Streaming TTS - send each chunk as it's generated
    sendSSE(res, { step: 'tts', message: "Génération de l'audio traduit..." });

    const ttsChunks = splitForTTS(translatedText);
    const audioBuffers: Buffer[] = [];
    const timestamp = Date.now();

    console.log(`[Process] TTS streaming: ${ttsChunks.length} chunks to generate`);

    for (let i = 0; i < ttsChunks.length; i++) {
      const buffer = await generateSpeechChunk(ttsChunks[i]);
      audioBuffers.push(buffer);

      // Save individual chunk for streaming playback
      const chunkFileName = `${videoId}_${targetLanguage}_${timestamp}_chunk${i}.mp3`;
      fs.writeFileSync(path.join(outputDir, chunkFileName), buffer);

      // Stream chunk URL to client immediately
      sendSSE(res, {
        step: 'audio_chunk',
        data: {
          index: i,
          total: ttsChunks.length,
          audioUrl: `/api/audio/${chunkFileName}`,
        }
      });

      sendSSE(res, {
        step: 'tts_progress',
        data: { progress: Math.round(((i + 1) / ttsChunks.length) * 100) }
      });
    }

    // Save final concatenated file
    const finalFileName = `${videoId}_${targetLanguage}_${timestamp}.mp3`;
    const finalPath = path.join(outputDir, finalFileName);
    fs.writeFileSync(finalPath, Buffer.concat(audioBuffers));

    console.log(`[Process] Final audio saved: ${finalFileName}`);

    // Done!
    sendSSE(res, {
      step: 'done',
      data: {
        audioUrl: `/api/audio/${finalFileName}`,
        translatedText,
        transcript: fullTranscript,
        videoId,
      }
    });

  } catch (error: any) {
    console.error('[Process] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue lors du traitement' });

    // Clean up on error
    if (audioPath) cleanupAudioFile(audioPath);
  }

  res.end();
});

// Merge translated audio into video for download
app.post('/api/merge-video', async (req, res) => {
  const { videoId, audioUrl } = req.body;

  if (!videoId || !audioUrl) {
    return res.status(400).json({ error: 'videoId et audioUrl requis' });
  }

  // Resolve the audio file path from the URL
  const audioFileName = path.basename(audioUrl);
  const audioPath = path.join(outputDir, audioFileName);

  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Fichier audio non trouvé' });
  }

  let videoPath: string | null = null;

  try {
    console.log(`[Merge] Downloading video for ${videoId}...`);

    // Download original video
    videoPath = await downloadYouTubeVideo(videoId);

    // Merge video + translated audio
    const mergedFileName = `${videoId}_translated_${Date.now()}.mp4`;
    const mergedPath = path.join(videoOutputDir, mergedFileName);

    console.log(`[Merge] Merging video + translated audio...`);
    await mergeVideoAudio(videoPath, audioPath, mergedPath);

    // Clean up temp video
    cleanupAudioFile(videoPath);

    const stats = fs.statSync(mergedPath);
    console.log(`[Merge] Done: ${mergedFileName} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    res.json({
      videoUrl: `/api/video/${mergedFileName}`,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
    });
  } catch (error: any) {
    console.error('[Merge] Error:', error.message);
    if (videoPath) cleanupAudioFile(videoPath);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    openai: !!process.env.OPENAI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`OpenAI API key: ${process.env.OPENAI_API_KEY ? 'configured' : 'MISSING'}`);
  console.log(`Groq API key: ${process.env.GROQ_API_KEY ? 'configured (Whisper + translation)' : 'not set (using OpenAI for Whisper + translation)'}`);
});
