import { useState, useCallback } from "react";
import { Upload, Link, X } from "lucide-react";
import { motion } from "framer-motion";

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
}

const FileDropZone = ({ onFileSelect, selectedFile, onClear }: FileDropZoneProps) => {
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

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
            <Upload className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo
            </p>
          </div>
        </div>
        <button onClick={onClear} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-5 h-5" />
        </button>
      </motion.div>
    );
  }

  return (
    <label
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`
        glass-card p-10 flex flex-col items-center justify-center gap-4 cursor-pointer
        border-2 border-dashed transition-all duration-300
        ${isDragging ? "border-primary glow-border bg-primary/5" : "border-border/50 hover:border-primary/50"}
      `}
    >
      <input
        type="file"
        accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
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
          Glissez votre document ici
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          PDF, Word (.docx), Texte (.txt) • Max 50 Mo
        </p>
      </div>
    </label>
  );
};

export default FileDropZone;
