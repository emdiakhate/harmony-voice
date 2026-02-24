import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Download, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface ResultsPanelProps {
  title: string;
  content: string;
  icon: React.ReactNode;
  isLoading?: boolean;
  previewLines?: number;
}

function getPreviewText(text: string, sentenceCount: number): { preview: string; isTruncated: boolean } {
  // Split by sentence-ending punctuation followed by a space or end of string
  const sentences = text.match(/[^.!?]*[.!?]+(\s|$)/g);
  if (!sentences || sentences.length <= sentenceCount) {
    return { preview: text, isTruncated: false };
  }
  return {
    preview: sentences.slice(0, sentenceCount).join('').trim(),
    isTruncated: true,
  };
}

const ResultsPanel = ({ title, content, icon, isLoading, previewLines = 3 }: ResultsPanelProps) => {
  const [expanded, setExpanded] = useState(false);

  const { preview, isTruncated } = content
    ? getPreviewText(content, previewLines)
    : { preview: '', isTruncated: false };

  const displayText = expanded ? content : preview;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast.success("Copié dans le presse-papiers !");
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card flex flex-col h-full"
    >
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-display font-semibold text-foreground">{title}</h3>
        </div>
        {content && (
          <div className="flex gap-1">
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              title="Copier"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              title="Télécharger"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 p-4 overflow-auto min-h-[200px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Traitement en cours...</p>
          </div>
        ) : content ? (
          <div>
            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {displayText}
            </p>
            {isTruncated && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-3 flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Voir moins
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Voir plus
                  </>
                )}
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center mt-12">
            Le résultat apparaîtra ici
          </p>
        )}
      </div>
    </motion.div>
  );
};

export default ResultsPanel;
