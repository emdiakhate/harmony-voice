import { useState, useRef } from "react";
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
} from "lucide-react";
import FileDropZone from "@/components/FileDropZone";
import LanguageSelector from "@/components/LanguageSelector";
import ResultsPanel from "@/components/ResultsPanel";
import YouTubePlayer from "@/components/YouTubePlayer";
import AudioPlayer from "@/components/AudioPlayer";
import { toast } from "sonner";

type InputMode = "file" | "url";

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
  const [steps, setSteps] = useState<ProcessingStep[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Podcast mode
  const [podcastMode, setPodcastMode] = useState(false);
  const [podcastScript, setPodcastScript] = useState("");

  // Video download state
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);

  const handleProcess = async () => {
    if (inputMode === "url" && !youtubeUrl) {
      toast.error("Veuillez coller un lien YouTube");
      return;
    }
    if (inputMode === "file" && !selectedFile) {
      toast.error("Veuillez ajouter un fichier");
      return;
    }

    // Reset state
    setIsProcessing(true);
    setTranscription("");
    setTranslation("");
    setAudioUrl("");
    setAudioChunks([]);
    setIsTtsStreaming(false);
    setErrorMessage("");
    setVideoId("");
    setPodcastScript("");

    // Different steps depending on mode
    if (inputMode === "url") {
      const baseSteps: ProcessingStep[] = [
        { id: "download", label: "Extraction audio YouTube", status: "pending" },
        { id: "transcript", label: "Transcription Whisper IA", status: "pending" },
        { id: "translating", label: "Traduction", status: "pending" },
      ];
      if (podcastMode) {
        baseSteps.push(
          { id: "podcast_script", label: "Génération script podcast", status: "pending" },
          { id: "podcast_tts", label: "Génération audio podcast", status: "pending" },
        );
      } else {
        baseSteps.push({ id: "tts", label: "Génération de l'audio", status: "pending" });
      }
      setSteps(baseSteps);
    } else {
      const baseSteps: ProcessingStep[] = [
        { id: "extract", label: "Extraction du texte", status: "pending" },
        { id: "translating", label: "Traduction", status: "pending" },
      ];
      if (podcastMode) {
        baseSteps.push(
          { id: "podcast_script", label: "Génération script podcast", status: "pending" },
          { id: "podcast_tts", label: "Génération audio podcast", status: "pending" },
        );
      } else {
        baseSteps.push({ id: "tts", label: "Génération de l'audio", status: "pending" });
      }
      setSteps(baseSteps);
    }

    abortRef.current = new AbortController();

    try {
      let response: Response;

      if (inputMode === "url") {
        // YouTube mode
        response = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: youtubeUrl, targetLanguage: targetLang, podcastMode }),
          signal: abortRef.current.signal,
        });
      } else {
        // File upload mode
        const formData = new FormData();
        formData.append("file", selectedFile!);
        formData.append("targetLanguage", targetLang);
        formData.append("podcastMode", String(podcastMode));

        response = await fetch("/api/process-file", {
          method: "POST",
          body: formData,
          signal: abortRef.current.signal,
        });
      }

      if (!response.ok) {
        throw new Error("Erreur serveur. Vérifiez que le backend est lancé.");
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
        setAudioUrl(data.data.audioUrl);
        setIsTtsStreaming(false);
        if (data.data.videoId) setVideoId(data.data.videoId);
        if (data.data.translatedText) setTranslation(data.data.translatedText);
        if (data.data.transcript) setTranscription(data.data.transcript);
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
    setIsProcessing(false);
    setIsTtsStreaming(false);
    setSteps([]);
    toast.info("Traitement annulé");
  };

  const handleDownloadVideo = async () => {
    if (!videoId || !audioUrl) return;

    setIsDownloadingVideo(true);
    toast.info("Téléchargement et fusion de la vidéo en cours...");

    try {
      const response = await fetch("/api/merge-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, audioUrl }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erreur lors de la fusion vidéo");
      }

      const a = document.createElement("a");
      a.href = result.videoUrl;
      a.download = `${videoId}_traduit.mp4`;
      a.click();

      toast.success(`Vidéo traduite prête (${result.fileSize})`);
    } catch (error: any) {
      toast.error(error.message || "Erreur lors du téléchargement vidéo");
    } finally {
      setIsDownloadingVideo(false);
    }
  };

  const previewVideoId =
    inputMode === "url" && youtubeUrl ? extractVideoId(youtubeUrl) : null;
  const displayVideoId = videoId || previewVideoId;

  const showAudioPlayer = audioChunks.length > 0 || audioUrl;

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
          <div className="flex items-center gap-2">
            <span className="text-xs text-primary font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Propulsé par l'IA
            </span>
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
            <span className="text-primary"> instantanément</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Collez un lien YouTube ou importez un document (PDF, Word) pour
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
              Document
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
          </div>

          {/* File or URL input */}
          {inputMode === "file" ? (
            <FileDropZone
              onFileSelect={setSelectedFile}
              selectedFile={selectedFile}
              onClear={() => setSelectedFile(null)}
            />
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
                Le contenu sera transformé en conversation podcast 2 speakers
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
          ) : (
            <button
              onClick={handleProcess}
              className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              <Mic className="w-5 h-5" />
              {inputMode === "file" ? "Traduire & Générer l'audio" : "Transcrire & Traduire"}
            </button>
          )}
        </motion.section>

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

        {/* Video + Audio Section (YouTube mode) */}
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

        {/* Audio Player (both modes) */}
        <AnimatePresence>
          {showAudioPlayer && (
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

              {/* Download buttons */}
              {audioUrl && (
                <div className="flex gap-3">
                  {/* Download MP3 */}
                  <a
                    href={audioUrl}
                    download="audio_traduit.mp3"
                    className="flex-1 py-3 rounded-xl bg-muted border border-border text-foreground font-medium text-sm hover:bg-muted/80 transition-all flex items-center justify-center gap-2"
                  >
                    <Music className="w-4 h-4" />
                    Télécharger l'audio (.mp3)
                  </a>

                  {/* Download translated video (YouTube mode only) */}
                  {videoId && (
                    <button
                      onClick={handleDownloadVideo}
                      disabled={isDownloadingVideo}
                      className="flex-1 py-3 rounded-xl bg-muted border border-border text-foreground font-medium text-sm hover:bg-muted/80 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isDownloadingVideo ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Fusion en cours...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          Télécharger la vidéo traduite (.mp4)
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
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
    </div>
  );
};

export default Index;
