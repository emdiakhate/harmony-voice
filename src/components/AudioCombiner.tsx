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

const AudioCombiner = () => {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [isCombining, setIsCombining] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resultSize, setResultSize] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const audioFiles: AudioFile[] = [];
    for (const file of Array.from(newFiles)) {
      if (!file.type.startsWith("audio/") && !AUDIO_ACCEPT.split(",").some(ext => file.name.toLowerCase().endsWith(ext))) {
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
              Telecharger l'audio combine
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AudioCombiner;
