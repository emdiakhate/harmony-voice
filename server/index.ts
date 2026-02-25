import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { downloadYouTubeAudio, downloadYouTubeVideo, mergeVideoAudio, extractVideoId, cleanupAudioFile } from './services/youtube.js';
import { transcribeAudio } from './services/transcriber.js';
import { translateText } from './services/translator.js';
import { splitForTTS, generateSpeechChunk } from './services/tts.js';
import { extractTextFromFile } from './services/document-parser.js';
import { generatePodcastScript } from './services/podcast-generator.js';
import { generatePodcastAudio } from './services/podcast-tts.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

// Multer for file uploads (50MB limit)
const upload = multer({
  dest: path.join(os.tmpdir(), 'harmony-voice-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

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

// Shared: streaming TTS pipeline (used by both YouTube and file processing)
async function streamingTTS(
  res: express.Response,
  translatedText: string,
  filePrefix: string,
  targetLanguage: string,
): Promise<string> {
  sendSSE(res, { step: 'tts', message: "Génération de l'audio traduit..." });

  const ttsChunks = splitForTTS(translatedText);
  const audioBuffers: Buffer[] = [];
  const timestamp = Date.now();

  console.log(`[TTS] Streaming: ${ttsChunks.length} chunks to generate`);

  for (let i = 0; i < ttsChunks.length; i++) {
    const buffer = await generateSpeechChunk(ttsChunks[i]);
    audioBuffers.push(buffer);

    const chunkFileName = `${filePrefix}_${targetLanguage}_${timestamp}_chunk${i}.mp3`;
    fs.writeFileSync(path.join(outputDir, chunkFileName), buffer);

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

  const finalFileName = `${filePrefix}_${targetLanguage}_${timestamp}.mp3`;
  const finalPath = path.join(outputDir, finalFileName);
  fs.writeFileSync(finalPath, Buffer.concat(audioBuffers));

  console.log(`[TTS] Final audio saved: ${finalFileName}`);
  return `/api/audio/${finalFileName}`;
}

// Shared: podcast pipeline (generate script → TTS)
async function podcastPipeline(
  res: express.Response,
  translatedText: string,
  filePrefix: string,
): Promise<string> {
  // Step A: Generate podcast script
  sendSSE(res, { step: 'podcast_script', message: 'Génération du script podcast...' });
  const podcastScript = await generatePodcastScript(translatedText);
  console.log(`[Podcast] Script generated: ${podcastScript.length} chars`);
  sendSSE(res, { step: 'podcast_script_done', data: { script: podcastScript } });

  // Step B: Generate podcast audio (Gemini > ElevenLabs > OpenAI)
  sendSSE(res, { step: 'podcast_tts', message: 'Génération audio podcast...' });
  let currentProvider = '';
  const { audioBuffer, provider } = await generatePodcastAudio(podcastScript, (progress, message, prov) => {
    if (prov) currentProvider = prov;
    sendSSE(res, { step: 'podcast_tts_progress', data: { progress, message, provider: currentProvider } });
  });

  console.log(`[Podcast] Audio generated with ${provider}: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);

  const timestamp = Date.now();
  const podcastFileName = `${filePrefix}_podcast_${timestamp}.mp3`;
  const podcastPath = path.join(outputDir, podcastFileName);
  fs.writeFileSync(podcastPath, audioBuffer);

  sendSSE(res, { step: 'podcast_tts_done', data: { provider } });

  return `/api/audio/${podcastFileName}`;
}

// ===== YouTube processing (SSE stream) =====
app.post('/api/process', async (req, res) => {
  const { url, targetLanguage = 'fr', podcastMode = false } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let audioPath: string | null = null;

  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      sendSSE(res, { step: 'error', message: 'URL YouTube invalide.' });
      return res.end();
    }

    if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
      sendSSE(res, { step: 'error', message: 'Aucune clé API configurée. Ajoutez GROQ_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY dans .env' });
      return res.end();
    }

    // Step 1: Download audio
    sendSSE(res, { step: 'download', message: 'Extraction audio de la vidéo YouTube...' });
    audioPath = await downloadYouTubeAudio(videoId);
    const fileSize = (fs.statSync(audioPath).size / 1024 / 1024).toFixed(1);
    sendSSE(res, { step: 'download_done', data: { fileSize: `${fileSize}MB` } });

    // Step 2: Transcribe
    sendSSE(res, { step: 'transcript', message: 'Transcription avec Whisper IA...' });
    const { text: fullTranscript, segments } = await transcribeAudio(audioPath);
    console.log(`[Process] Transcript: ${segments.length} segments, ${fullTranscript.length} chars`);
    sendSSE(res, { step: 'transcript_done', data: { transcript: fullTranscript, segmentCount: segments.length } });

    cleanupAudioFile(audioPath);
    audioPath = null;

    // Step 3: Translate
    sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });
    const translatedText = await translateText(fullTranscript, targetLanguage, (progress) => {
      sendSSE(res, { step: 'translating_progress', data: { progress } });
    });
    console.log(`[Process] Translation done: ${translatedText.length} chars`);
    sendSSE(res, { step: 'translation_done', data: { translatedText } });

    // Step 4: TTS (standard or podcast mode)
    let audioUrl: string;

    if (podcastMode) {
      audioUrl = await podcastPipeline(res, translatedText, videoId);
    } else {
      audioUrl = await streamingTTS(res, translatedText, videoId, targetLanguage);
    }

    sendSSE(res, {
      step: 'done',
      data: { audioUrl, translatedText, transcript: fullTranscript, videoId, podcastMode }
    });

  } catch (error: any) {
    console.error('[Process] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue' });
    if (audioPath) cleanupAudioFile(audioPath);
  }

  res.end();
});

// ===== File processing (PDF/DOCX/TXT → translate → TTS) =====
app.post('/api/process-file', upload.single('file'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const file = req.file;
  const targetLanguage = req.body?.targetLanguage || 'fr';
  const podcastMode = req.body?.podcastMode === 'true';

  if (!file) {
    sendSSE(res, { step: 'error', message: 'Aucun fichier reçu.' });
    return res.end();
  }

  if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    sendSSE(res, { step: 'error', message: 'Aucune clé API configurée. Ajoutez GROQ_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY dans .env' });
    cleanupAudioFile(file.path);
    return res.end();
  }

  try {
    // Step 1: Extract text from document
    sendSSE(res, { step: 'extract', message: 'Extraction du texte du document...' });

    const originalText = await extractTextFromFile(file.path, file.originalname);

    console.log(`[FileProcess] Extracted ${originalText.length} chars from ${file.originalname}`);
    sendSSE(res, {
      step: 'extract_done',
      data: { text: originalText, charCount: originalText.length }
    });

    // Cleanup uploaded file
    cleanupAudioFile(file.path);

    // Step 2: Translate
    sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });

    const translatedText = await translateText(originalText, targetLanguage, (progress) => {
      sendSSE(res, { step: 'translating_progress', data: { progress } });
    });

    console.log(`[FileProcess] Translation done: ${translatedText.length} chars`);
    sendSSE(res, { step: 'translation_done', data: { translatedText } });

    // Step 3: TTS (standard or podcast mode)
    const filePrefix = `doc_${Date.now()}`;
    let audioUrl: string;

    if (podcastMode) {
      audioUrl = await podcastPipeline(res, translatedText, filePrefix);
    } else {
      audioUrl = await streamingTTS(res, translatedText, filePrefix, targetLanguage);
    }

    sendSSE(res, {
      step: 'done',
      data: { audioUrl, translatedText, transcript: originalText, podcastMode }
    });

  } catch (error: any) {
    console.error('[FileProcess] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue' });
    if (file) cleanupAudioFile(file.path);
  }

  res.end();
});

// ===== Generate podcast from existing translated text =====
app.post('/api/generate-podcast', async (req, res) => {
  const { translatedText } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (!translatedText || translatedText.trim().length === 0) {
    sendSSE(res, { step: 'error', message: 'Texte traduit requis.' });
    return res.end();
  }

  try {
    const filePrefix = `podcast_${Date.now()}`;
    const audioUrl = await podcastPipeline(res, translatedText, filePrefix);

    sendSSE(res, {
      step: 'done',
      data: { audioUrl, translatedText, podcastMode: true }
    });
  } catch (error: any) {
    console.error('[GeneratePodcast] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue' });
  }

  res.end();
});

// ===== Merge video + translated audio =====
app.post('/api/merge-video', async (req, res) => {
  const { videoId, audioUrl } = req.body;

  if (!videoId || !audioUrl) {
    return res.status(400).json({ error: 'videoId et audioUrl requis' });
  }

  const audioFileName = path.basename(audioUrl);
  const audioPath = path.join(outputDir, audioFileName);

  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Fichier audio non trouvé' });
  }

  let videoPath: string | null = null;

  try {
    console.log(`[Merge] Downloading video for ${videoId}...`);
    videoPath = await downloadYouTubeVideo(videoId);

    const mergedFileName = `${videoId}_translated_${Date.now()}.mp4`;
    const mergedPath = path.join(videoOutputDir, mergedFileName);

    console.log(`[Merge] Merging video + translated audio...`);
    await mergeVideoAudio(videoPath, audioPath, mergedPath);

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
    google: !!process.env.GOOGLE_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`OpenAI API key: ${process.env.OPENAI_API_KEY ? 'configured' : 'not set'}`);
  console.log(`Groq API key: ${process.env.GROQ_API_KEY ? 'configured (Whisper + translation)' : 'not set'}`);
  console.log(`OpenRouter API key: ${process.env.OPENROUTER_API_KEY ? 'configured (LLM fallback)' : 'not set'}`);
  console.log(`ElevenLabs API key: ${process.env.ELEVENLABS_API_KEY ? 'configured (TTS fallback)' : 'not set'}`);
  console.log(`Google API key: ${process.env.GOOGLE_API_KEY ? 'configured (Gemini TTS podcast)' : 'not set'}`);
  console.log(`[Priority] Translation/LLM: Groq > OpenRouter > OpenAI`);
  console.log(`[Priority] TTS: OpenAI > ElevenLabs | Podcast TTS: Gemini > ElevenLabs > OpenAI`);
  console.log(`[Priority] Whisper: Groq > OpenAI`);
});
