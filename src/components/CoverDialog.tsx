import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Image as ImageIcon,
  Loader2,
  Upload,
  Sparkles,
  RefreshCw,
  Check,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings, buildImageConfig } from "@/hooks/useSettings";

interface CoverDialogProps {
  open: boolean;
  onClose: () => void;
  /** URL de l'audio généré : la couverture y sera embarquée en pochette ID3. */
  audioUrl?: string;
  defaultTitle?: string;
  /** Extrait du contenu (traduction/résumé) pour guider le sujet visuel. */
  contentHint?: string;
  onGenerated: (coverImageUrl: string) => void;
}

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: "audiobook", label: "Livre audio classique" },
  { value: "minimal", label: "Minimaliste" },
  { value: "photographic", label: "Photographique" },
  { value: "illustrated", label: "Illustré" },
  { value: "abstract", label: "Abstrait" },
];

export default function CoverDialog({
  open,
  onClose,
  audioUrl,
  defaultTitle,
  contentHint,
  onGenerated,
}: CoverDialogProps) {
  const { settings } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [style, setStyle] = useState("audiobook");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Pré-remplir / réinitialiser à l'ouverture.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle || "");
      setAuthor("");
      setSubtitle("");
      setStyle("audiobook");
      setReferenceFile(null);
      setReferencePreview(null);
      setPreview(null);
      setIsGenerating(false);
    }
  }, [open, defaultTitle]);

  const handlePickReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Veuillez choisir un fichier image.");
      return;
    }
    setReferenceFile(file);
    setReferencePreview(URL.createObjectURL(file));
  };

  const clearReference = () => {
    setReferenceFile(null);
    setReferencePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGenerate = async () => {
    if (!title.trim()) {
      toast.error("Un titre est requis pour la couverture.");
      return;
    }
    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      if (author.trim()) formData.append("author", author.trim());
      if (subtitle.trim()) formData.append("subtitle", subtitle.trim());
      formData.append("style", style);
      if (contentHint) formData.append("contentHint", contentHint.slice(0, 1000));
      if (audioUrl) formData.append("audioUrl", audioUrl);
      formData.append("imageConfig", JSON.stringify(buildImageConfig(settings)));
      if (referenceFile) formData.append("referenceImage", referenceFile);

      const res = await fetch("/api/generate-cover", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Échec de la génération");
      }

      const data = await res.json();
      setPreview(data.coverImageUrl);
      onGenerated(data.coverImageUrl);
      toast.success("Couverture générée !");
    } catch (e: any) {
      toast.error(e?.message || "Erreur lors de la génération de la couverture");
    } finally {
      setIsGenerating(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
            <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-primary" />
              Générer une couverture
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Aperçu */}
            <div className="flex justify-center">
              <div className="w-40 h-40 rounded-xl overflow-hidden border border-border bg-muted flex items-center justify-center">
                {preview ? (
                  <img src={preview} alt="Couverture" className="w-full h-full object-cover" />
                ) : isGenerating ? (
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                ) : (
                  <ImageIcon className="w-10 h-10 text-muted-foreground" />
                )}
              </div>
            </div>

            {/* Champs */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Titre *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titre du livre / de l'épisode"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Auteur</label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Nom de l'auteur"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Sous-titre / Genre <span className="opacity-60">(optionnel)</span>
                </label>
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="ex. Roman, Développement personnel..."
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {STYLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Image de référence */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Image de référence <span className="opacity-60">(optionnel, ex. photo de l'auteur)</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickReference}
                  className="hidden"
                />
                {referencePreview ? (
                  <div className="mt-1 flex items-center gap-3">
                    <img
                      src={referencePreview}
                      alt="Référence"
                      className="w-12 h-12 rounded-lg object-cover border border-border"
                    />
                    <span className="flex-1 truncate text-xs text-muted-foreground">
                      {referenceFile?.name}
                    </span>
                    <button
                      onClick={clearReference}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="Retirer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full mt-1 py-2.5 rounded-lg bg-muted border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Choisir une image
                  </button>
                )}
              </div>
            </div>

            {/* Action */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !title.trim()}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Génération...
                </>
              ) : preview ? (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Régénérer
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Générer la couverture
                </>
              )}
            </button>

            {preview && (
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary font-medium text-sm transition-all flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Utiliser cette couverture
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
