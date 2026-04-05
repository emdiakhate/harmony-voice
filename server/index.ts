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
import { translateText, PartialTranslationError, detectLanguage } from './services/translator.js';
import { splitForTTS, generateSpeechChunk, setEdgeTTSLang } from './services/tts.js';
import { getPiperStatus } from './services/piper-tts.js';
import { extractTextFromFile } from './services/document-parser.js';
import { generatePodcastScript } from './services/podcast-generator.js';
import { generatePodcastAudio, AVAILABLE_VOICES } from './services/podcast-tts.js';
import { createAuthMiddleware, requireAuth, requireQuota, requirePodcastAccess } from './lib/auth.js';
import { recordUsage, getMonthlyUsage, checkQuota, PLAN_LIMITS } from './lib/quota.js';
import { prisma } from './lib/prisma.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

// Clerk auth middleware (noop if CLERK_SECRET_KEY not set)
app.use(createAuthMiddleware());

// Multer for file uploads (200MB limit for video/audio)
const upload = multer({
  dest: path.join(os.tmpdir(), 'vocaleez-ai-uploads'),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Serve generated audio files
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
app.use('/api/audio', express.static(outputDir));

// Serve generated video files
const videoOutputDir = path.join(__dirname, 'output', 'videos');
if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });
app.use('/api/video', express.static(videoOutputDir));

// Serve uploaded media files (for local video preview)
const uploadsDir = path.join(__dirname, 'output', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/api/uploads', express.static(uploadsDir));

// File type detection
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mp3', '.wav', '.webm', '.ogg', '.m4a', '.flac', '.aac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt']);

function getFileCategory(filename: string): 'media' | 'document' {
  const ext = path.extname(filename).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return 'media';
  return 'document';
}

function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

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
  setEdgeTTSLang(targetLanguage);

  const ttsChunks = splitForTTS(translatedText);
  const audioBuffers: Buffer[] = [];
  const timestamp = Date.now();

  console.log(`[TTS] Streaming: ${ttsChunks.length} chunks to generate`);

  let ttsError: Error | null = null;

  for (let i = 0; i < ttsChunks.length; i++) {
    try {
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
    } catch (err: any) {
      console.error(`[TTS] Error generating chunk ${i}/${ttsChunks.length}: ${err.message}`);
      ttsError = err;
      break;
    }
  }

  const finalFileName = `${filePrefix}_${targetLanguage}_${timestamp}.mp3`;
  const finalPath = path.join(outputDir, finalFileName);
  const audioUrl = `/api/audio/${finalFileName}`;

  if (audioBuffers.length > 0) {
    fs.writeFileSync(finalPath, Buffer.concat(audioBuffers));
    console.log(`[TTS] ${ttsError ? 'Partial' : 'Final'} audio saved: ${finalFileName} (${audioBuffers.length}/${ttsChunks.length} chunks)`);
  }

  if (ttsError) {
    sendSSE(res, {
      step: 'tts_partial_error',
      data: {
        message: `Génération audio interrompue après ${audioBuffers.length}/${ttsChunks.length} chunk(s): ${ttsError.message}`,
        audioUrl: audioBuffers.length > 0 ? audioUrl : null,
        generatedChunks: audioBuffers.length,
        totalChunks: ttsChunks.length,
      }
    });
  }

  return audioBuffers.length > 0 ? audioUrl : '';
}

// Shared: pipelined translate → TTS (translation and audio generation run in parallel)
// As each translation chunk completes, it's immediately queued for TTS generation.
async function pipelinedTranslateAndTTS(
  res: express.Response,
  sourceText: string,
  filePrefix: string,
  targetLanguage: string,
): Promise<{ translatedText: string; audioUrl: string }> {
  const timestamp = Date.now();
  const audioBuffers: Buffer[] = [];
  let nextTtsIndex = 0;
  const translatedChunkMap = new Map<number, string>();
  let translationComplete = false;
  let translationError: Error | null = null;
  let totalTranslationChunks = 0;
  let ttsChunkFileCount = 0;

  // TTS queue processor: generates audio for translated chunks in order
  let ttsResolve: (() => void) | null = null;
  let ttsRunning = false;

  let ttsError: Error | null = null;

  async function processTTSQueue() {
    if (ttsRunning) return;
    ttsRunning = true;

    while (true) {
      const chunkText = translatedChunkMap.get(nextTtsIndex);
      if (chunkText !== undefined) {
        // Split this translation chunk into TTS-sized pieces
        const ttsChunks = splitForTTS(chunkText);
        try {
          for (const ttsText of ttsChunks) {
            const buffer = await generateSpeechChunk(ttsText);
            audioBuffers.push(buffer);

            const chunkFileName = `${filePrefix}_${targetLanguage}_${timestamp}_chunk${ttsChunkFileCount}.mp3`;
            fs.writeFileSync(path.join(outputDir, chunkFileName), buffer);

            sendSSE(res, {
              step: 'audio_chunk',
              data: {
                index: ttsChunkFileCount,
                total: -1, // unknown total until translation finishes
                audioUrl: `/api/audio/${chunkFileName}`,
              }
            });
            ttsChunkFileCount++;
          }
        } catch (err: any) {
          console.error(`[TTS] Error generating chunk ${nextTtsIndex}: ${err.message}`);
          ttsError = err;
          break;
        }

        translatedChunkMap.delete(nextTtsIndex);
        nextTtsIndex++;

        // Update TTS progress based on how many translation chunks we've processed
        if (totalTranslationChunks > 0) {
          sendSSE(res, {
            step: 'tts_progress',
            data: { progress: Math.round((nextTtsIndex / totalTranslationChunks) * 100) }
          });
        }
      } else if (translationComplete || translationError) {
        break;
      } else {
        // Wait for new chunks
        await new Promise<void>((resolve) => {
          ttsResolve = resolve;
        });
        ttsResolve = null;
      }
    }

    ttsRunning = false;
  }

  // Start translation with chunk callback
  sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });
  sendSSE(res, { step: 'tts', message: "Génération audio en parallèle..." });
  setEdgeTTSLang(targetLanguage);

  let translatedText: string;

  const ttsPromise = processTTSQueue();

  try {
    translatedText = await translateText(sourceText, targetLanguage, (progress) => {
      sendSSE(res, { step: 'translating_progress', data: { progress } });
    }, {
      onProviderSwitch: (from, to) => {
        console.log(`[Pipeline] Provider switch: ${from} → ${to}`);
        sendSSE(res, { step: 'translating_provider_switch', data: { from, to } });
      },
      onChunkTranslated: (index, text, total) => {
        totalTranslationChunks = total;
        translatedChunkMap.set(index, text);
        // Wake up TTS queue
        if (ttsResolve) ttsResolve();
      },
    });
    translationComplete = true;
    if (ttsResolve) ttsResolve();
  } catch (error: any) {
    if (error instanceof PartialTranslationError && error.partialText) {
      translatedText = error.partialText;
      console.log(`[Pipeline] Partial translation: ${error.completedChunks}/${error.totalChunks} chunks`);
      sendSSE(res, {
        step: 'translating_partial',
        data: {
          translatedText: error.partialText,
          completedChunks: error.completedChunks,
          totalChunks: error.totalChunks,
          message: error.message,
        }
      });
      translationComplete = true;
      if (ttsResolve) ttsResolve();
    } else {
      translationError = error;
      if (ttsResolve) ttsResolve();
      await ttsPromise;
      throw error;
    }
  }

  console.log(`[Pipeline] Translation done: ${translatedText.length} chars`);
  sendSSE(res, { step: 'translation_done', data: { translatedText } });

  // Wait for remaining TTS to finish
  await ttsPromise;

  // Save whatever audio we have (full or partial)
  const finalFileName = `${filePrefix}_${targetLanguage}_${timestamp}.mp3`;
  const finalPath = path.join(outputDir, finalFileName);
  const audioUrl = `/api/audio/${finalFileName}`;

  if (audioBuffers.length > 0) {
    fs.writeFileSync(finalPath, Buffer.concat(audioBuffers));
    console.log(`[Pipeline] TTS ${ttsError ? 'partial' : 'done'}: ${ttsChunkFileCount} audio chunks generated`);
  }

  if (ttsError) {
    // We have partial audio — notify the client but don't throw
    sendSSE(res, {
      step: 'tts_partial_error',
      data: {
        message: `Génération audio interrompue après ${ttsChunkFileCount} chunk(s): ${ttsError.message}`,
        audioUrl: audioBuffers.length > 0 ? audioUrl : null,
        generatedChunks: ttsChunkFileCount,
      }
    });
  }

  return { translatedText, audioUrl: audioBuffers.length > 0 ? audioUrl : '' };
}

// Shared: podcast pipeline (generate script → TTS)
async function podcastPipeline(
  res: express.Response,
  translatedText: string,
  filePrefix: string,
  podcastOptions?: { tone?: string; speakerCount?: number; voiceConfig?: Record<string, string> },
): Promise<string> {
  // Step A: Generate podcast script
  sendSSE(res, { step: 'podcast_script', message: 'Génération du script podcast...' });
  const podcastScript = await generatePodcastScript(translatedText, {
    tone: (podcastOptions?.tone as any) || 'casual',
    speakerCount: (podcastOptions?.speakerCount as any) || 2,
  });
  console.log(`[Podcast] Script generated: ${podcastScript.length} chars`);
  sendSSE(res, { step: 'podcast_script_done', data: { script: podcastScript } });

  // Step B: Generate podcast audio (Gemini > ElevenLabs > OpenAI) with jingles
  sendSSE(res, { step: 'podcast_tts', message: 'Génération audio podcast (avec jingles)...' });
  let currentProvider = '';
  const { audioBuffer, provider } = await generatePodcastAudio(podcastScript, (progress, message, prov) => {
    if (prov) currentProvider = prov;
    sendSSE(res, { step: 'podcast_tts_progress', data: { progress, message, provider: currentProvider } });
  }, podcastOptions?.voiceConfig);

  console.log(`[Podcast] Audio generated with ${provider}: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);

  const timestamp = Date.now();
  const podcastFileName = `${filePrefix}_podcast_${timestamp}.mp3`;
  const podcastPath = path.join(outputDir, podcastFileName);
  fs.writeFileSync(podcastPath, audioBuffer);

  sendSSE(res, { step: 'podcast_tts_done', data: { provider } });

  return `/api/audio/${podcastFileName}`;
}

// ===== User info & quota =====
app.get('/api/user/me', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const quota = await checkQuota(user.id, user.plan);
  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;

  res.json({
    id: user.id,
    email: user.email,
    plan: user.plan,
    podcastEnabled: limits.podcastEnabled,
    quota: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
    },
  });
});

app.get('/api/user/usage', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const usages = await prisma.usage.findMany({
    where: { userId: user.id, createdAt: { gte: startOfMonth } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const summary = await prisma.usage.groupBy({
    by: ['type'],
    where: { userId: user.id, createdAt: { gte: startOfMonth } },
    _sum: { creditsUsed: true },
    _count: true,
  });

  res.json({ usages, summary });
});

// ===== YouTube processing (SSE stream) =====
app.post('/api/process', requireAuth, requireQuota, async (req, res) => {
  const user = (req as any).dbUser;
  const { url, targetLanguage = 'fr', podcastMode = false, podcastTone, podcastSpeakerCount, podcastVoiceConfig } = req.body;
  const podcastOpts = podcastMode ? { tone: podcastTone, speakerCount: podcastSpeakerCount, voiceConfig: podcastVoiceConfig } : undefined;

  // Check podcast access
  if (podcastMode) {
    const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
    if (!limits.podcastEnabled) {
      return res.status(403).json({
        error: 'Mode podcast réservé aux plans Pro et Business.',
      });
    }
  }

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
    const speechStartOffset = segments.length > 0 ? segments[0].offset / 1000 : 0; // seconds
    console.log(`[Process] Transcript: ${segments.length} segments, ${fullTranscript.length} chars, speech starts at ${speechStartOffset.toFixed(2)}s`);
    sendSSE(res, { step: 'transcript_done', data: { transcript: fullTranscript, segmentCount: segments.length } });

    cleanupAudioFile(audioPath);
    audioPath = null;

    // Step 3+4: Translate and generate audio
    let translatedText: string;
    let audioUrl: string;

    // Auto-detect language
    sendSSE(res, { step: 'detecting_language', message: 'Détection de la langue...' });
    const detectedLang = await detectLanguage(fullTranscript);
    sendSSE(res, { step: 'language_detected', data: { detectedLang } });
    const skipTranslation = detectedLang === targetLanguage;
    if (skipTranslation) {
      console.log(`[Process] Transcript already in ${targetLanguage}, skipping translation`);
      sendSSE(res, { step: 'translation_skipped', data: { detectedLang, targetLanguage, message: `Le texte est déjà en ${targetLanguage}, traduction ignorée.` } });
    }

    if (skipTranslation) {
      // Already in target language — direct TTS
      translatedText = fullTranscript;
      sendSSE(res, { step: 'translation_done', data: { translatedText, skipped: true } });
      if (podcastMode) {
        audioUrl = await podcastPipeline(res, translatedText, videoId, podcastOpts);
      } else {
        audioUrl = await streamingTTS(res, translatedText, videoId, targetLanguage);
      }
    } else if (podcastMode) {
      // Podcast mode: translate first, then generate script + audio
      sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });

      try {
        translatedText = await translateText(fullTranscript, targetLanguage, (progress) => {
          sendSSE(res, { step: 'translating_progress', data: { progress } });
        }, {
          onProviderSwitch: (from, to) => {
            console.log(`[Process] Provider switch: ${from} → ${to}`);
            sendSSE(res, { step: 'translating_provider_switch', data: { from, to } });
          },
        });
      } catch (error: any) {
        if (error instanceof PartialTranslationError && error.partialText) {
          translatedText = error.partialText;
          console.log(`[Process] Partial translation: ${error.completedChunks}/${error.totalChunks} chunks`);
          sendSSE(res, {
            step: 'translating_partial',
            data: {
              translatedText: error.partialText,
              completedChunks: error.completedChunks,
              totalChunks: error.totalChunks,
              message: error.message,
            }
          });
        } else {
          throw error;
        }
      }

      console.log(`[Process] Translation done: ${translatedText.length} chars`);
      sendSSE(res, { step: 'translation_done', data: { translatedText } });
      audioUrl = await podcastPipeline(res, translatedText, videoId, podcastOpts);
    } else {
      // Standard mode: pipeline translate + TTS in parallel
      const result = await pipelinedTranslateAndTTS(res, fullTranscript, videoId, targetLanguage);
      translatedText = result.translatedText;
      audioUrl = result.audioUrl;
    }

    // Record usage
    const estimatedDuration = Math.ceil(translatedText.length / 15); // ~15 chars/second
    await recordUsage(user.id, podcastMode ? 'podcast' : 'tts', {
      durationSeconds: estimatedDuration,
      inputChars: fullTranscript.length,
      metadata: JSON.stringify({ videoId, targetLanguage, podcastMode }),
    });

    sendSSE(res, {
      step: 'done',
      data: { audioUrl, translatedText, transcript: fullTranscript, videoId, podcastMode, speechStartOffset }
    });

  } catch (error: any) {
    console.error('[Process] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue' });
    if (audioPath) cleanupAudioFile(audioPath);
  }

  res.end();
});

// ===== File processing (PDF/DOCX/TXT/Video/Audio → translate → TTS) =====
app.post('/api/process-file', requireAuth, requireQuota, upload.single('file'), async (req, res) => {
  const user = (req as any).dbUser;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const file = req.file;
  const targetLanguage = req.body?.targetLanguage || 'fr';
  const podcastMode = req.body?.podcastMode === 'true';
  const podcastOpts = podcastMode ? {
    tone: req.body?.podcastTone,
    speakerCount: req.body?.podcastSpeakerCount ? parseInt(req.body.podcastSpeakerCount) : undefined,
    voiceConfig: req.body?.podcastVoiceConfig ? JSON.parse(req.body.podcastVoiceConfig) : undefined,
  } : undefined;
  const userTranscript = req.body?.userTranscript?.trim() || '';
  let skipTranslation = req.body?.skipTranslation === 'true';

  if (!file) {
    sendSSE(res, { step: 'error', message: 'Aucun fichier reçu.' });
    return res.end();
  }

  if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    sendSSE(res, { step: 'error', message: 'Aucune clé API configurée. Ajoutez GROQ_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY dans .env' });
    cleanupAudioFile(file.path);
    return res.end();
  }

  const fileCategory = getFileCategory(file.originalname);

  try {
    let originalText: string;
    let speechStartOffset = 0;
    let localVideoUrl: string | undefined;

    if (userTranscript) {
      // User provided their own transcription — skip extraction/transcription
      originalText = userTranscript;
      console.log(`[FileProcess] User-provided transcript: ${originalText.length} chars`);
      sendSSE(res, {
        step: 'extract_done',
        data: { text: originalText, charCount: originalText.length, source: 'user' }
      });

      // If it's a video file, keep it for preview; otherwise cleanup
      if (isVideoFile(file.originalname)) {
        const ext = path.extname(file.originalname).toLowerCase();
        const videoFileName = `upload_${Date.now()}${ext}`;
        const videoDestPath = path.join(uploadsDir, videoFileName);
        fs.renameSync(file.path, videoDestPath);
        localVideoUrl = `/api/uploads/${videoFileName}`;
        console.log(`[FileProcess] Kept video for preview: ${localVideoUrl}`);
      } else {
        cleanupAudioFile(file.path);
      }
    } else if (fileCategory === 'media') {
      // Media file: transcribe with Whisper
      // Multer saves without extension — rename so the API can detect the file type
      const ext = path.extname(file.originalname).toLowerCase();
      const renamedPath = file.path + ext;
      fs.renameSync(file.path, renamedPath);

      sendSSE(res, { step: 'transcript', message: 'Transcription audio/vidéo avec Whisper IA...' });
      const { text: transcript, segments } = await transcribeAudio(renamedPath);
      originalText = transcript;
      speechStartOffset = segments.length > 0 ? segments[0].offset / 1000 : 0; // seconds
      console.log(`[FileProcess] Transcribed media: ${segments.length} segments, ${originalText.length} chars from ${file.originalname}, speech starts at ${speechStartOffset.toFixed(2)}s`);
      sendSSE(res, {
        step: 'transcript_done',
        data: { transcript: originalText, segmentCount: segments.length }
      });

      // If it's a video file, keep it for preview; otherwise cleanup
      if (isVideoFile(file.originalname)) {
        const videoFileName = `upload_${Date.now()}${ext}`;
        const videoDestPath = path.join(uploadsDir, videoFileName);
        fs.renameSync(renamedPath, videoDestPath);
        localVideoUrl = `/api/uploads/${videoFileName}`;
        console.log(`[FileProcess] Kept video for preview: ${localVideoUrl}`);
      } else {
        cleanupAudioFile(renamedPath);
      }
    } else {
      // Document: extract text
      sendSSE(res, { step: 'extract', message: 'Extraction du texte du document...' });
      originalText = await extractTextFromFile(file.path, file.originalname);
      console.log(`[FileProcess] Extracted ${originalText.length} chars from ${file.originalname}`);
      sendSSE(res, {
        step: 'extract_done',
        data: { text: originalText, charCount: originalText.length }
      });
      cleanupAudioFile(file.path);
    }

    const filePrefix = `file_${Date.now()}`;
    let translatedText: string;
    let audioUrl: string;

    // Auto-detect language: skip translation if already in target language
    if (!skipTranslation) {
      sendSSE(res, { step: 'detecting_language', message: 'Détection de la langue...' });
      const detectedLang = await detectLanguage(originalText);
      sendSSE(res, { step: 'language_detected', data: { detectedLang } });
      if (detectedLang === targetLanguage) {
        skipTranslation = true;
        console.log(`[FileProcess] Text already in ${targetLanguage}, skipping translation`);
        sendSSE(res, { step: 'translation_skipped', data: { detectedLang, targetLanguage, message: `Le texte est déjà en ${targetLanguage}, traduction ignorée.` } });
      }
    }

    if (skipTranslation) {
      // User provided transcript already in target language — skip translation, just TTS
      translatedText = originalText;
      console.log(`[FileProcess] Skip translation, direct TTS: ${translatedText.length} chars`);
      sendSSE(res, { step: 'translation_done', data: { translatedText, skipped: true } });

      if (podcastMode) {
        audioUrl = await podcastPipeline(res, translatedText, filePrefix, podcastOpts);
      } else {
        audioUrl = await streamingTTS(res, translatedText, filePrefix, targetLanguage);
      }
    } else if (podcastMode) {
      // Podcast mode: translate first, then generate script + audio
      sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });

      try {
        translatedText = await translateText(originalText, targetLanguage, (progress) => {
          sendSSE(res, { step: 'translating_progress', data: { progress } });
        }, {
          onProviderSwitch: (from, to) => {
            console.log(`[FileProcess] Provider switch: ${from} → ${to}`);
            sendSSE(res, { step: 'translating_provider_switch', data: { from, to } });
          },
        });
      } catch (error: any) {
        if (error instanceof PartialTranslationError && error.partialText) {
          translatedText = error.partialText;
          console.log(`[FileProcess] Partial translation: ${error.completedChunks}/${error.totalChunks} chunks`);
          sendSSE(res, {
            step: 'translating_partial',
            data: {
              translatedText: error.partialText,
              completedChunks: error.completedChunks,
              totalChunks: error.totalChunks,
              message: error.message,
            }
          });
        } else {
          throw error;
        }
      }

      console.log(`[FileProcess] Translation done: ${translatedText.length} chars`);
      sendSSE(res, { step: 'translation_done', data: { translatedText } });
      audioUrl = await podcastPipeline(res, translatedText, filePrefix, podcastOpts);
    } else {
      // Standard mode: pipeline translate + TTS in parallel
      const result = await pipelinedTranslateAndTTS(res, originalText, filePrefix, targetLanguage);
      translatedText = result.translatedText;
      audioUrl = result.audioUrl;
    }

    // Record usage
    const estimatedDuration = Math.ceil(translatedText.length / 15);
    await recordUsage(user.id, podcastMode ? 'podcast' : 'tts', {
      durationSeconds: estimatedDuration,
      inputChars: originalText.length,
      metadata: JSON.stringify({ fileName: file.originalname, fileCategory, targetLanguage, podcastMode, skipTranslation }),
    });

    sendSSE(res, {
      step: 'done',
      data: { audioUrl, translatedText, transcript: originalText, podcastMode, localVideoUrl, speechStartOffset }
    });

  } catch (error: any) {
    console.error('[FileProcess] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue' });
    if (file) cleanupAudioFile(file.path);
  }

  res.end();
});

// ===== Direct text processing (paste text → translate → TTS) =====
app.post('/api/process-text', requireAuth, requireQuota, async (req, res) => {
  const user = (req as any).dbUser;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const { text, targetLanguage = 'fr', podcastMode = false, skipTranslation = false, podcastTone, podcastSpeakerCount, podcastVoiceConfig } = req.body || {};
  const podcastOpts = podcastMode ? { tone: podcastTone, speakerCount: podcastSpeakerCount, voiceConfig: podcastVoiceConfig } : undefined;

  if (!text || !text.trim()) {
    sendSSE(res, { step: 'error', message: 'Aucun texte fourni.' });
    return res.end();
  }

  if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    sendSSE(res, { step: 'error', message: 'Aucune clé API configurée. Ajoutez GROQ_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY dans .env' });
    return res.end();
  }

  const originalText = text.trim();
  const filePrefix = `text_${Date.now()}`;

  try {
    let translatedText: string;
    let audioUrl: string;

    sendSSE(res, { step: 'extract_done', data: { text: originalText, charCount: originalText.length, source: 'text' } });

    if (skipTranslation) {
      translatedText = originalText;
      console.log(`[TextProcess] Skip translation, direct TTS: ${translatedText.length} chars`);
      sendSSE(res, { step: 'translation_done', data: { translatedText, skipped: true } });

      if (podcastMode) {
        audioUrl = await podcastPipeline(res, translatedText, filePrefix, podcastOpts);
      } else {
        audioUrl = await streamingTTS(res, translatedText, filePrefix, targetLanguage);
      }
    } else if (podcastMode) {
      sendSSE(res, { step: 'translating', message: 'Traduction en cours...' });

      try {
        translatedText = await translateText(originalText, targetLanguage, (progress) => {
          sendSSE(res, { step: 'translating_progress', data: { progress } });
        }, {
          onProviderSwitch: (from, to) => {
            console.log(`[TextProcess] Provider switch: ${from} → ${to}`);
            sendSSE(res, { step: 'translating_provider_switch', data: { from, to } });
          },
        });
      } catch (error: any) {
        if (error instanceof PartialTranslationError && error.partialText) {
          translatedText = error.partialText;
          sendSSE(res, {
            step: 'translating_partial',
            data: {
              translatedText: error.partialText,
              completedChunks: error.completedChunks,
              totalChunks: error.totalChunks,
              message: error.message,
            }
          });
        } else {
          throw error;
        }
      }

      sendSSE(res, { step: 'translation_done', data: { translatedText } });
      audioUrl = await podcastPipeline(res, translatedText, filePrefix, podcastOpts);
    } else {
      // Standard mode: pipeline translate + TTS
      const result = await pipelinedTranslateAndTTS(res, originalText, filePrefix, targetLanguage);
      translatedText = result.translatedText;
      audioUrl = result.audioUrl;
    }

    // Record usage
    const estimatedDuration = Math.ceil(translatedText.length / 15);
    await recordUsage(user.id, podcastMode ? 'podcast' : 'tts', {
      durationSeconds: estimatedDuration,
      inputChars: originalText.length,
      metadata: JSON.stringify({ source: 'text', targetLanguage, podcastMode, skipTranslation }),
    });

    sendSSE(res, {
      step: 'done',
      data: { audioUrl, translatedText, transcript: originalText, podcastMode }
    });

  } catch (error: any) {
    console.error('[TextProcess] Error:', error.message);
    sendSSE(res, { step: 'error', message: error.message || 'Erreur inattendue' });
  }

  res.end();
});

// ===== Available podcast voices =====
app.get('/api/podcast-voices', (_req, res) => {
  res.json(AVAILABLE_VOICES);
});

// ===== Summarize text =====
app.post('/api/summarize', async (req, res) => {
  const { text, language = 'fr' } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Texte requis.' });
  }

  try {
    const maxChars = 15000;
    const inputText = text.length > maxChars ? text.substring(0, maxChars) + '\n[...]' : text;

    const prompt = `Résume le texte suivant de manière concise et structurée en ${language === 'fr' ? 'français' : language}.
Fais un résumé clair avec les points clés. Le résumé doit faire environ 20% de la longueur du texte original.

Texte à résumer:
${inputText}`;

    let summary: string;

    if (process.env.GROQ_API_KEY) {
      const Groq = (await import('groq-sdk')).default;
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      });
      summary = response.choices[0].message.content || '';
    } else if (process.env.OPENROUTER_API_KEY) {
      const OpenAI = (await import('openai')).default;
      const openrouter = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
      const response = await openrouter.chat.completions.create({
        model: 'meta-llama/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      });
      summary = response.choices[0].message.content || '';
    } else if (process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      });
      summary = response.choices[0].message.content || '';
    } else {
      return res.status(500).json({ error: 'Aucun provider LLM configuré.' });
    }

    res.json({ summary });
  } catch (error: any) {
    console.error('[Summarize] Error:', error.message);
    res.status(500).json({ error: error.message || 'Erreur lors du résumé.' });
  }
});

// ===== Generate podcast from existing translated text =====
app.post('/api/generate-podcast', requireAuth, requireQuota, async (req, res) => {
  const user = (req as any).dbUser;
  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
  if (!limits.podcastEnabled) {
    return res.status(403).json({
      error: 'Mode podcast réservé aux plans Pro et Business.',
    });
  }

  const { translatedText, podcastTone, podcastSpeakerCount, podcastVoiceConfig } = req.body;
  const podcastOpts = { tone: podcastTone, speakerCount: podcastSpeakerCount, voiceConfig: podcastVoiceConfig };

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
    const audioUrl = await podcastPipeline(res, translatedText, filePrefix, podcastOpts);

    // Record usage
    const estimatedDuration = Math.ceil(translatedText.length / 15);
    await recordUsage(user.id, 'podcast', {
      durationSeconds: estimatedDuration,
      inputChars: translatedText.length,
    });

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
app.post('/api/merge-video', requireAuth, async (req, res) => {
  const { videoId, audioUrl, targetLanguage, speechStartOffset } = req.body;

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
    await mergeVideoAudio(videoPath, audioPath, mergedPath, targetLanguage, speechStartOffset || 0);

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

// ===== Merge local video + translated audio =====
app.post('/api/merge-local-video', requireAuth, async (req, res) => {
  const { localVideoUrl, audioUrl, targetLanguage, speechStartOffset } = req.body;

  if (!localVideoUrl || !audioUrl) {
    return res.status(400).json({ error: 'localVideoUrl et audioUrl requis' });
  }

  const videoFileName = path.basename(localVideoUrl);
  const videoPath = path.join(uploadsDir, videoFileName);
  const audioFileName = path.basename(audioUrl);
  const audioPath = path.join(outputDir, audioFileName);

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Fichier vidéo non trouvé' });
  }
  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Fichier audio non trouvé' });
  }

  try {
    const mergedFileName = `local_translated_${Date.now()}.mp4`;
    const mergedPath = path.join(videoOutputDir, mergedFileName);

    console.log(`[MergeLocal] Merging ${videoFileName} + ${audioFileName}...`);
    await mergeVideoAudio(videoPath, audioPath, mergedPath, targetLanguage, speechStartOffset || 0);

    const stats = fs.statSync(mergedPath);
    console.log(`[MergeLocal] Done: ${mergedFileName} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    res.json({
      videoUrl: `/api/video/${mergedFileName}`,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
    });
  } catch (error: any) {
    console.error('[MergeLocal] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== Split large PDF into chunks =====
app.post('/api/split-pdf', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'Aucun fichier fourni.' });
  }

  const pagesPerChunk = Math.max(1, parseInt(req.body.pagesPerChunk || '12', 10));

  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfBytes = fs.readFileSync(file.path);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    if (totalPages <= pagesPerChunk) {
      // No need to split — return the original file as a single chunk
      const chunkName = `chunk_1_p1-${totalPages}_${Date.now()}.pdf`;
      const chunkPath = path.join(outputDir, chunkName);
      fs.copyFileSync(file.path, chunkPath);
      fs.unlinkSync(file.path);

      return res.json({
        totalPages,
        chunks: [{
          index: 0,
          pages: `1-${totalPages}`,
          url: `/api/audio/${chunkName}`,
          fileName: chunkName,
        }],
      });
    }

    const chunks: { index: number; pages: string; url: string; fileName: string }[] = [];

    for (let start = 0; start < totalPages; start += pagesPerChunk) {
      const end = Math.min(start + pagesPerChunk, totalPages);
      const chunkDoc = await PDFDocument.create();
      const copiedPages = await chunkDoc.copyPages(pdfDoc, Array.from({ length: end - start }, (_, i) => start + i));
      for (const page of copiedPages) {
        chunkDoc.addPage(page);
      }

      const chunkBytes = await chunkDoc.save();
      const chunkName = `chunk_${chunks.length + 1}_p${start + 1}-${end}_${Date.now()}.pdf`;
      const chunkPath = path.join(outputDir, chunkName);
      fs.writeFileSync(chunkPath, chunkBytes);

      chunks.push({
        index: chunks.length,
        pages: `${start + 1}-${end}`,
        url: `/api/audio/${chunkName}`,
        fileName: chunkName,
      });
    }

    fs.unlinkSync(file.path);

    console.log(`[Split] ${totalPages} pages → ${chunks.length} chunks of ${pagesPerChunk} pages`);

    res.json({ totalPages, pagesPerChunk, chunks });
  } catch (error: any) {
    console.error('[Split] Error:', error.message);
    try { fs.unlinkSync(file.path); } catch {}
    res.status(500).json({ error: error.message || 'Erreur lors du découpage PDF.' });
  }
});

// ===== Combine multiple audio files =====
app.post('/api/combine-audio', requireAuth, upload.array('files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length < 2) {
    return res.status(400).json({ error: 'Au moins 2 fichiers audio requis.' });
  }

  // Options from form data
  const speed = parseFloat(req.body.speed || '1.0');
  const normalize = req.body.normalize === 'true';
  const silenceGap = parseFloat(req.body.silenceGap || '0');

  const tmpDir = path.join(os.tmpdir(), `vocaleez-combine-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const { execSync } = await import('child_process');

    // Create ffmpeg concat list file (demuxer approach for reliable concatenation)
    const listPath = path.join(tmpDir, 'list.txt');
    const entries: string[] = [];

    // Generate silence file if needed
    let silencePath = '';
    if (silenceGap > 0) {
      silencePath = path.join(tmpDir, 'silence.mp3');
      execSync(
        `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${silenceGap} -acodec libmp3lame -ab 192k "${silencePath}"`,
        { timeout: 10000, stdio: 'ignore' }
      );
    }

    for (let i = 0; i < files.length; i++) {
      const ext = path.extname(files[i].originalname).toLowerCase() || '.mp3';
      const rawPath = path.join(tmpDir, `raw_${i}${ext}`);
      const safePath = path.join(tmpDir, `input_${i}.mp3`);
      fs.renameSync(files[i].path, rawPath);

      // Normalize each file to consistent format (44100Hz, stereo, MP3 192k)
      // This prevents duration/speed issues when concatenating heterogeneous files
      execSync(
        `ffmpeg -y -i "${rawPath}" -ar 44100 -ac 2 -acodec libmp3lame -ab 192k "${safePath}"`,
        { timeout: 120000, stdio: 'ignore' }
      );

      entries.push(`file '${safePath.replace(/'/g, "'\\''")}'`);

      // Add silence between files (not after the last one)
      if (silenceGap > 0 && i < files.length - 1) {
        entries.push(`file '${silencePath.replace(/'/g, "'\\''")}'`);
      }
    }

    fs.writeFileSync(listPath, entries.join('\n'));

    const concatPath = path.join(tmpDir, 'concat_raw.mp3');
    const outputPath = path.join(outputDir, `combined_${Date.now()}.mp3`);

    // Step 1: Concat all files (all pre-normalized to same format, so -c copy is safe)
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}"`,
      { timeout: 300000, stdio: 'ignore' }
    );

    // Step 2: Apply post-processing filters (speed, normalization)
    const filters: string[] = [];
    if (speed !== 1.0 && speed >= 0.5 && speed <= 3.0) {
      // atempo only supports 0.5–2.0, chain for larger values
      let remaining = speed;
      const atempoChain: string[] = [];
      while (remaining > 2.0) {
        atempoChain.push('atempo=2.0');
        remaining /= 2.0;
      }
      while (remaining < 0.5) {
        atempoChain.push('atempo=0.5');
        remaining /= 0.5;
      }
      atempoChain.push(`atempo=${remaining.toFixed(4)}`);
      filters.push(...atempoChain);
    }
    if (normalize) {
      filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    }

    if (filters.length > 0) {
      execSync(
        `ffmpeg -y -i "${concatPath}" -af "${filters.join(',')}" -acodec libmp3lame -ab 192k "${outputPath}"`,
        { timeout: 300000, stdio: 'ignore' }
      );
    } else {
      fs.renameSync(concatPath, outputPath);
    }

    // Cleanup temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const stats = fs.statSync(outputPath);
    const fileName = path.basename(outputPath);

    const opts = [];
    if (speed !== 1.0) opts.push(`speed=${speed}x`);
    if (normalize) opts.push('normalized');
    if (silenceGap > 0) opts.push(`silence=${silenceGap}s`);
    console.log(`[Combine] ${files.length} files → ${fileName} (${(stats.size / 1024 / 1024).toFixed(1)}MB) ${opts.length ? `[${opts.join(', ')}]` : ''}`);

    res.json({
      audioUrl: `/api/audio/${fileName}`,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
      fileCount: files.length,
    });
  } catch (error: any) {
    console.error('[Combine] Error:', error.message);
    // Cleanup on error
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch {}
    }
    res.status(500).json({ error: error.message || 'Erreur lors de la combinaison audio.' });
  }
});

// ===== Saved Videos =====
app.post('/api/videos/save', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { title, youtubeUrl, sourceType, originalText, translatedText, audioUrl, targetLanguage, durationSeconds, thumbnailUrl } = req.body;

  if (!title) return res.status(400).json({ error: 'title requis' });

  const video = await prisma.savedVideo.create({
    data: {
      userId: user.id,
      title,
      youtubeUrl: youtubeUrl || null,
      sourceType: sourceType || 'youtube',
      originalText: originalText || null,
      translatedText: translatedText || null,
      audioUrl: audioUrl || null,
      targetLanguage: targetLanguage || 'fr',
      durationSeconds: durationSeconds || 0,
      thumbnailUrl: thumbnailUrl || null,
    },
  });

  res.json(video);
});

app.get('/api/videos', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const videos = await prisma.savedVideo.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { playlists: { include: { playlist: true } } },
  });
  res.json(videos);
});

app.delete('/api/videos/:id', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const video = await prisma.savedVideo.findFirst({ where: { id: req.params.id, userId: user.id } });
  if (!video) return res.status(404).json({ error: 'Vidéo non trouvée' });
  await prisma.savedVideo.delete({ where: { id: video.id } });
  res.json({ ok: true });
});

// ===== Playlists =====
app.get('/api/playlists', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const playlists = await prisma.playlist.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: { videos: { include: { video: true } } },
  });
  res.json(playlists);
});

app.post('/api/playlists', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

  const playlist = await prisma.playlist.create({
    data: { userId: user.id, name: name.trim() },
    include: { videos: { include: { video: true } } },
  });
  res.json(playlist);
});

app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const playlist = await prisma.playlist.findFirst({ where: { id: req.params.id, userId: user.id } });
  if (!playlist) return res.status(404).json({ error: 'Playlist non trouvée' });
  await prisma.playlist.delete({ where: { id: playlist.id } });
  res.json({ ok: true });
});

app.post('/api/playlists/:id/videos', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { videoId } = req.body;
  const playlist = await prisma.playlist.findFirst({ where: { id: req.params.id, userId: user.id } });
  if (!playlist) return res.status(404).json({ error: 'Playlist non trouvée' });

  const video = await prisma.savedVideo.findFirst({ where: { id: videoId, userId: user.id } });
  if (!video) return res.status(404).json({ error: 'Vidéo non trouvée' });

  const existing = await prisma.playlistVideo.findUnique({
    where: { playlistId_videoId: { playlistId: playlist.id, videoId: video.id } },
  });
  if (existing) return res.status(409).json({ error: 'Vidéo déjà dans la playlist' });

  await prisma.playlistVideo.create({
    data: { playlistId: playlist.id, videoId: video.id },
  });

  const updated = await prisma.playlist.findUnique({
    where: { id: playlist.id },
    include: { videos: { include: { video: true } } },
  });
  res.json(updated);
});

app.delete('/api/playlists/:playlistId/videos/:videoId', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const playlist = await prisma.playlist.findFirst({ where: { id: req.params.playlistId, userId: user.id } });
  if (!playlist) return res.status(404).json({ error: 'Playlist non trouvée' });

  await prisma.playlistVideo.deleteMany({
    where: { playlistId: playlist.id, videoId: req.params.videoId },
  });

  const updated = await prisma.playlist.findUnique({
    where: { id: playlist.id },
    include: { videos: { include: { video: true } } },
  });
  res.json(updated);
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
    piper: getPiperStatus(),
    auth: !!process.env.CLERK_SECRET_KEY,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Auth: ${process.env.CLERK_SECRET_KEY ? 'Clerk enabled' : 'disabled (dev mode)'}`);
  console.log(`Database: SQLite (prisma)`);
  console.log(`OpenAI API key: ${process.env.OPENAI_API_KEY ? 'configured' : 'not set'}`);
  console.log(`Groq API key: ${process.env.GROQ_API_KEY ? 'configured (Whisper + translation)' : 'not set'}`);
  console.log(`OpenRouter API key: ${process.env.OPENROUTER_API_KEY ? 'configured (LLM fallback)' : 'not set'}`);
  console.log(`ElevenLabs API key: ${process.env.ELEVENLABS_API_KEY ? 'configured (TTS fallback)' : 'not set'}`);
  console.log(`Google API key: ${process.env.GOOGLE_API_KEY ? 'configured (Gemini TTS podcast)' : 'not set'}`);
  console.log(`[Priority] Translation/LLM: Groq > OpenRouter > OpenAI`);
  console.log(`[Priority] TTS: ElevenLabs > OpenAI > Gemini > Edge TTS (free) | Podcast TTS: Gemini > ElevenLabs > OpenAI`);
  console.log(`[Priority] Whisper: Groq > OpenAI`);
});
