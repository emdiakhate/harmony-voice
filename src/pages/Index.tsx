import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileAudio,
  Link,
  ArrowRightLeft,
  Languages,
  FileText,
  Mic,
  Video,
  CheckCircle,
  Loader2,
  AlertCircle,
  XCircle,
  Download,
  Music,
  Radio,
  BookmarkPlus,
  Check,
  FileVideo,
  Type,
  SkipForward,
  AlignLeft,
  Users,
  MessageSquare,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react";
import FileDropZone from "@/components/FileDropZone";
import LanguageSelector from "@/components/LanguageSelector";
import ResultsPanel from "@/components/ResultsPanel";
import YouTubePlayer from "@/components/YouTubePlayer";
import LocalVideoPlayer from "@/components/LocalVideoPlayer";
import AudioPlayer from "@/components/AudioPlayer";
import SaveDialog from "@/components/SaveDialog";
import CoverDialog from "@/components/CoverDialog";
import UserMenu from "@/components/UserMenu";
import AudioCombiner from "@/components/AudioCombiner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useSettings, buildLlmConfig, buildTaskConfig } from "@/hooks/useSettings";
import {
  saveSession,
  loadSession,
  clearSession,
  hasContent,
  type SessionSnapshot,
} from "@/lib/sessionStore";

type InputMode = "file" | "url" | "text" | "combine";

interface ProcessingStep {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  progress?: number;
}

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function isMediaFile(file: File): boolean {
  return file.type.startsWith("video/") || file.type.startsWith("audio/");
}

// SSE stream reader (shared between YouTube and file modes)
async function readSSEStream(
  response: Response,
  onEvent: (data: any) => void
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch {
          // Skip malformed events
        }
      }
    }
  } catch (err) {
    // User cancellation → propagate as-is so callers can ignore it.
    if ((err as Error)?.name === "AbortError") throw err;
    // Connection dropped mid-stream (e.g. the machine went to sleep and the
    // TCP socket was suspended). Tag it so callers show a recoverable message.
    const connErr = new Error("Connexion interrompue") as Error & { cause?: string };
    connErr.cause = "connection-lost";
    throw connErr;
  }

  if (buffer.startsWith("data: ")) {
    try {
      onEvent(JSON.parse(buffer.slice(6)));
    } catch {
      // Skip
    }
  }
}

// Builds a user-facing message for a failed stream. Returns null when the
// failure is a user-initiated cancellation (nothing to show).
function describeStreamError(error: unknown): string | null {
  const e = error as { name?: string; message?: string; cause?: unknown };
  if (e?.name === "AbortError") return null;
  if (e?.cause === "connection-lost")
    return "Connexion interrompue (veille ?). Vos textes sont conservés — cliquez sur « Reprendre ».";
  if (e?.message?.includes("Failed to fetch"))
    return "Impossible de contacter le serveur. Lancez le backend avec: npm run dev:server";
  return e?.message || "Erreur de connexion au serveur";
}

const Index = () => {
  const { settings } = useSettings();
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Actual processing units: a large PDF is split into several parts here,
  // WITHOUT replacing `selectedFiles` (so the original file stays visible).
  const [queueFiles, setQueueFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("fr");
  const [transcription, setTranscription] = useState("");
  const [translation, setTranslation] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioChunks, setAudioChunks] = useState<string[]>([]);
  const [isTtsStreaming, setIsTtsStreaming] = useState(false);
  const [videoId, setVideoId] = useState("");
  const [speechStartOffset, setSpeechStartOffset] = useState(0);
  const [steps, setSteps] = useState<ProcessingStep[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  // A generation was interrupted (sleep / reload) and can be resumed from text.
  const [interrupted, setInterrupted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  // While resuming, audio is regenerated from existing text — don't let the
  // stream's text events overwrite the original transcription/translation.
  const resumingRef = useRef(false);

  // Generation mode (audio vs podcast)
  const [generationMode, setGenerationMode] = useState<"audio" | "podcast">("audio");
  const podcastMode = generationMode === "podcast";
  const [podcastScript, setPodcastScript] = useState("");
  const [podcastTone, setPodcastTone] = useState<"formal" | "casual" | "humorous">("casual");
  const [podcastSpeakerCount, setPodcastSpeakerCount] = useState<2 | 3 | 4>(2);

  // Summary
  const [summary, setSummary] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);

  // Video download state
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);

  // Save dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Cover image (audiobook-style thumbnail)
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [showCoverDialog, setShowCoverDialog] = useState(false);

  // Local video preview (uploaded video files)
  const [localVideoUrl, setLocalVideoUrl] = useState("");

  // Direct text input mode
  const [pastedText, setPastedText] = useState("");

  // Transcript-only mode: user provides their own transcript (already in target language)
  const [userTranscript, setUserTranscript] = useState("");
  const [skipTranslation, setSkipTranslation] = useState(false);
  const [processMode, setProcessMode] = useState<
    "transcribe" | "translate" | "both" | null
  >(null);

  const isSameLang = sourceLang !== "auto" && sourceLang === targetLang;

  const resolveEffectiveMode = useCallback(
    (
      source: "media" | "document" | "text" | "youtube"
    ): "transcribe" | "translate" | "both" => {
      if (processMode) return processMode;
      if (isSameLang) return "transcribe";
      if (source === "text" || source === "document") return "translate";
      return "both";
    },
    [processMode, isSameLang]
  );

  // Multi-file queue
  const [queueIndex, setQueueIndex] = useState(0);
  const [waitingForNext, setWaitingForNext] = useState(false);
  const [queueCompleted, setQueueCompleted] = useState(0);

  // Recompose the full audio from each queue item's final audio.
  // `resetResultState()` wipes `audioUrl` between items, so we capture each item's
  // result here to offer the user a single combined audio at the end of the queue.
  const [queueAudioUrls, setQueueAudioUrls] = useState<{ fileName: string; audioUrl: string }[]>([]);
  const [combinedAudioUrl, setCombinedAudioUrl] = useState("");
  const [isCombining, setIsCombining] = useState(false);
  // Last final audioUrl produced by the current queue item (ref avoids stale-closure
  // reads of React state inside the `processFileQueue` loop).
  const lastAudioUrlRef = useRef<string>("");

  // The list actually being processed (PDF parts when split, else the originals).
  // `selectedFiles` always keeps the user's original files for display.
  const processingQueue = queueFiles.length > 0 ? queueFiles : selectedFiles;
  const isQueueMode = inputMode === "file" && processingQueue.length > 1;
  const currentFile = inputMode === "file" ? processingQueue[queueIndex] : null;

  const resetResultState = useCallback(() => {
    setTranscription("");
    setTranslation("");
    setAudioUrl("");
    setAudioChunks([]);
    setIsTtsStreaming(false);
    setErrorMessage("");
    setVideoId("");
    setPodcastScript("");
    setSummary("");
    setShowSaveDialog(false);
    setCoverImageUrl("");
    setShowCoverDialog(false);
    setLocalVideoUrl("");
    setSteps([]);
    setWaitingForNext(false);
    setInterrupted(false);
  }, []);

  // --- Session persistence: survive a reload (e.g. Vite HMR reload after the
  // machine wakes from sleep) without losing work or re-uploading the file. ---

  // Restore the previous session once, on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const snap = loadSession();
    if (!hasContent(snap)) return;
    setInputMode(snap.inputMode as InputMode);
    setSourceLang(snap.sourceLang);
    setTargetLang(snap.targetLang);
    setGenerationMode(snap.generationMode);
    setTranscription(snap.transcription);
    setTranslation(snap.translation);
    setSummary(snap.summary);
    setPodcastScript(snap.podcastScript);
    setAudioUrl(snap.audioUrl);
    setAudioChunks(snap.audioChunks || []);
    setCoverImageUrl(snap.coverImageUrl || "");
    setQueueAudioUrls(snap.queueAudioUrls || []);
    setCombinedAudioUrl(snap.combinedAudioUrl || "");
    setVideoId(snap.videoId);
    setLocalVideoUrl(snap.localVideoUrl);
    // Generation was still running when the page was lost → offer to resume.
    if (snap.status === "processing") setInterrupted(true);
    toast.info("Session précédente restaurée");
  }, []);

  // Persist the working session whenever results change.
  useEffect(() => {
    const snapshot: SessionSnapshot = {
      inputMode,
      sourceLang,
      targetLang,
      generationMode,
      transcription,
      translation,
      summary,
      podcastScript,
      audioUrl,
      audioChunks,
      coverImageUrl,
      queueAudioUrls,
      combinedAudioUrl,
      videoId,
      localVideoUrl,
      originalFileNames: selectedFiles.map((f) => f.name),
      status: isProcessing ? "processing" : audioUrl ? "done" : "idle",
      savedAt: Date.now(),
    };
    if (hasContent(snapshot) || isProcessing) saveSession(snapshot);
  }, [
    inputMode,
    sourceLang,
    targetLang,
    generationMode,
    transcription,
    translation,
    summary,
    podcastScript,
    audioUrl,
    audioChunks,
    coverImageUrl,
    queueAudioUrls,
    combinedAudioUrl,
    videoId,
    localVideoUrl,
    selectedFiles,
    isProcessing,
  ]);

  const splitPdfsInQueue = async (files: File[]): Promise<File[]> => {
    const result: File[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        result.push(file);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('pagesPerChunk', '12');
        const res = await fetch('/api/split-pdf', { method: 'POST', body: formData });
        if (!res.ok) { result.push(file); continue; }
        const data = await res.json();
        if (data.chunks.length <= 1) { result.push(file); continue; }
        const chunkFiles = await Promise.all(
          data.chunks.map(async (chunk: { url: string; fileName: string }) => {
            const blob = await fetch(chunk.url).then(r => r.blob());
            return new File([blob], chunk.fileName, { type: 'application/pdf' });
          })
        );
        toast.info(`PDF découpé en ${chunkFiles.length} parties`);
        result.push(...chunkFiles);
      } catch {
        result.push(file);
      }
    }
    return result;
  };

  const processFile = useCallback(async (file: File, signal: AbortSignal) => {
    const isMedia = isMediaFile(file);
    const hasUserTranscript = userTranscript.trim().length > 0;
    const effectiveMode = resolveEffectiveMode(isMedia ? "media" : "document");
    const effectiveSkipTranslation =
      effectiveMode === "transcribe" || skipTranslation || isSameLang;
    const baseSteps: ProcessingStep[] = [];

    if (!hasUserTranscript) {
      if (isMedia) {
        baseSteps.push({ id: "transcript", label: "Transcription Whisper IA", status: "pending" });
      } else {
        baseSteps.push({ id: "extract", label: "Extraction du texte", status: "pending" });
      }
    }

    if (!effectiveSkipTranslation) {
      baseSteps.push({ id: "translating", label: "Traduction", status: "pending" });
    }

    if (podcastMode) {
      baseSteps.push(
        { id: "podcast_script", label: "Génération du script podcast", status: "pending" },
        { id: "podcast_tts", label: "Génération de l’audio podcast", status: "pending" },
      );
    } else {
      baseSteps.push({ id: "tts", label: "Génération de l’audio", status: "pending" });
    }
    setSteps(baseSteps);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("targetLanguage", targetLang);
    formData.append("podcastMode", String(podcastMode));
    if (podcastMode) {
      formData.append("podcastTone", podcastTone);
      formData.append("podcastSpeakerCount", String(podcastSpeakerCount));
    }
    if (userTranscript.trim()) {
      formData.append("userTranscript", userTranscript.trim());
    }
    if (effectiveSkipTranslation) {
      formData.append("skipTranslation", "true");
    }
    formData.append("llmConfig", JSON.stringify(buildLlmConfig(settings)));
    formData.append("transcriptionConfig", JSON.stringify(buildTaskConfig(settings, "transcription")));
    formData.append("ttsConfig", JSON.stringify(buildTaskConfig(settings, "tts")));

    const response = await fetch("/api/process-file", {
      method: "POST",
      body: formData,
      signal,
    });

    if (!response.ok) {
      throw new Error("Erreur serveur. Vérifiez que le backend est lancé.");
    }

    await readSSEStream(response, handleSSEEvent);
  }, [
    targetLang,
    podcastMode,
    podcastTone,
    podcastSpeakerCount,
    userTranscript,
    skipTranslation,
    resolveEffectiveMode,
    isSameLang,
    settings,
  ]);

  const handleProcess = async () => {
    if (inputMode === "url" && !youtubeUrl) {
      toast.error("Veuillez coller un lien YouTube");
      return;
    }
    if (inputMode === "file" && selectedFiles.length === 0) {
      toast.error("Veuillez ajouter un fichier");
      return;
    }
    if (inputMode === "text" && !pastedText.trim()) {
      toast.error("Veuillez coller du texte");
      return;
    }

    // Reset state
    setIsProcessing(true);
    resetResultState();
    setQueueFiles([]);
    setQueueIndex(0);
    setQueueCompleted(0);
    setQueueAudioUrls([]);
    setCombinedAudioUrl("");

    abortRef.current = new AbortController();

    if (inputMode === "text") {
      // Direct text mode
      const effectiveTextSkipTranslation =
        resolveEffectiveMode("text") === "transcribe" || isSameLang;
      const baseSteps: ProcessingStep[] = [];
      if (!effectiveTextSkipTranslation) {
        baseSteps.push({ id: "translating", label: "Traduction", status: "pending" });
      }
      if (podcastMode) {
        baseSteps.push(
          { id: "podcast_script", label: "Génération du script podcast", status: "pending" },
          { id: "podcast_tts", label: "Génération de l’audio podcast", status: "pending" },
        );
      } else {
        baseSteps.push({ id: "tts", label: "Génération de l’audio", status: "pending" });
      }
      setSteps(baseSteps);

      try {
        const response = await fetch("/api/process-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: pastedText,
            targetLanguage: targetLang,
            podcastMode,
            skipTranslation: effectiveTextSkipTranslation,
            podcastTone,
            podcastSpeakerCount,
            llmConfig: buildLlmConfig(settings),
            ttsConfig: buildTaskConfig(settings, "tts"),
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Erreur serveur. Vérifiez que le backend est lancé.");
        }

        await readSSEStream(response, handleSSEEvent);
      } catch (error: any) {
        const msg = describeStreamError(error);
        if (msg) {
          setErrorMessage(msg);
          setSteps((prev) =>
            prev.map((s) =>
              s.status === "active" || s.status === "pending"
                ? { ...s, status: "error" }
                : s
            )
          );
          if (error?.cause === "connection-lost") setInterrupted(true);
          toast.error(msg);
        }
      } finally {
        setIsProcessing(false);
        setIsTtsStreaming(false);
      }
    } else if (inputMode === "url") {
      // YouTube mode
      const youtubeEffectiveMode = resolveEffectiveMode("youtube");
      const youtubeSkipTranslation =
        youtubeEffectiveMode === "transcribe" || isSameLang;
      const baseSteps: ProcessingStep[] = [
        { id: "download", label: "Extraction audio YouTube", status: "pending" },
        { id: "transcript", label: "Transcription Whisper IA", status: "pending" },
      ];
      if (!youtubeSkipTranslation) {
        baseSteps.push({ id: "translating", label: "Traduction", status: "pending" });
      }
      if (podcastMode) {
        baseSteps.push(
          { id: "podcast_script", label: "Génération du script podcast", status: "pending" },
          { id: "podcast_tts", label: "Génération de l’audio podcast", status: "pending" },
        );
      } else {
        baseSteps.push({ id: "tts", label: "Génération de l’audio", status: "pending" });
      }
      setSteps(baseSteps);

      try {
        const response = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: youtubeUrl,
            targetLanguage: targetLang,
            podcastMode,
            podcastTone,
            podcastSpeakerCount,
            skipTranslation: youtubeSkipTranslation,
            llmConfig: buildLlmConfig(settings),
            transcriptionConfig: buildTaskConfig(settings, "transcription"),
            ttsConfig: buildTaskConfig(settings, "tts"),
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Erreur serveur. Vérifiez que le backend est lancé.");
        }

        await readSSEStream(response, handleSSEEvent);
      } catch (error: any) {
        const msg = describeStreamError(error);
        if (msg) {
          setErrorMessage(msg);
          setSteps((prev) =>
            prev.map((s) =>
              s.status === "active" || s.status === "pending"
                ? { ...s, status: "error" }
                : s
            )
          );
          if (error?.cause === "connection-lost") setInterrupted(true);
          toast.error(msg);
        }
      } finally {
        setIsProcessing(false);
        setIsTtsStreaming(false);
      }
    } else {
      // File mode: auto-split large PDFs into a SEPARATE processing queue,
      // without replacing the user's original files (so they stay visible).
      const expandedFiles = await splitPdfsInQueue(selectedFiles);
      setQueueFiles(expandedFiles);
      await processFileQueue(0, expandedFiles);
    }
  };

  const processFileQueue = async (startIndex: number, filesToProcess: File[] = selectedFiles) => {
    for (let i = startIndex; i < filesToProcess.length; i++) {
      setQueueIndex(i);
      resetResultState();
      lastAudioUrlRef.current = "";
      setIsProcessing(true);

      if (!abortRef.current || abortRef.current.signal.aborted) {
        abortRef.current = new AbortController();
      }

      let hadError = false;
      try {
        await processFile(filesToProcess[i], abortRef.current.signal);
        // Capture this item's final audio so the whole document can be recomposed later.
        if (lastAudioUrlRef.current) {
          const itemUrl = lastAudioUrlRef.current;
          const itemName = filesToProcess[i].name;
          setQueueAudioUrls((prev) => [...prev, { fileName: itemName, audioUrl: itemUrl }]);
        }
      } catch (error: any) {
        hadError = true;
        const msg = describeStreamError(error);
        if (!msg) return; // cancelled by user → stop the queue
        setErrorMessage(msg);
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" || s.status === "pending"
              ? { ...s, status: "error" }
              : s
          )
        );
        if (error?.cause === "connection-lost") setInterrupted(true);
        toast.error(msg);
      }

      setIsProcessing(false);
      setIsTtsStreaming(false);

      // Ne compter que les fichiers réellement traités avec succès.
      if (!hadError) setQueueCompleted((prev) => Math.max(prev, i + 1));

      // If there are more files, wait for user to proceed
      if (i < filesToProcess.length - 1) {
        setWaitingForNext(true);
        // Wait for user to click "Next"
        await new Promise<void>((resolve) => {
          nextResolveRef.current = resolve;
        });
        nextResolveRef.current = null;
        setWaitingForNext(false);
      }
    }
  };

  const nextResolveRef = useRef<(() => void) | null>(null);

  const handleNextFile = () => {
    if (nextResolveRef.current) {
      nextResolveRef.current();
    }
  };

  const handleSSEEvent = (data: any) => {
    switch (data.step) {
      // YouTube-specific steps
      case "download":
        setSteps((prev) =>
          prev.map((s) => (s.id === "download" ? { ...s, status: "active" } : s))
        );
        break;
      case "download_done":
        setSteps((prev) =>
          prev.map((s) => (s.id === "download" ? { ...s, status: "done" } : s))
        );
        break;
      case "transcript":
        setSteps((prev) =>
          prev.map((s) => (s.id === "transcript" ? { ...s, status: "active" } : s))
        );
        break;
      case "transcript_done":
        if (!resumingRef.current) setTranscription(data.data.transcript);
        setSteps((prev) =>
          prev.map((s) => (s.id === "transcript" ? { ...s, status: "done" } : s))
        );
        break;

      // File-specific steps
      case "extract":
        setSteps((prev) =>
          prev.map((s) => (s.id === "extract" ? { ...s, status: "active" } : s))
        );
        break;
      case "extract_done":
        if (!resumingRef.current) setTranscription(data.data.text);
        setSteps((prev) =>
          prev.map((s) => (s.id === "extract" ? { ...s, status: "done" } : s))
        );
        break;

      // Language detection
      case "detecting_language":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "translating" ? { ...s, status: "active", label: "Détection de la langue…" } : s
          )
        );
        break;
      case "language_detected":
        break;
      case "translation_skipped":
        toast.info(data.data.message);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "translating"
              ? { ...s, status: "done", label: `Traduction ignorée (déjà en ${data.data.detectedLang})` }
              : s
          )
        );
        break;

      // Shared steps
      case "translating":
        setSteps((prev) =>
          prev.map((s) => (s.id === "translating" ? { ...s, status: "active" } : s))
        );
        break;
      case "translating_progress":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "translating" ? { ...s, progress: data.data.progress } : s
          )
        );
        break;
      case "translating_provider_switch":
        toast.info(`Limite atteinte sur ${data.data.from}, basculement vers ${data.data.to}`);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "translating"
              ? { ...s, label: `Traduction (${data.data.to})` }
              : s
          )
        );
        break;
      case "translating_partial":
        setTranslation(data.data.translatedText);
        toast.warning(`Traduction partielle : ${data.data.completedChunks}/${data.data.totalChunks} blocs traduits`);
        break;
      case "translation_done":
        setTranslation(data.data.translatedText);
        setSteps((prev) =>
          prev.map((s) => (s.id === "translating" ? { ...s, status: "done" } : s))
        );
        break;
      case "tts":
        setIsTtsStreaming(true);
        setSteps((prev) =>
          prev.map((s) => (s.id === "tts" ? { ...s, status: "active" } : s))
        );
        break;
      case "audio_chunk":
        setAudioChunks((prev) => [...prev, data.data.audioUrl]);
        break;
      case "tts_progress":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "tts" ? { ...s, progress: data.data.progress } : s
          )
        );
        break;

      case "tts_partial_error":
        // TTS failed mid-generation but we have partial audio
        setIsTtsStreaming(false);
        if (data.data.audioUrl) {
          setAudioUrl(data.data.audioUrl);
          lastAudioUrlRef.current = data.data.audioUrl;
        }
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "tts"
              ? { ...s, status: "error", label: `Audio partiel (${data.data.generatedChunks} chunk${data.data.generatedChunks > 1 ? 's' : ''})` }
              : s
          )
        );
        toast.warning(data.data.message);
        break;

      // Podcast-specific steps
      case "podcast_script":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "podcast_script" ? { ...s, status: "active" } : s
          )
        );
        break;
      case "podcast_script_done":
        setPodcastScript(data.data.script);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "podcast_script" ? { ...s, status: "done" } : s
          )
        );
        break;
      case "podcast_tts":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "podcast_tts" ? { ...s, status: "active" } : s
          )
        );
        break;
      case "podcast_tts_progress":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "podcast_tts"
              ? { ...s, progress: data.data.progress }
              : s
          )
        );
        break;
      case "podcast_tts_done":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "podcast_tts" ? { ...s, status: "done" } : s
          )
        );
        break;

      case "done":
        if (data.data.audioUrl) {
          setAudioUrl(data.data.audioUrl);
          lastAudioUrlRef.current = data.data.audioUrl;
        }
        setIsTtsStreaming(false);
        if (data.data.videoId) setVideoId(data.data.videoId);
        if (data.data.localVideoUrl) setLocalVideoUrl(data.data.localVideoUrl);
        if (data.data.translatedText) setTranslation(data.data.translatedText);
        if (!resumingRef.current && data.data.transcript) setTranscription(data.data.transcript);
        if (data.data.speechStartOffset) setSpeechStartOffset(data.data.speechStartOffset);
        setSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
        toast.success("Traitement terminé !");
        break;
      case "error":
        setErrorMessage(data.message);
        setIsTtsStreaming(false);
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" ? { ...s, status: "error" } : s
          )
        );
        toast.error(data.message);
        setIsProcessing(false);
        break;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    nextResolveRef.current?.();
    setIsProcessing(false);
    setIsTtsStreaming(false);
    setWaitingForNext(false);
    setSteps([]);
    toast.info("Traitement annule");
  };

  const handleDownloadVideo = async () => {
    if (!audioUrl) return;
    if (!videoId && !localVideoUrl) return;

    setIsDownloadingVideo(true);
    toast.info("Fusion video + audio traduit en cours...");

    try {
      let response: Response;

      if (localVideoUrl) {
        // Local uploaded video
        response = await fetch("/api/merge-local-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localVideoUrl, audioUrl, targetLanguage: targetLang, speechStartOffset }),
        });
      } else {
        // YouTube video
        response = await fetch("/api/merge-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId, audioUrl, targetLanguage: targetLang, speechStartOffset }),
        });
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erreur lors de la fusion video");
      }

      const a = document.createElement("a");
      a.href = result.videoUrl;
      a.download = localVideoUrl
        ? `video_traduite_${Date.now()}.mp4`
        : `${videoId}_traduit.mp4`;
      a.click();

      toast.success(`Video traduite prete (${result.fileSize})`);
    } catch (error: any) {
      toast.error(error.message || "Erreur lors du telechargement video");
    } finally {
      setIsDownloadingVideo(false);
    }
  };

  const handleGeneratePodcast = async () => {
    if (!translation) return;

    setIsProcessing(true);
    setAudioUrl("");
    setAudioChunks([]);
    setCoverImageUrl("");
    setPodcastScript("");
    setErrorMessage("");

    setSteps([
      { id: "podcast_script", label: "Génération du script podcast", status: "pending" },
      { id: "podcast_tts", label: "Génération de l’audio podcast", status: "pending" },
    ]);

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/generate-podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translatedText: translation,
          podcastTone,
          podcastSpeakerCount,
          llmConfig: buildLlmConfig(settings),
          ttsConfig: buildTaskConfig(settings, "tts"),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Erreur serveur.");
      }

      await readSSEStream(response, handleSSEEvent);
    } catch (error: any) {
      const msg = describeStreamError(error);
      if (msg) {
        setErrorMessage(msg);
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" || s.status === "pending"
              ? { ...s, status: "error" }
              : s
          )
        );
        if (error?.cause === "connection-lost") setInterrupted(true);
        toast.error(msg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Resume audio generation from the already-available text (no file needed).
  // Used after a sleep/reload interruption. If a translation already exists we
  // re-run TTS only; otherwise we translate the original text first. Either way
  // no file re-upload is needed — we go through /api/process-text.
  const handleResume = async () => {
    const hasTranslation = translation.trim().length > 0;
    const text = hasTranslation ? translation : transcription;
    if (!text.trim()) {
      toast.error("Aucun texte a reprendre");
      return;
    }
    setInterrupted(false);
    setIsProcessing(true);
    setAudioUrl("");
    setAudioChunks([]);
    setCoverImageUrl("");
    setErrorMessage("");
    abortRef.current = new AbortController();
    resumingRef.current = true;

    if (podcastMode) {
      setSteps([
        { id: "podcast_script", label: "Génération du script podcast", status: "pending" },
        { id: "podcast_tts", label: "Génération de l’audio podcast", status: "pending" },
      ]);
    } else {
      setSteps([{ id: "tts", label: "Génération de l’audio", status: "pending" }]);
    }

    try {
      const response = podcastMode
        ? await fetch("/api/generate-podcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              translatedText: text,
              podcastTone,
              podcastSpeakerCount,
              llmConfig: buildLlmConfig(settings),
              ttsConfig: buildTaskConfig(settings, "tts"),
            }),
            signal: abortRef.current.signal,
          })
        : await fetch("/api/process-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              targetLanguage: targetLang,
              podcastMode: false,
              skipTranslation: hasTranslation,
              llmConfig: buildLlmConfig(settings),
              ttsConfig: buildTaskConfig(settings, "tts"),
            }),
            signal: abortRef.current.signal,
          });

      if (!response.ok) {
        throw new Error("Erreur serveur. Vérifiez que le backend est lancé.");
      }
      await readSSEStream(response, handleSSEEvent);
    } catch (error) {
      const msg = describeStreamError(error);
      if (msg) {
        setErrorMessage(msg);
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" || s.status === "pending"
              ? { ...s, status: "error" }
              : s
          )
        );
        if ((error as { cause?: string })?.cause === "connection-lost")
          setInterrupted(true);
        toast.error(msg);
      }
    } finally {
      setIsProcessing(false);
      setIsTtsStreaming(false);
      resumingRef.current = false;
    }
  };

  const handleSummarize = async () => {
    const textToSummarize = transcription || translation;
    if (!textToSummarize) return;

    setIsSummarizing(true);
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSummarize, language: targetLang, llmConfig: buildLlmConfig(settings) }),
      });

      if (!response.ok) {
        throw new Error("Erreur lors du résumé");
      }

      const data = await response.json();
      setSummary(data.summary);
      toast.success("Résumé généré !");
    } catch (error: any) {
      toast.error(error.message || "Erreur lors du résumé");
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleFilesSelect = (newFiles: File[]) => {
    setSelectedFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearFiles = () => {
    setSelectedFiles([]);
    setQueueFiles([]);
    setQueueAudioUrls([]);
    setCombinedAudioUrl("");
    setUserTranscript("");
    setSkipTranslation(false);
    setInterrupted(false);
    clearSession();
  };

  // Recompose one full audio from every queue item's audio (server-side ffmpeg merge).
  const handleCombineChunks = async () => {
    if (queueAudioUrls.length < 2) return;
    setIsCombining(true);
    try {
      const baseName = selectedFiles[0]?.name?.replace(/\.[^.]+$/, "") || "document";
      const response = await fetch("/api/combine-chunks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrls: queueAudioUrls.map((q) => q.audioUrl),
          fileName: baseName,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Erreur lors de la recomposition de l'audio");
      }
      const data = await response.json();
      setCombinedAudioUrl(data.audioUrl);
      toast.success(`Audio complet recomposé (${data.partCount} parties, ${data.fileSize})`);
    } catch (error: any) {
      toast.error(error.message || "Erreur lors de la recomposition de l'audio");
    } finally {
      setIsCombining(false);
    }
  };

  const previewVideoId =
    inputMode === "url" && youtubeUrl ? extractVideoId(youtubeUrl) : null;
  const displayVideoId = videoId || previewVideoId;

  const showAudioPlayer = audioChunks.length > 0 || audioUrl;

  const saveTitle =
    inputMode === "url"
      ? `YouTube - ${videoId || youtubeUrl}`
      : inputMode === "text"
      ? `Texte - ${pastedText.slice(0, 30).trim()}...`
      : currentFile?.name || "Document";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-teal flex items-center justify-center">
              <Languages className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-foreground">
                Vocaleez
              </h1>
              <p className="text-xs text-muted-foreground">
                Transcription & Traduction IA
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-3"
        >
          <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground">
            Transcrivez & Traduisez
            <span className="text-primary"> instantanement</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Collez un lien YouTube ou importez un ou plusieurs fichiers (video, audio, PDF, Word) pour
            obtenir la traduction audio dans la langue de votre choix.
          </p>
        </motion.section>

        {/* Input Section */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-6 space-y-6"
        >
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setInputMode("file")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                inputMode === "file"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileAudio className="w-4 h-4" />
              Fichier
            </button>
            <button
              onClick={() => setInputMode("url")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                inputMode === "url"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Video className="w-4 h-4" />
              Lien YouTube
            </button>
            <button
              onClick={() => setInputMode("text")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                inputMode === "text"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Type className="w-4 h-4" />
              Texte
            </button>
            <button
              onClick={() => setInputMode("combine")}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                inputMode === "combine"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Music className="w-4 h-4" />
              Combiner Audios
            </button>
          </div>

          {/* Combine mode */}
          {inputMode === "combine" ? (
            <AudioCombiner />
          ) : null}

          {/* File or URL input */}
          {inputMode === "file" ? (
            <div className="space-y-4">
              <FileDropZone
                onFilesSelect={handleFilesSelect}
                selectedFiles={selectedFiles}
                onClear={handleClearFiles}
                onRemoveFile={handleRemoveFile}
                acceptTypes="all"
                disabled={isProcessing || waitingForNext}
              />

            </div>
          ) : inputMode === "text" ? (
            <div className="space-y-3">
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Collez votre texte ici pour le traduire et générer l'audio…"
                rows={8}
                disabled={isProcessing}
                className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y disabled:opacity-50"
              />
              {pastedText.trim() && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {pastedText.trim().length} caracteres
                  </span>
                </div>
              )}
            </div>
          ) : inputMode === "url" ? (
            <div className="relative">
              <Link className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                disabled={isProcessing}
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all disabled:opacity-50"
              />
            </div>
          ) : null}

          {/* Language Selectors */}
          {inputMode !== "combine" && (
            <>
              <div className="flex items-end gap-3">
                <LanguageSelector
                  label="Langue source"
                  value={sourceLang}
                  onChange={setSourceLang}
                  showAuto
                />
                <button className="p-3 rounded-lg bg-muted text-muted-foreground hover:text-primary transition-colors mb-0.5">
                  <ArrowRightLeft className="w-5 h-5" />
                </button>
                <LanguageSelector
                  label="Langue cible"
                  value={targetLang}
                  onChange={setTargetLang}
                />
              </div>

              {/* Process Mode */}
              {!isSameLang && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Operations</p>
                  <div className="flex gap-2">
                    {([
                      { value: "transcribe" as const, label: "Transcrire" },
                      { value: "translate" as const, label: "Traduire" },
                      { value: "both" as const, label: "Les deux" },
                    ]).map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() =>
                          setProcessMode((prev) => (prev === value ? null : value))
                        }
                        disabled={isProcessing}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          processMode === value
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        } disabled:opacity-50`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Podcast Options (visible when generationMode === "podcast") */}
              <div className="space-y-3">
                {podcastMode && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      Podcast {podcastSpeakerCount} voix, ton {podcastTone === "formal" ? "formel" : podcastTone === "humorous" ? "humoristique" : "decontracte"}
                    </span>
                  </div>
                )}

                {podcastMode && (
                  <div className="p-4 rounded-xl bg-muted/50 border border-border/50 space-y-4">
                    {/* Speaker Count */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Users className="w-4 h-4 text-primary" />
                        Nombre de voix
                      </label>
                      <div className="flex gap-2">
                        {([2, 3, 4] as const).map((count) => (
                          <button
                            key={count}
                            onClick={() => setPodcastSpeakerCount(count)}
                            disabled={isProcessing}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              podcastSpeakerCount === count
                                ? "bg-primary text-primary-foreground"
                                : "bg-background border border-border text-muted-foreground hover:text-foreground"
                            } disabled:opacity-50`}
                          >
                            {count} voix
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tone */}
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <MessageSquare className="w-4 h-4 text-primary" />
                        Ton du podcast
                      </label>
                      <div className="flex gap-2">
                        {([
                          { value: "formal" as const, label: "Formel" },
                          { value: "casual" as const, label: "Décontracté" },
                          { value: "humorous" as const, label: "Humoristique" },
                        ]).map(({ value, label }) => (
                          <button
                            key={value}
                            onClick={() => setPodcastTone(value)}
                            disabled={isProcessing}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              podcastTone === value
                                ? "bg-primary text-primary-foreground"
                                : "bg-background border border-border text-muted-foreground hover:text-foreground"
                            } disabled:opacity-50`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Button */}
              {isProcessing ? (
                <button
                  onClick={handleCancel}
                  className="w-full py-4 rounded-xl bg-destructive text-destructive-foreground font-display font-semibold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2"
                >
                  <XCircle className="w-5 h-5" />
                  Annuler le traitement
                </button>
              ) : !waitingForNext ? (
                <div className="flex w-full rounded-xl overflow-hidden">
                  <button
                    onClick={handleProcess}
                    disabled={
                      (inputMode === "file" && selectedFiles.length === 0) ||
                      (inputMode === "text" && !pastedText.trim())
                    }
                    className="flex-1 py-4 bg-primary text-primary-foreground font-display font-semibold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {podcastMode ? <Radio className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    {podcastMode
                      ? "Générer le podcast"
                      : inputMode === "file" && selectedFiles.length > 1
                      ? `Générer l'audio (${selectedFiles.length} fichiers)`
                      : "Générer l'audio"}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={isProcessing}
                        aria-label="Choisir le type de generation"
                        className="px-3 bg-primary text-primary-foreground border-l border-primary-foreground/20 hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center"
                      >
                        <ChevronDown className="w-5 h-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup
                        value={generationMode}
                        onValueChange={(v) =>
                          setGenerationMode(v as "audio" | "podcast")
                        }
                      >
                        <DropdownMenuRadioItem value="audio">
                          <Mic className="w-4 h-4 mr-2" /> Audio
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="podcast">
                          <Radio className="w-4 h-4 mr-2" /> Podcast
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </>
          )}
        </motion.section>

        {/* Queue Progress Bar */}
        <AnimatePresence>
          {isQueueMode && (isProcessing || waitingForNext || queueCompleted > 0) && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="glass-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground">
                  File d'attente
                </p>
                <p className="text-sm text-muted-foreground">
                  {Math.min(queueIndex + 1, processingQueue.length)} / {processingQueue.length}
                </p>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(queueCompleted / processingQueue.length) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {processingQueue.map((file, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2 py-1 rounded-md ${
                      i < queueCompleted
                        ? "bg-primary/20 text-primary"
                        : i === queueIndex
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {file.name.length > 20 ? file.name.slice(0, 17) + "..." : file.name}
                  </span>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Recompose full audio from all queue parts. Not gated on `isQueueMode`
            so it also shows after a reload, where the (unserializable) File queue
            is gone but `queueAudioUrls` was restored from the session snapshot. */}
        <AnimatePresence>
          {!isProcessing &&
            !waitingForNext &&
            queueAudioUrls.length >= 2 &&
            !combinedAudioUrl && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="glass-card p-4 border border-primary/30"
              >
                <p className="text-sm text-foreground mb-1 flex items-center gap-2">
                  <Music className="w-4 h-4 text-primary" />
                  Recomposer l'audio complet
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Assemble les {queueAudioUrls.length} parties générées en un seul fichier audio téléchargeable.
                </p>
                <button
                  onClick={handleCombineChunks}
                  disabled={isCombining}
                  className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isCombining ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Assemblage en cours...
                    </>
                  ) : (
                    <>
                      <Music className="w-4 h-4" />
                      Recomposer l'audio complet ({queueAudioUrls.length} parties)
                    </>
                  )}
                </button>
              </motion.section>
            )}
        </AnimatePresence>

        {/* Recomposed full audio player */}
        <AnimatePresence>
          {combinedAudioUrl && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AudioPlayer
                audioUrl={combinedAudioUrl}
                title="Audio complet recomposé"
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Current file being processed */}
        <AnimatePresence>
          {isQueueMode && (isProcessing || waitingForNext) && currentFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <p className="text-sm text-muted-foreground">
                Traitement en cours : <strong className="text-foreground">{currentFile.name}</strong>
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Resume banner after an interrupted generation (sleep / reload) */}
        <AnimatePresence>
          {interrupted && !isProcessing && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="glass-card p-4 border border-primary/30"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Génération interrompue
                    </p>
                    <p className="text-sm text-muted-foreground">
                      La génération a été interrompue (mise en veille ?). Vos
                      textes sont conservés — vous pouvez reprendre sans
                      réimporter de fichier.
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleResume}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all"
                    >
                      <Mic className="w-4 h-4" />
                      Reprendre la génération audio
                    </button>
                    <button
                      onClick={() => {
                        setInterrupted(false);
                        clearSession();
                      }}
                      className="px-4 py-2 rounded-lg bg-muted text-muted-foreground font-medium text-sm hover:text-foreground transition-all"
                    >
                      Ignorer
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Processing Steps */}
        <AnimatePresence>
          {steps.length > 0 && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="glass-card p-6"
            >
              <h3 className="font-display font-semibold text-foreground mb-4">
                Progression
              </h3>
              <div className="space-y-3">
                {steps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3">
                    {step.status === "done" && (
                      <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
                    )}
                    {step.status === "active" && (
                      <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
                    )}
                    {step.status === "pending" && (
                      <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                    )}
                    {step.status === "error" && (
                      <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <span
                        className={`text-sm ${
                          step.status === "active"
                            ? "text-foreground font-medium"
                            : step.status === "done"
                            ? "text-muted-foreground"
                            : step.status === "error"
                            ? "text-destructive"
                            : "text-muted-foreground/50"
                        }`}
                      >
                        {step.label}
                        {step.progress !== undefined &&
                          step.status === "active" && (
                            <span className="text-primary ml-2">
                              {step.progress}%
                            </span>
                          )}
                      </span>
                      {step.status === "active" &&
                        step.progress !== undefined && (
                          <div className="mt-1 w-full h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-300"
                              style={{ width: `${step.progress}%` }}
                            />
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
              {errorMessage && (
                <p className="text-sm text-destructive mt-4 p-3 bg-destructive/10 rounded-lg">
                  {errorMessage}
                </p>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Video Player: YouTube or Local */}
        <AnimatePresence>
          {displayVideoId && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <YouTubePlayer videoId={displayVideoId} />
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {localVideoUrl && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <LocalVideoPlayer
                videoUrl={localVideoUrl}
                translatedAudioUrl={audioUrl || undefined}
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Audio Player (show only when no local video — local video has built-in sync) */}
        <AnimatePresence>
          {showAudioPlayer && !localVideoUrl && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <AudioPlayer
                audioChunks={audioChunks}
                audioUrl={audioUrl || undefined}
                isStreaming={isTtsStreaming}
                coverImageUrl={coverImageUrl || undefined}
                title={
                  currentFile?.name
                    ? `${currentFile.name} — Audio traduit`
                    : "Audio traduit"
                }
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Save/Download + Next File buttons */}
        <AnimatePresence>
          {audioUrl && !isProcessing && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 flex-wrap"
            >
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex-1 min-w-[200px] py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <BookmarkPlus className="w-4 h-4" />
                Enregistrer / Telecharger
              </button>

              {/* Generate cover image button */}
              <button
                onClick={() => setShowCoverDialog(true)}
                className="flex-1 min-w-[200px] py-3 rounded-xl bg-muted border border-border text-foreground font-medium text-sm hover:bg-muted/80 transition-all flex items-center justify-center gap-2"
              >
                <ImageIcon className="w-4 h-4" />
                {coverImageUrl ? "Modifier la couverture" : "Générer une couverture"}
              </button>

              {/* Next file button in queue */}
              {waitingForNext && (
                <button
                  onClick={handleNextFile}
                  className="flex-1 min-w-[200px] py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 animate-pulse"
                >
                  <SkipForward className="w-4 h-4" />
                  Fichier suivant ({queueIndex + 2}/{processingQueue.length})
                </button>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Next file button even when no audio (error case) */}
        <AnimatePresence>
          {waitingForNext && !audioUrl && !isProcessing && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 flex-wrap"
            >
              <button
                onClick={handleNextFile}
                className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <SkipForward className="w-4 h-4" />
                Passer au fichier suivant ({queueIndex + 2}/{processingQueue.length})
              </button>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Results */}
        {(transcription || translation || isProcessing) && (
          <section className="grid md:grid-cols-2 gap-6">
            <ResultsPanel
              title={inputMode === "file" ? "Texte original" : "Transcription originale"}
              content={transcription}
              icon={<FileText className="w-5 h-5 text-teal-light" />}
              isLoading={isProcessing && !transcription}
            />
            <ResultsPanel
              title="Traduction"
              content={translation}
              icon={<Languages className="w-5 h-5 text-primary" />}
              isLoading={isProcessing && !translation}
            />
          </section>
        )}

        {/* Action buttons after transcription: Résumer + Generate Podcast */}
        {(transcription || translation) && !isProcessing && (
          <div className="flex justify-center gap-3 flex-wrap">
            {/* Résumer button */}
            {!summary && (
              <button
                onClick={handleSummarize}
                disabled={isSummarizing}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-muted border border-border text-foreground font-medium text-sm hover:bg-muted/80 transition-all disabled:opacity-50"
              >
                {isSummarizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <AlignLeft className="w-4 h-4" />
                )}
                {isSummarizing ? "Resume en cours..." : "Resumer"}
              </button>
            )}

            {/* Generate Podcast button */}
            {translation && !podcastScript && (
              <button
                onClick={handleGeneratePodcast}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all"
              >
                <Radio className="w-4 h-4" />
                Générer le podcast
              </button>
            )}
          </div>
        )}

        {/* Summary Panel */}
        {summary && (
          <section>
            <ResultsPanel
              title="Resume"
              content={summary}
              icon={<AlignLeft className="w-5 h-5 text-primary" />}
              isLoading={false}
            />
          </section>
        )}

        {/* Podcast Script */}
        {podcastScript && (
          <section>
            <ResultsPanel
              title="Script Podcast"
              content={podcastScript}
              icon={<Radio className="w-5 h-5 text-primary" />}
              isLoading={false}
            />
          </section>
        )}
      </main>

      {/* Save Dialog */}
      <SaveDialog
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        audioUrl={audioUrl}
        videoId={videoId || undefined}
        localVideoUrl={localVideoUrl || undefined}
        title={saveTitle}
        sourceType={inputMode === "url" ? "youtube" : "file"}
        youtubeUrl={inputMode === "url" ? youtubeUrl : undefined}
        transcription={transcription}
        translation={translation}
        targetLanguage={targetLang}
        coverImageUrl={coverImageUrl || undefined}
        onDownloadVideo={(videoId || localVideoUrl) ? handleDownloadVideo : undefined}
        isDownloadingVideo={isDownloadingVideo}
      />

      {/* Cover Dialog */}
      <CoverDialog
        open={showCoverDialog}
        onClose={() => setShowCoverDialog(false)}
        audioUrl={audioUrl}
        defaultTitle={saveTitle}
        contentHint={summary || translation || transcription || undefined}
        onGenerated={(url) => setCoverImageUrl(url)}
      />
    </div>
  );
};

export default Index;
