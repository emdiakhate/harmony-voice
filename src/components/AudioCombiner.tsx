import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  Music,
  Plus,
  Trash2,
  GripVertical,
  Loader2,
  Download,
  Merge,
  X,
  Gauge,
  Volume2,
  Timer,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

interface AudioFile {
  id: string;
  file: File;
  name: string;
  size: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const AUDIO_ACCEPT = ".mp3,.wav,.ogg,.m4a,.flac,.aac,.webm";

const SPEED_PRESETS = [
  { label: "0.75x", value: 0.75 },
  { label: "1x", value: 1.0 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
  { label: "2x", value: 2.0 },
];

const AudioCombiner = () => {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [isCombining, setIsCombining] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resultSize, setResultSize] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ffmpeg options
  const [showOptions, setShowOptions] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [normalize, setNormalize] = useState(false);
  const [silenceGap, setSilenceGap] = useState(0);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const audioFiles: AudioFile[] = [];
    for (const file of Array.from(newFiles)) {
      if (
        !file.type.startsWith("audio/") &&
        !AUDIO_ACCEPT.split(",").some((ext) =>
          file.name.toLowerCase().endsWith(ext)
        )
      ) {
        toast.error(`${file.name} n'est pas un fichier audio`);
        continue;
      }
      audioFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: formatSize(file.size),
      });
    }
    if (audioFiles.length > 0) {
      setFiles((prev) => [...prev, ...audioFiles]);
      setResultUrl("");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setResultUrl("");
  };

  const clearAll = () => {
    setFiles([]);
    setResultUrl("");
  };

  const handleCombine = async () => {
    if (files.length < 2) {
      toast.error("Ajoutez au moins 2 fichiers audio");
      return;
    }

    setIsCombining(true);
    setResultUrl("");

    try {
      const formData = new FormData();
      for (const audioFile of files) {
        formData.append("files", audioFile.file);
      }
      formData.append("speed", String(speed));
      formData.append("normalize", String(normalize));
      formData.append("silenceGap", String(silenceGap));

      const response = await fetch("/api/combine-audio", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erreur lors de la combinaison");
      }

      setResultUrl(result.audioUrl);
      setResultSize(result.fileSize);
      toast.success(`${files.length} audios combines avec succes !`);
    } catch (error: any) {
      const msg = error.message?.includes("Failed to fetch")
        ? "Impossible de contacter le serveur"
        : error.message || "Erreur de combinaison";
      toast.error(msg);
    } finally {
      setIsCombining(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `audio_combine_${Date.now()}.mp3`;
    a.click();
  };

  const hasCustomOptions = speed !== 1.0 || normalize || silenceGap > 0;

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-border/60 rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Music className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-foreground font-medium">
          Glissez vos fichiers audio ici ou cliquez pour parcourir
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          MP3, WAV, OGG, M4A, FLAC, AAC
        </p>
      </div>

      {/* File list with drag to reorder */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {files.length} fichier{files.length > 1 ? "s" : ""} — glissez
                pour reordonner
              </p>
              <button
                onClick={clearAll}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Tout supprimer
              </button>
            </div>

            <Reorder.Group
              axis="y"
              values={files}
              onReorder={(newOrder) => {
                setFiles(newOrder);
                setResultUrl("");
              }}
              className="space-y-2"
            >
              {files.map((audioFile, index) => (
                <Reorder.Item
                  key={audioFile.id}
                  value={audioFile}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50 cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {audioFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {audioFile.size}
                    </p>
                  </div>
                  <button
                    onClick={() => removeFile(audioFile.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Reorder.Item>
              ))}
            </Reorder.Group>

            {/* Add more button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Ajouter d'autres fichiers
            </button>

            {/* Options toggle */}
            <button
              onClick={() => setShowOptions(!showOptions)}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                showOptions || hasCustomOptions
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Settings className="w-4 h-4" />
              Options avancees
              {hasCustomOptions && !showOptions && (
                <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                  actif
                </span>
              )}
            </button>

            {/* Options panel */}
            <AnimatePresence>
              {showOptions && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4 p-4 rounded-xl bg-muted/50 border border-border/50"
                >
                  {/* Speed control */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        Vitesse de lecture
                      </span>
                      <span className="text-xs text-primary ml-auto font-medium">
                        {speed}x
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {SPEED_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => setSpeed(preset.value)}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                            speed === preset.value
                              ? "bg-primary text-primary-foreground"
                              : "bg-background border border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Accelerer pour reviser vite, ralentir pour mieux comprendre
                    </p>
                  </div>

                  {/* Volume normalization */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={normalize}
                        onChange={(e) => setNormalize(e.target.checked)}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                      />
                      <Volume2 className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        Normaliser le volume
                      </span>
                    </label>
                    <p className="text-xs text-muted-foreground ml-6">
                      Egalise le volume entre tous les fichiers pour une ecoute uniforme
                    </p>
                  </div>

                  {/* Silence gap */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Timer className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        Silence entre les fichiers
                      </span>
                      <span className="text-xs text-primary ml-auto font-medium">
                        {silenceGap === 0 ? "Aucun" : `${silenceGap}s`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.5}
                      value={silenceGap}
                      onChange={(e) =>
                        setSilenceGap(parseFloat(e.target.value))
                      }
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0s</span>
                      <span>5s</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Insere un silence entre chaque audio pour separer les chapitres
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Combine button */}
            <button
              onClick={handleCombine}
              disabled={isCombining || files.length < 2}
              className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isCombining ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Combinaison en cours...
                </>
              ) : (
                <>
                  <Merge className="w-5 h-5" />
                  Combiner {files.length} audio{files.length > 1 ? "s" : ""}
                  {hasCustomOptions && (
                    <span className="text-xs opacity-75">
                      ({[
                        speed !== 1.0 && `${speed}x`,
                        normalize && "normalise",
                        silenceGap > 0 && `${silenceGap}s silence`,
                      ]
                        .filter(Boolean)
                        .join(", ")})
                    </span>
                  )}
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {resultUrl && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-3"
          >
            <p className="text-sm font-medium text-foreground">
              Audio combine ({resultSize})
            </p>
            <audio controls src={resultUrl} className="w-full" />
            <button
              onClick={handleDownload}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Télécharger l'audio combiné
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AudioCombiner;
