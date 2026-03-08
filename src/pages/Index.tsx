import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileAudio,
  Link,
  ArrowRightLeft,
  Languages,
  FileText,
  Mic,
  Video,
  Sparkles,
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
} from "lucide-react";
import FileDropZone from "@/components/FileDropZone";
import LanguageSelector from "@/components/LanguageSelector";
import ResultsPanel from "@/components/ResultsPanel";
import YouTubePlayer from "@/components/YouTubePlayer";
import LocalVideoPlayer from "@/components/LocalVideoPlayer";
import AudioPlayer from "@/components/AudioPlayer";
import SaveDialog from "@/components/SaveDialog";
import UserMenu from "@/components/UserMenu";
import AudioCombiner from "@/components/AudioCombiner";
import PdfSplitter from "@/components/PdfSplitter";
import { toast } from "sonner";

type InputMode = "file" | "url" | "combine";

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

  if (buffer.startsWith("data: ")) {
    try {
      onEvent(JSON.parse(buffer.slice(6)));
    } catch {
      // Skip
    }
  }
}

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
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
  const abortRef = useRef<AbortController | null>(null);

  // Podcast mode
  const [podcastMode, setPodcastMode] = useState(false);
  const [podcastScript, setPodcastScript] = useState("");

  // Video download state
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);

  // Save dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Local video preview (uploaded video files)
  const [localVideoUrl, setLocalVideoUrl] = useState("");

  // Transcript-only mode: user provides their own transcript (already in target language)
  const [userTranscript, setUserTranscript] = useState("");
  const [skipTranslation, setSkipTranslation] = useState(false);

  // Multi-file queue
  const [queueIndex, setQueueIndex] = useState(0);
  const [waitingForNext, setWaitingForNext] = useState(false);
  const [queueCompleted, setQueueCompleted] = useState(0);

  const isQueueMode = inputMode === "file" && selectedFiles.length > 1;
  const currentFile = inputMode === "file" ? selectedFiles[queueIndex] : null;

  const resetResultState = useCallback(() => {
    setTranscription("");
    setTranslation("");
    setAudioUrl("");
    setAudioChunks([]);
    setIsTtsStreaming(false);
    setErrorMessage("");
    setVideoId("");
    setPodcastScript("");
    setShowSaveDialog(false);
    setLocalVideoUrl("");
    setSteps([]);
    setWaitingForNext(false);
  }, []);

  const processFile = useCallback(async (file: File, signal: AbortSignal) => {
    const isMedia = isMediaFile(file);
    const hasUserTranscript = userTranscript.trim().length > 0;
    const baseSteps: ProcessingStep[] = [];

    if (!hasUserTranscript) {
      if (isMedia) {
        baseSteps.push({ id: "transcript", label: "Transcription Whisper IA", status: "pending" });
      } else {
        baseSteps.push({ id: "extract", label: "Extraction du texte", status: "pending" });
      }
    }

    if (!skipTranslation) {
      baseSteps.push({ id: "translating", label: "Traduction", status: "pending" });
    }

    if (podcastMode) {
      baseSteps.push(
        { id: "podcast_script", label: "Generation script podcast", status: "pending" },
        { id: "podcast_tts", label: "Generation audio podcast", status: "pending" },
      );
    } else {
      baseSteps.push({ id: "tts", label: "Generation de l'audio", status: "pending" });
    }
    setSteps(baseSteps);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("targetLanguage", targetLang);
    formData.append("podcastMode", String(podcastMode));
    if (userTranscript.trim()) {
      formData.append("userTranscript", userTranscript.trim());
    }
    if (skipTranslation) {
      formData.append("skipTranslation", "true");
    }

    const response = await fetch("/api/process-file", {
      method: "POST",
      body: formData,
      signal,
    });

    if (!response.ok) {
      throw new Error("Erreur serveur. Verifiez que le backend est lance.");
    }

    await readSSEStream(response, handleSSEEvent);
  }, [targetLang, podcastMode, userTranscript, skipTranslation]);

  const handleProcess = async () => {
    if (inputMode === "url" && !youtubeUrl) {
      toast.error("Veuillez coller un lien YouTube");
      return;
    }
    if (inputMode === "file" && selectedFiles.length === 0) {
      toast.error("Veuillez ajouter un fichier");
      return;
    }

    // Reset state
    setIsProcessing(true);
    resetResultState();
    setQueueIndex(0);
    setQueueCompleted(0);

    abortRef.current = new AbortController();

    if (inputMode === "url") {
      // YouTube mode (unchanged)
      const baseSteps: ProcessingStep[] = [
        { id: "download", label: "Extraction audio YouTube", status: "pending" },
        { id: "transcript", label: "Transcription Whisper IA", status: "pending" },
        { id: "translating", label: "Traduction", status: "pending" },
      ];
      if (podcastMode) {
        baseSteps.push(
          { id: "podcast_script", label: "Generation script podcast", status: "pending" },
          { id: "podcast_tts", label: "Generation audio podcast", status: "pending" },
        );
      } else {
        baseSteps.push({ id: "tts", label: "Generation de l'audio", status: "pending" });
      }
      setSteps(baseSteps);

      try {
        const response = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: youtubeUrl, targetLanguage: targetLang, podcastMode }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Erreur serveur. Verifiez que le backend est lance.");
        }

        await readSSEStream(response, handleSSEEvent);
      } catch (error: any) {
        if (error.name !== "AbortError") {
          const msg = error.message?.includes("Failed to fetch")
            ? "Impossible de contacter le serveur. Lancez le backend avec: npm run dev:server"
            : error.message || "Erreur de connexion au serveur";
          setErrorMessage(msg);
          setSteps((prev) =>
            prev.map((s) =>
              s.status === "active" || s.status === "pending"
                ? { ...s, status: "error" }
                : s
            )
          );
          toast.error(msg);
        }
      } finally {
        setIsProcessing(false);
        setIsTtsStreaming(false);
      }
    } else {
      // File mode: process queue
      await processFileQueue(0);
    }
  };

  const processFileQueue = async (startIndex: number) => {
    for (let i = startIndex; i < selectedFiles.length; i++) {
      setQueueIndex(i);
      resetResultState();
      setIsProcessing(true);

      if (!abortRef.current || abortRef.current.signal.aborted) {
        abortRef.current = new AbortController();
      }

      try {
        await processFile(selectedFiles[i], abortRef.current.signal);
      } catch (error: any) {
        if (error.name === "AbortError") return;
        const msg = error.message?.includes("Failed to fetch")
          ? "Impossible de contacter le serveur. Lancez le backend avec: npm run dev:server"
          : error.message || "Erreur de connexion au serveur";
        setErrorMessage(msg);
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" || s.status === "pending"
              ? { ...s, status: "error" }
              : s
          )
        );
        toast.error(msg);
      }

      setIsProcessing(false);
      setIsTtsStreaming(false);

      // If there are more files, wait for user to proceed
      if (i < selectedFiles.length - 1) {
        setWaitingForNext(true);
        // Wait for user to click "Next"
        await new Promise<void>((resolve) => {
          nextResolveRef.current = resolve;
        });
        nextResolveRef.current = null;
        setWaitingForNext(false);
        setQueueCompleted(i + 1);
      } else {
        setQueueCompleted(i + 1);
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
        setTranscription(data.data.transcript);
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
        setTranscription(data.data.text);
        setSteps((prev) =>
          prev.map((s) => (s.id === "extract" ? { ...s, status: "done" } : s))
        );
        break;

      // Language detection
      case "detecting_language":
        setSteps((prev) =>
          prev.map((s) =>
            s.id === "translating" ? { ...s, status: "active", label: "Detection de la langue..." } : s
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
              ? { ...s, status: "done", label: `Traduction ignoree (deja en ${data.data.detectedLang})` }
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
        if (data.data.audioUrl) setAudioUrl(data.data.audioUrl);
        setIsTtsStreaming(false);
        if (data.data.videoId) setVideoId(data.data.videoId);
        if (data.data.localVideoUrl) setLocalVideoUrl(data.data.localVideoUrl);
        if (data.data.translatedText) setTranslation(data.data.translatedText);
        if (data.data.transcript) setTranscription(data.data.transcript);
        if (data.data.speechStartOffset) setSpeechStartOffset(data.data.speechStartOffset);
        setSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
        toast.success("Traitement termine !");
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
    setPodcastScript("");
    setErrorMessage("");

    setSteps([
      { id: "podcast_script", label: "Generation script podcast", status: "pending" },
      { id: "podcast_tts", label: "Generation audio podcast", status: "pending" },
    ]);

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/generate-podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translatedText: translation }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Erreur serveur.");
      }

      await readSSEStream(response, handleSSEEvent);
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const msg = error.message || "Erreur de connexion au serveur";
        setErrorMessage(msg);
        setSteps((prev) =>
          prev.map((s) =>
            s.status === "active" || s.status === "pending"
              ? { ...s, status: "error" }
              : s
          )
        );
        toast.error(msg);
      }
    } finally {
      setIsProcessing(false);
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
    setUserTranscript("");
    setSkipTranslation(false);
  };

  const previewVideoId =
    inputMode === "url" && youtubeUrl ? extractVideoId(youtubeUrl) : null;
  const displayVideoId = videoId || previewVideoId;

  const showAudioPlayer = audioChunks.length > 0 || audioUrl;

  const saveTitle =
    inputMode === "url"
      ? `YouTube - ${videoId || youtubeUrl}`
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
                VoxTranslate
              </h1>
              <p className="text-xs text-muted-foreground">
                Transcription & Traduction IA
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-primary font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Propulse par l'IA
            </span>
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

              {/* PDF auto-split */}
              {!isProcessing && !waitingForNext && (
                <PdfSplitter
                  onChunksReady={(chunks) => {
                    setSelectedFiles((prev) => [...prev, ...chunks]);
                  }}
                  disabled={isProcessing}
                />
              )}

              {/* Transcript-only mode: show when a single file is selected */}
              {selectedFiles.length === 1 && (
                <div className="space-y-3 p-4 rounded-xl bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      Transcription manuelle
                    </span>
                    <span className="text-xs text-muted-foreground">
                      (optionnel - economise les tokens)
                    </span>
                  </div>
                  <textarea
                    value={userTranscript}
                    onChange={(e) => setUserTranscript(e.target.value)}
                    placeholder="Collez ici la transcription du fichier si vous l'avez deja..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                  />
                  {userTranscript.trim() && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipTranslation}
                        onChange={(e) => setSkipTranslation(e.target.checked)}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                      />
                      <span className="text-sm text-foreground">
                        La transcription est deja en{" "}
                        <strong className="text-primary">
                          {targetLang === "fr" ? "francais" : targetLang === "en" ? "anglais" : targetLang}
                        </strong>{" "}
                        — ne pas traduire, generer directement l'audio
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>
          ) : (
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
          )}

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

              {/* Podcast Mode Toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPodcastMode(!podcastMode)}
                  disabled={isProcessing}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    podcastMode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  } disabled:opacity-50`}
                >
                  <Radio className="w-4 h-4" />
                  Mode Podcast
                </button>
                {podcastMode && (
                  <span className="text-xs text-muted-foreground">
                    Le contenu sera transforme en conversation podcast 2 speakers
                  </span>
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
                <button
                  onClick={handleProcess}
                  disabled={inputMode === "file" && selectedFiles.length === 0}
                  className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Mic className="w-5 h-5" />
                  {skipTranslation
                    ? "Generer l'audio"
                    : inputMode === "file"
                    ? selectedFiles.length > 1
                      ? `Traduire ${selectedFiles.length} fichiers`
                      : "Traduire & Generer l'audio"
                    : "Transcrire & Traduire"}
                </button>
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
                  {Math.min(queueIndex + 1, selectedFiles.length)} / {selectedFiles.length}
                </p>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(queueCompleted / selectedFiles.length) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedFiles.map((file, i) => (
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
                title="Audio traduit"
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

              {/* Next file button in queue */}
              {waitingForNext && (
                <button
                  onClick={handleNextFile}
                  className="flex-1 min-w-[200px] py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 animate-pulse"
                >
                  <SkipForward className="w-4 h-4" />
                  Fichier suivant ({queueIndex + 2}/{selectedFiles.length})
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
                Passer au fichier suivant ({queueIndex + 2}/{selectedFiles.length})
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

        {/* Generate Podcast button (when translation exists and not already in podcast) */}
        {translation && !isProcessing && !podcastScript && (
          <div className="flex justify-center">
            <button
              onClick={handleGeneratePodcast}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all"
            >
              <Radio className="w-4 h-4" />
              Generer le Podcast a partir de la traduction
            </button>
          </div>
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
        onDownloadVideo={(videoId || localVideoUrl) ? handleDownloadVideo : undefined}
        isDownloadingVideo={isDownloadingVideo}
      />
    </div>
  );
};

export default Index;
