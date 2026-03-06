import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Scissors,
  Loader2,
  Upload,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface PdfChunk {
  index: number;
  pages: string;
  url: string;
  fileName: string;
}

interface PdfSplitterProps {
  onChunksReady: (files: File[]) => void;
  disabled?: boolean;
}

const PdfSplitter = ({ onChunksReady, disabled = false }: PdfSplitterProps) => {
  const [pagesPerChunk, setPagesPerChunk] = useState(12);
  const [isSplitting, setIsSplitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [splitResult, setSplitResult] = useState<{
    totalPages: number;
    chunks: PdfChunk[];
  } | null>(null);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Seuls les fichiers PDF sont acceptes");
      return;
    }
    setSelectedFile(file);
    setSplitResult(null);
  };

  const handleSplit = async () => {
    if (!selectedFile) return;

    setIsSplitting(true);
    setSplitResult(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("pagesPerChunk", String(pagesPerChunk));

      const response = await fetch("/api/split-pdf", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Erreur lors du decoupage");
      }

      setSplitResult(result);
      toast.success(
        `PDF decoupe en ${result.chunks.length} morceaux (${result.totalPages} pages)`
      );
    } catch (error: any) {
      const msg = error.message?.includes("Failed to fetch")
        ? "Impossible de contacter le serveur"
        : error.message || "Erreur de decoupage";
      toast.error(msg);
    } finally {
      setIsSplitting(false);
    }
  };

  const handleUseChunks = async () => {
    if (!splitResult) return;

    setIsLoadingChunks(true);

    try {
      // Download each chunk PDF and create File objects
      const files: File[] = [];
      for (const chunk of splitResult.chunks) {
        const response = await fetch(chunk.url);
        if (!response.ok) throw new Error(`Erreur telechargement chunk ${chunk.index + 1}`);
        const blob = await response.blob();
        const file = new File(
          [blob],
          `Pages_${chunk.pages}.pdf`,
          { type: "application/pdf" }
        );
        files.push(file);
      }

      onChunksReady(files);
      toast.success(`${files.length} morceaux ajoutes a la file de traitement`);

      // Reset
      setSelectedFile(null);
      setSplitResult(null);
    } catch (error: any) {
      toast.error(error.message || "Erreur lors du chargement des morceaux");
    } finally {
      setIsLoadingChunks(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setSplitResult(null);
  };

  return (
    <div className="space-y-4 p-4 rounded-xl bg-muted/50 border border-border/50">
      <div className="flex items-center gap-2">
        <Scissors className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">
          Decoupage automatique de gros PDF
        </span>
      </div>

      {!selectedFile ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border/60 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
              e.target.value = "";
            }}
          />
          <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">
            Importez un gros PDF a decouper
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Il sera decoupe en morceaux puis traite automatiquement
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Selected file info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border/50">
            <FileText className="w-5 h-5 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">
                {selectedFile.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
            <button
              onClick={handleReset}
              disabled={isSplitting || isLoadingChunks}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Changer
            </button>
          </div>

          {/* Pages per chunk slider */}
          {!splitResult && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm text-foreground">
                  Pages par morceau
                </label>
                <span className="text-sm font-medium text-primary">
                  {pagesPerChunk} pages
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={1}
                value={pagesPerChunk}
                onChange={(e) => setPagesPerChunk(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>5</span>
                <span>50</span>
              </div>
            </div>
          )}

          {/* Split button */}
          {!splitResult && (
            <button
              onClick={handleSplit}
              disabled={isSplitting || disabled}
              className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSplitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Decoupage en cours...
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  Decouper le PDF
                </>
              )}
            </button>
          )}

          {/* Split result */}
          <AnimatePresence>
            {splitResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  <span>
                    {splitResult.totalPages} pages → {splitResult.chunks.length} morceaux
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                  {splitResult.chunks.map((chunk) => (
                    <div
                      key={chunk.index}
                      className="text-xs px-2 py-1.5 rounded-md bg-primary/10 text-primary text-center"
                    >
                      p.{chunk.pages}
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleUseChunks}
                  disabled={isLoadingChunks}
                  className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoadingChunks ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Chargement des morceaux...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Utiliser ces {splitResult.chunks.length} morceaux pour le traitement
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default PdfSplitter;
