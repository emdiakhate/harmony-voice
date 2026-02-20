import { useState } from "react";
import { motion } from "framer-motion";
import {
  FileAudio,
  Link,
  ArrowRightLeft,
  Languages,
  FileText,
  Mic,
  Video,
  Sparkles,
} from "lucide-react";
import FileDropZone from "@/components/FileDropZone";
import LanguageSelector from "@/components/LanguageSelector";
import ResultsPanel from "@/components/ResultsPanel";
import { toast } from "sonner";

type InputMode = "file" | "url";

const Index = () => {
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("fr");
  const [transcription, setTranscription] = useState("");
  const [translation, setTranslation] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcess = () => {
    if (!selectedFile && !youtubeUrl) {
      toast.error("Veuillez ajouter un fichier ou un lien YouTube");
      return;
    }
    setIsProcessing(true);
    // Simulate processing for now
    setTimeout(() => {
      setTranscription(
        "Ceci est un exemple de transcription. Le backend n'est pas encore connecté. Activez Lovable Cloud pour bénéficier de la transcription et traduction IA en temps réel."
      );
      setTranslation(
        "This is a sample transcription. The backend is not yet connected. Enable Lovable Cloud to benefit from real-time AI transcription and translation."
      );
      setIsProcessing(false);
      toast.success("Traitement terminé !");
    }, 2500);
  };

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
              <h1 className="font-display font-bold text-lg text-foreground">VoxTranslate</h1>
              <p className="text-xs text-muted-foreground">Transcription & Traduction IA</p>
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
            Importez un fichier audio/vidéo ou collez un lien YouTube pour obtenir une transcription et traduction automatique.
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
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
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

          {/* Action Button */}
          <button
            onClick={handleProcess}
            disabled={isProcessing}
            className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-base hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                Traitement en cours...
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                Transcrire & Traduire
              </>
            )}
          </button>
        </motion.section>

        {/* Results */}
        <section className="grid md:grid-cols-2 gap-6">
          <ResultsPanel
            title="Transcription"
            content={transcription}
            icon={<FileText className="w-5 h-5 text-teal-light" />}
            isLoading={isProcessing}
          />
          <ResultsPanel
            title="Traduction"
            content={translation}
            icon={<Languages className="w-5 h-5 text-primary" />}
            isLoading={isProcessing}
          />
        </section>
      </main>
    </div>
  );
};

export default Index;
