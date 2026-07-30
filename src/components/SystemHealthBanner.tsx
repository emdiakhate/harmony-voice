import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface HealthResponse {
  status: string;
  ffmpeg?: boolean;
  ytdlp?: boolean;
}

/**
 * Interroge /api/health au chargement et alerte si une dépendance système
 * externe (ffmpeg / yt-dlp) manque — sinon l'utilisateur ne découvre le problème
 * qu'au milieu d'un traitement, avec une erreur cryptique.
 */
export function SystemHealthBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: HealthResponse | null) => {
        if (cancelled || !data) return;
        const gaps: string[] = [];
        if (data.ffmpeg === false)
          gaps.push("ffmpeg (synthèse vocale, fusion audio/vidéo, découpage)");
        if (data.ytdlp === false) gaps.push("yt-dlp (mode YouTube)");
        setMissing(gaps);
      })
      .catch(() => {
        /* backend non joignable : géré ailleurs (messages d'erreur au traitement) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || missing.length === 0) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-200">
      <div className="container max-w-6xl mx-auto px-4 py-2 flex items-start gap-3 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <span className="font-medium">Dépendances système manquantes :</span>{" "}
          {missing.join(", ")}. Ces fonctionnalités resteront indisponibles tant
          que ces outils ne sont pas installés (voir la section « Prérequis » du
          README).
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 opacity-70 hover:opacity-100"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
