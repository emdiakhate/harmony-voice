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
import { concatMp3Buffers } from './services/audio-concat.js';
import { getPiperStatus } from './services/piper-tts.js';
import { extractTextFromFile } from './services/document-parser.js';
import { generatePodcastScript } from './services/podcast-generator.js';
import { generatePodcastAudio, AVAILABLE_VOICES } from './services/podcast-tts.js';
import { chatComplete, resolveLlmConfig, resolveTranscribeConfig, resolveImageConfig, hasAnyProvider, type LlmConfigInput } from './services/llm/router.js';
import { loadUserKeys, injectKeys } from './services/llm/keystore.js';
import { buildCoverPrompt, generateCoverImage, embedCoverArt, type CoverStyle } from './services/image-generator.js';
import { encrypt, decrypt, maskKey, isEncryptionConfigured } from './lib/crypto.js';
import { requireAuth } from './lib/auth.js';
import { prisma } from './lib/prisma.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

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

// Parse the LLM provider chain sent by the frontend (clés utilisateur + priorité).
// Accepte un tableau JSON (body direct) ou une chaîne JSON (champ FormData).
function parseLlmConfig(raw: any): LlmConfigInput | null {
  if (!raw) return null;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) return v as LlmConfigInput;
  } catch {
    // ignore JSON invalide → repli sur la chaîne par défaut (.env + tiers gratuits)
  }
  return null;
}

// Shared: streaming TTS pipeline (used by both YouTube and file processing)
async function streamingTTS(
  res: express.Response,
  translatedText: string,
  filePrefix: string,
  targetLanguage: string,
  ttsConfig?: LlmConfigInput | null,
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
      const buffer = await generateSpeechChunk(ttsChunks[i], ttsConfig);
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
    fs.writeFileSync(finalPath, await concatMp3Buffers(audioBuffers));
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
  llmConfig?: LlmConfigInput | null,
  ttsConfig?: LlmConfigInput | null,
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
            const buffer = await generateSpeechChunk(ttsText, ttsConfig);
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
    }, llmConfig);
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
    fs.writeFileSync(finalPath, await concatMp3Buffers(audioBuffers));
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
  podcastOptions?: { tone?: string; speakerCount?: number; voiceConfig?: Record<string, string>; llmConfig?: LlmConfigInput | null; ttsConfig?: LlmConfigInput | null },
): Promise<string> {
  // Step A: Generate podcast script
  sendSSE(res, { step: 'podcast_script', message: 'Génération du script podcast...' });
  const podcastScript = await generatePodcastScript(translatedText, {
    tone: (podcastOptions?.tone as any) || 'casual',
    speakerCount: (podcastOptions?.speakerCount as any) || 2,
    llmConfig: podcastOptions?.llmConfig,
  });
  console.log(`[Podcast] Script generated: ${podcastScript.length} chars`);
  sendSSE(res, { step: 'podcast_script_done', data: { script: podcastScript } });

  // Step B: Generate podcast audio (Gemini > ElevenLabs > OpenAI) with jingles
  sendSSE(res, { step: 'podcast_tts', message: 'Génération audio podcast (avec jingles)...' });
  let currentProvider = '';
  const { audioBuffer, provider } = await generatePodcastAudio(podcastScript, (progress, message, prov) => {
    if (prov) currentProvider = prov;
    sendSSE(res, { step: 'podcast_tts_progress', data: { progress, message, provider: currentProvider } });
  }, podcastOptions?.voiceConfig, podcastOptions?.ttsConfig);

  console.log(`[Podcast] Audio generated with ${provider}: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);

  const timestamp = Date.now();
  const podcastFileName = `${filePrefix}_podcast_${timestamp}.mp3`;
  const podcastPath = path.join(outputDir, podcastFileName);
  fs.writeFileSync(podcastPath, audioBuffer);

  sendSSE(res, { step: 'podcast_tts_done', data: { provider } });

  return `/api/audio/${podcastFileName}`;
}

// ===== YouTube processing (SSE stream) =====
app.post('/api/process', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { url, targetLanguage = 'fr', podcastMode = false, podcastTone, podcastSpeakerCount, podcastVoiceConfig } = req.body;
  const keyMap = await loadUserKeys(user.id);
  const llmConfig = injectKeys(parseLlmConfig(req.body.llmConfig), keyMap);
  const transcriptionConfig = injectKeys(parseLlmConfig(req.body.transcriptionConfig), keyMap);
  const ttsConfig = injectKeys(parseLlmConfig(req.body.ttsConfig), keyMap);
  const podcastOpts = podcastMode ? { tone: podcastTone, speakerCount: podcastSpeakerCount, voiceConfig: podcastVoiceConfig, llmConfig, ttsConfig } : undefined;

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

    // Transcription Whisper : clés utilisateur (Paramètres) + repli .env. Échec rapide si aucune.
    if (resolveTranscribeConfig(transcriptionConfig).length === 0) {
      sendSSE(res, { step: 'error', message: "La transcription Whisper nécessite une clé Groq ou OpenAI (dans les Paramètres ou .env). Les tiers gratuits ne transcrivent pas l'audio." });
      return res.end();
    }

    // Step 1: Download audio
    sendSSE(res, { step: 'download', message: 'Extraction audio de la vidéo YouTube...' });
    audioPath = await downloadYouTubeAudio(videoId);
    const fileSize = (fs.statSync(audioPath).size / 1024 / 1024).toFixed(1);
    sendSSE(res, { step: 'download_done', data: { fileSize: `${fileSize}MB` } });

    // Step 2: Transcribe
    sendSSE(res, { step: 'transcript', message: 'Transcription avec Whisper IA...' });
    const { text: fullTranscript, segments } = await transcribeAudio(audioPath, transcriptionConfig);
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
    const detectedLang = await detectLanguage(fullTranscript, llmConfig);
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
        audioUrl = await streamingTTS(res, translatedText, videoId, targetLanguage, ttsConfig);
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
        }, llmConfig);
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
      const result = await pipelinedTranslateAndTTS(res, fullTranscript, videoId, targetLanguage, llmConfig, ttsConfig);
      translatedText = result.translatedText;
      audioUrl = result.audioUrl;
    }

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
app.post('/api/process-file', requireAuth, upload.single('file'), async (req, res) => {
  const user = (req as any).dbUser;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const file = req.file;
  const targetLanguage = req.body?.targetLanguage || 'fr';
  const podcastMode = req.body?.podcastMode === 'true';
  const keyMap = await loadUserKeys(user.id);
  const llmConfig = injectKeys(parseLlmConfig(req.body?.llmConfig), keyMap);
  const transcriptionConfig = injectKeys(parseLlmConfig(req.body?.transcriptionConfig), keyMap);
  const ttsConfig = injectKeys(parseLlmConfig(req.body?.ttsConfig), keyMap);
  const podcastOpts = podcastMode ? {
    tone: req.body?.podcastTone,
    speakerCount: req.body?.podcastSpeakerCount ? parseInt(req.body.podcastSpeakerCount) : undefined,
    voiceConfig: req.body?.podcastVoiceConfig ? JSON.parse(req.body.podcastVoiceConfig) : undefined,
    llmConfig,
    ttsConfig,
  } : undefined;
  const userTranscript = req.body?.userTranscript?.trim() || '';
  let skipTranslation = req.body?.skipTranslation === 'true';

  if (!file) {
    sendSSE(res, { step: 'error', message: 'Aucun fichier reçu.' });
    return res.end();
  }

  if (!hasAnyProvider(llmConfig)) {
    sendSSE(res, { step: 'error', message: 'Aucun fournisseur LLM disponible (ajoutez une clé dans les Paramètres ou activez un tier gratuit).' });
    cleanupAudioFile(file.path);
    return res.end();
  }
  // Note : pour les fichiers média, la transcription Whisper requiert toujours GROQ_API_KEY/OPENAI_API_KEY
  // (le transcripteur lèvera une erreur explicite si absente).

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
      const { text: transcript, segments } = await transcribeAudio(renamedPath, transcriptionConfig);
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
      const detectedLang = await detectLanguage(originalText, llmConfig);
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
        audioUrl = await streamingTTS(res, translatedText, filePrefix, targetLanguage, ttsConfig);
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
        }, llmConfig);
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
      const result = await pipelinedTranslateAndTTS(res, originalText, filePrefix, targetLanguage, llmConfig, ttsConfig);
      translatedText = result.translatedText;
      audioUrl = result.audioUrl;
    }

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
app.post('/api/process-text', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const { text, targetLanguage = 'fr', podcastMode = false, skipTranslation = false, podcastTone, podcastSpeakerCount, podcastVoiceConfig } = req.body || {};
  const keyMap = await loadUserKeys(user.id);
  const llmConfig = injectKeys(parseLlmConfig(req.body?.llmConfig), keyMap);
  const ttsConfig = injectKeys(parseLlmConfig(req.body?.ttsConfig), keyMap);
  const podcastOpts = podcastMode ? { tone: podcastTone, speakerCount: podcastSpeakerCount, voiceConfig: podcastVoiceConfig, llmConfig, ttsConfig } : undefined;

  if (!text || !text.trim()) {
    sendSSE(res, { step: 'error', message: 'Aucun texte fourni.' });
    return res.end();
  }

  if (!hasAnyProvider(llmConfig)) {
    sendSSE(res, { step: 'error', message: 'Aucun fournisseur LLM disponible (ajoutez une clé dans les Paramètres ou activez un tier gratuit).' });
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
        audioUrl = await streamingTTS(res, translatedText, filePrefix, targetLanguage, ttsConfig);
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
        }, llmConfig);
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
      const result = await pipelinedTranslateAndTTS(res, originalText, filePrefix, targetLanguage, llmConfig, ttsConfig);
      translatedText = result.translatedText;
      audioUrl = result.audioUrl;
    }

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
app.post('/api/summarize', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { text, language = 'fr', llmConfig } = req.body;

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

    const keyMap = await loadUserKeys(user.id);
    const summary = await chatComplete({
      label: 'Summarize',
      attempts: resolveLlmConfig(injectKeys(parseLlmConfig(llmConfig), keyMap)),
      temperature: 0.3,
      maxTokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json({ summary });
  } catch (error: any) {
    console.error('[Summarize] Error:', error.message);
    res.status(500).json({ error: error.message || 'Erreur lors du résumé.' });
  }
});

// ===== Generate cover image (audiobook-style thumbnail) =====
app.post('/api/generate-cover', requireAuth, upload.single('referenceImage'), async (req, res) => {
  const user = (req as any).dbUser;
  const refFile = req.file; // multer = disque ; req.file.path est un chemin temporaire
  try {
    const { title, author, subtitle, style, contentHint, audioUrl } = req.body || {};

    const keyMap = await loadUserKeys(user.id);
    const imageConfig = injectKeys(parseLlmConfig(req.body?.imageConfig), keyMap);
    const attempts = resolveImageConfig(imageConfig);

    // Image de référence optionnelle → data URL base64 (seul OpenRouter l'exploite).
    let referenceImageDataUrl: string | undefined;
    if (refFile) {
      const buf = fs.readFileSync(refFile.path);
      const mime = refFile.mimetype || 'image/png';
      referenceImageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    }

    const prompt = buildCoverPrompt({
      title,
      author,
      subtitle,
      style: (style as CoverStyle) || 'audiobook',
      contentHint,
    });

    const buffer = await generateCoverImage({ prompt, referenceImageDataUrl, attempts });

    const coverFileName = `cover_${Date.now()}.png`;
    fs.writeFileSync(path.join(outputDir, coverFileName), buffer);
    const coverImageUrl = `/api/audio/${coverFileName}`;

    // Intégration ID3 best-effort dans le MP3 source (si fourni et présent sur disque).
    if (audioUrl && typeof audioUrl === 'string') {
      const audioName = path.basename(audioUrl); // sécurité: jamais hors de outputDir
      const audioPath = path.join(outputDir, audioName);
      if (audioName.toLowerCase().endsWith('.mp3') && fs.existsSync(audioPath)) {
        await embedCoverArt(audioPath, path.join(outputDir, coverFileName));
      }
    }

    res.json({ coverImageUrl });
  } catch (error: any) {
    console.error('[Cover] Error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Erreur lors de la génération de la couverture.' });
  } finally {
    if (refFile) {
      try { fs.unlinkSync(refFile.path); } catch {}
    }
  }
});

// ===== Generate podcast from existing translated text =====
app.post('/api/generate-podcast', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { translatedText, podcastTone, podcastSpeakerCount, podcastVoiceConfig } = req.body;
  const keyMap = await loadUserKeys(user.id);
  const podcastOpts = {
    tone: podcastTone,
    speakerCount: podcastSpeakerCount,
    voiceConfig: podcastVoiceConfig,
    llmConfig: injectKeys(parseLlmConfig(req.body.llmConfig), keyMap),
    ttsConfig: injectKeys(parseLlmConfig(req.body.ttsConfig), keyMap),
  };

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

// ===== Combine already-generated audio chunks (already on server disk) into one =====
// Reuses concatMp3Buffers (ffmpeg decode → resample → re-encode) so the recomposed file
// has a correct header/duration and no speed glitches. No re-upload: the parts are read
// straight from outputDir by basename (path traversal is impossible).
app.post('/api/combine-chunks', requireAuth, async (req, res) => {
  const { audioUrls, fileName } = req.body as { audioUrls?: string[]; fileName?: string };

  if (!Array.isArray(audioUrls) || audioUrls.length < 2) {
    return res.status(400).json({ error: 'Au moins 2 audios requis.' });
  }

  try {
    const buffers: Buffer[] = [];
    for (const url of audioUrls) {
      const name = path.basename(String(url)); // sécurité: jamais hors de outputDir
      const filePath = path.join(outputDir, name);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `Audio introuvable: ${name}` });
      }
      buffers.push(fs.readFileSync(filePath));
    }

    const combined = await concatMp3Buffers(buffers);

    const safeBase = (fileName || 'document').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'document';
    const outName = `combined_${safeBase}_${Date.now()}.mp3`;
    const outPath = path.join(outputDir, outName);
    fs.writeFileSync(outPath, combined);

    const stats = fs.statSync(outPath);
    console.log(`[CombineChunks] ${audioUrls.length} parties → ${outName} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

    res.json({
      audioUrl: `/api/audio/${outName}`,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
      partCount: audioUrls.length,
    });
  } catch (error: any) {
    console.error('[CombineChunks] Error:', error.message);
    res.status(500).json({ error: error.message || 'Erreur lors de la combinaison des audios.' });
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

// Test provider API key
async function testProviderKey(provider: string, key: string): Promise<boolean> {
  const headers: Record<string, string> = {};
  let url = "";
  switch (provider) {
    case "openai":
      url = "https://api.openai.com/v1/models";
      headers["Authorization"] = `Bearer ${key}`;
      break;
    case "groq":
      url = "https://api.groq.com/openai/v1/models";
      headers["Authorization"] = `Bearer ${key}`;
      break;
    case "openrouter":
      url = "https://openrouter.ai/api/v1/models";
      headers["Authorization"] = `Bearer ${key}`;
      break;
    case "gemini":
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
      break;
    case "elevenlabs":
      url = "https://api.elevenlabs.io/v1/user";
      headers["xi-api-key"] = key;
      break;
    case "claude":
      url = "https://api.anthropic.com/v1/models";
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      break;
    default:
      return false;
  }
  try {
    const r = await fetch(url, { headers });
    return r.ok;
  } catch {
    return false;
  }
}

app.post('/api/settings/test-key', async (req, res) => {
  const { provider, key } = req.body as { provider: string; key: string };
  if (!provider || !key) {
    res.json({ valid: false });
    return;
  }
  const valid = await testProviderKey(provider, key);
  res.json({ valid });
});

// ===== Clés API utilisateur (chiffrées en base) =====
// Les clés sont stockées chiffrées (AES-256-GCM) et ne sont JAMAIS renvoyées en clair.

app.get('/api/settings/keys', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const rows = await prisma.providerKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  const keys = rows.map((r) => {
    let masked = '••••';
    try { masked = maskKey(decrypt(r.encryptedKey)); } catch {}
    return { id: r.id, provider: r.provider, label: r.label, masked, disabled: r.disabled, createdAt: r.createdAt };
  });
  res.json({ keys });
});

app.post('/api/settings/keys', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { provider, key, label } = req.body as { provider?: string; key?: string; label?: string };
  if (!provider || !key || !key.trim()) {
    return res.status(400).json({ error: 'provider et key requis' });
  }
  if (!isEncryptionConfigured()) {
    return res.status(500).json({ error: "ENCRYPTION_KEY non configurée côté serveur (openssl rand -hex 32)." });
  }
  const row = await prisma.providerKey.create({
    data: {
      userId: user.id,
      provider,
      label: label?.trim() || `${provider} #${Date.now() % 1000}`,
      encryptedKey: encrypt(key.trim()),
    },
  });
  res.json({ id: row.id, provider: row.provider, label: row.label, masked: maskKey(key.trim()), disabled: row.disabled, createdAt: row.createdAt });
});

app.patch('/api/settings/keys/:id', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const row = await prisma.providerKey.findFirst({ where: { id: req.params.id, userId: user.id } });
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  const { disabled, label } = req.body as { disabled?: boolean; label?: string };
  const updated = await prisma.providerKey.update({
    where: { id: row.id },
    data: {
      ...(typeof disabled === 'boolean' ? { disabled } : {}),
      ...(label !== undefined ? { label } : {}),
    },
  });
  res.json({ id: updated.id, provider: updated.provider, label: updated.label, disabled: updated.disabled });
});

app.delete('/api/settings/keys/:id', requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const row = await prisma.providerKey.findFirst({ where: { id: req.params.id, userId: user.id } });
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  await prisma.providerKey.delete({ where: { id: row.id } });
  res.json({ ok: true });
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
  });
});

// En production (ou après `npm run build`), sert le frontend compilé depuis dist/.
// Doit être enregistré APRÈS toutes les routes /api pour ne pas les masquer.
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // Fallback SPA : toute route non-/api renvoie index.html (routing côté client).
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log('[Static] Frontend servi depuis dist/');
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
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
