import { useState, useCallback } from "react";
import { Upload, X, FileAudio, FileVideo, FileText } from "lucide-react";
import { motion } from "framer-motion";

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
  acceptTypes?: "documents" | "media" | "all";
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
  onFileSelect,
  selectedFile,
  onClear,
  acceptTypes = "all",
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
      const file = e.dataTransfer.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
  };

  if (selectedFile) {
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card p-6 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            {getFileIcon(selectedFile)}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {selectedFile.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {getFileTypeLabel(selectedFile)} &middot;{" "}
              {(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo
            </p>
          </div>
        </div>
        <button
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </motion.div>
    );
  }

  const acceptStr = ACCEPT_MAP[acceptTypes];

  return (
    <label
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`
        glass-card p-10 flex flex-col items-center justify-center gap-4 cursor-pointer
        border-2 border-dashed transition-all duration-300
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
          Glissez votre fichier ici
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {acceptTypes === "documents" && "PDF, Word (.docx), Texte (.txt)"}
          {acceptTypes === "media" && "Video (MP4, WebM) ou Audio (MP3, WAV, M4A, FLAC)"}
          {acceptTypes === "all" &&
            "PDF, Word, Texte, Video (MP4) ou Audio (MP3, WAV)"}
          {" "}&bull; Max 200 Mo
        </p>
      </div>
    </label>
  );
};

export default FileDropZone;
