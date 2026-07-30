import { useState, useCallback } from "react";
import { Upload, X, FileAudio, FileVideo, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

// Doit rester aligné avec la limite multer du serveur (200 Mo).
const MAX_FILE_SIZE = 200 * 1024 * 1024;

/** Écarte les fichiers dépassant la limite et prévient l'utilisateur, avant tout upload. */
function filterBySize(files: File[]): File[] {
  const tooBig = files.filter((f) => f.size > MAX_FILE_SIZE);
  if (tooBig.length > 0) {
    toast.error(
      `Fichier trop volumineux (max 200 Mo) : ${tooBig.map((f) => f.name).join(", ")}`
    );
  }
  return files.filter((f) => f.size <= MAX_FILE_SIZE);
}

interface FileDropZoneProps {
  onFilesSelect: (files: File[]) => void;
  selectedFiles: File[];
  onClear: () => void;
  onRemoveFile?: (index: number) => void;
  acceptTypes?: "documents" | "media" | "all";
  disabled?: boolean;
}

const ACCEPT_MAP = {
  documents:
    ".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain",
  media:
    ".mp4,.mp3,.wav,.webm,.ogg,.m4a,.flac,.aac,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/aac",
  all:
    ".pdf,.docx,.doc,.txt,.mp4,.mp3,.wav,.webm,.ogg,.m4a,.flac,.aac,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/aac",
};

function getFileIcon(file: File) {
  if (file.type.startsWith("video/")) return <FileVideo className="w-5 h-5 text-primary" />;
  if (file.type.startsWith("audio/")) return <FileAudio className="w-5 h-5 text-primary" />;
  return <FileText className="w-5 h-5 text-primary" />;
}

function getFileTypeLabel(file: File) {
  if (file.type.startsWith("video/")) return "Video";
  if (file.type.startsWith("audio/")) return "Audio";
  const ext = file.name.split(".").pop()?.toUpperCase() || "Fichier";
  return ext;
}

const FileDropZone = ({
  onFilesSelect,
  selectedFiles,
  onClear,
  onRemoveFile,
  acceptTypes = "all",
  disabled = false,
}: FileDropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const files = filterBySize(Array.from(e.dataTransfer.files));
      if (files.length > 0) onFilesSelect(files);
    },
    [onFilesSelect, disabled]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = filterBySize(Array.from(e.target.files || []));
    if (files.length > 0) onFilesSelect(files);
    e.target.value = "";
  };

  const acceptStr = ACCEPT_MAP[acceptTypes];

  return (
    <div className="space-y-3">
      {/* File list */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          {selectedFiles.map((file, index) => (
            <motion.div
              key={`${file.name}-${index}`}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  {getFileIcon(file)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground truncate max-w-[250px]">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {getFileTypeLabel(file)} &middot;{" "}
                    {(file.size / (1024 * 1024)).toFixed(2)} Mo
                  </p>
                </div>
              </div>
              {!disabled && (
                <button
                  onClick={() => onRemoveFile?.(index)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </motion.div>
          ))}
          {!disabled && (
            <div className="flex gap-2">
              <label className="flex-1 py-2 rounded-lg border border-dashed border-border/50 text-center text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground cursor-pointer transition-all">
                <input
                  type="file"
                  accept={acceptStr}
                  onChange={handleFileInput}
                  multiple
                  className="hidden"
                />
                + Ajouter d'autres fichiers
              </label>
              <button
                onClick={onClear}
                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive transition-colors"
              >
                Tout retirer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Drop zone (show when no files or always for adding more) */}
      {selectedFiles.length === 0 && (
        <label
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`
            glass-card p-10 flex flex-col items-center justify-center gap-4 cursor-pointer
            border-2 border-dashed transition-all duration-300
            ${disabled ? "opacity-50 pointer-events-none" : ""}
            ${
              isDragging
                ? "border-primary glow-border bg-primary/5"
                : "border-border/50 hover:border-primary/50"
            }
          `}
        >
          <input
            type="file"
            accept={acceptStr}
            onChange={handleFileInput}
            multiple
            className="hidden"
          />
          <motion.div
            animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
            className="w-16 h-16 rounded-2xl gradient-teal flex items-center justify-center"
          >
            <Upload className="w-7 h-7 text-foreground" />
          </motion.div>
          <div className="text-center">
            <p className="text-foreground font-medium">
              Glissez vos fichiers ici
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {acceptTypes === "documents" && "PDF, Word (.docx), Texte (.txt)"}
              {acceptTypes === "media" && "Video (MP4, WebM) ou Audio (MP3, WAV, M4A, FLAC)"}
              {acceptTypes === "all" &&
                "PDF, Word, Texte, Video (MP4) ou Audio (MP3, WAV)"}
              {" "}&bull; Max 200 Mo &bull; Plusieurs fichiers possibles
            </p>
          </div>
        </label>
      )}
    </div>
  );
};

export default FileDropZone;
