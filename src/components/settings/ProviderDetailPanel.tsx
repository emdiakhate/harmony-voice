import { useState, useEffect } from "react";
import {
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
  Trash2,
  Mic,
  Languages,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import {
  type Provider,
  type Task,
  PROVIDERS,
  PROVIDER_BASE_URLS,
  PROVIDER_MODELS,
  EDITABLE_BASE_URL_PROVIDERS,
  useSettings,
} from "@/hooks/useSettings";
import { useProviderKeys } from "@/hooks/useProviderKeys";

interface ProviderDetailPanelProps {
  provider: Provider;
  onClose: () => void;
}

const TASK_ICONS: Record<Task, typeof Mic> = {
  transcription: Mic,
  translation: Languages,
  tts: Volume2,
};

const TASK_BADGE_COLORS: Record<Task, string> = {
  transcription: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  translation: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  tts: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const TASK_LABELS: Record<Task, string> = {
  transcription: "STT",
  translation: "Trad",
  tts: "TTS",
};

export default function ProviderDetailPanel({ provider, onClose }: ProviderDetailPanelProps) {
  const { settings, setProviderBaseUrl } = useSettings();
  const { keysForProvider, addKey, removeKey } = useProviderKeys();

  const [draftKey, setDraftKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [draftBaseUrl, setDraftBaseUrl] = useState("");

  const p = PROVIDERS[provider];
  const models = PROVIDER_MODELS[provider];
  const isEditable = EDITABLE_BASE_URL_PROVIDERS.includes(provider);
  const requiresKey = p.requiresKey !== false;
  const existingKeys = keysForProvider(provider);

  useEffect(() => {
    setDraftKey("");
    setDraftBaseUrl(settings.providerBaseUrls[provider] ?? PROVIDER_BASE_URLS[provider]);
    setTestResult(null);
    setKeyVisible(false);
  }, [provider, settings.providerBaseUrls]);

  const handleTest = async () => {
    if (!draftKey.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: draftKey.trim() }),
      });
      const data = await res.json();
      setTestResult(data.valid as boolean);
    } catch {
      setTestResult(false);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (requiresKey && draftKey.trim()) {
      try {
        await addKey.mutateAsync({ provider, key: draftKey.trim(), label: p.name });
      } catch (e: any) {
        toast.error(e?.message || "Échec de l'enregistrement de la clé");
        return; // ne pas fermer si l'enregistrement échoue
      }
    }
    if (isEditable) {
      setProviderBaseUrl(provider, draftBaseUrl.trim() || PROVIDER_BASE_URLS[provider]);
    }
    onClose();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <span
          className="w-4 h-4 rounded-full shrink-0 ring-1 ring-black/10"
          style={{ backgroundColor: p.color }}
        />
        <h2 className="text-base font-semibold">{p.name}</h2>
        <div className="flex gap-1 ml-1">
          {p.capabilities.map((cap) => {
            const Icon = TASK_ICONS[cap];
            return (
              <span
                key={cap}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${TASK_BADGE_COLORS[cap]}`}
              >
                <Icon className="w-2.5 h-2.5" />
                {TASK_LABELS[cap]}
              </span>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Info box for OpenRouter */}
        {provider === "openrouter" && (
          <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-4 py-3 text-xs text-blue-300 leading-relaxed">
            OpenRouter route vos requêtes vers plusieurs modèles selon la disponibilité et le coût. Vous pouvez utiliser la clé de l'administrateur ou entrer votre propre clé.
          </div>
        )}

        {/* Encart fournisseur gratuit (sans clé) */}
        {!requiresKey && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-xs text-emerald-300 leading-relaxed">
            Ce fournisseur est <strong>100% gratuit</strong> et ne nécessite aucune clé API.
            Il sert de repli automatique quand vos autres fournisseurs sont indisponibles ou à court de quota.
          </div>
        )}

        {/* Clé API (uniquement pour les fournisseurs nécessitant une clé) */}
        {requiresKey && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Clé API</label>
            <a
              href={p.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Obtenir une clé
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Clés déjà enregistrées (chiffrées en base, affichées masquées) */}
          {existingKeys.length > 0 && (
            <div className="space-y-1">
              {existingKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-2 px-3 h-9 rounded-lg border border-border bg-muted/40 text-sm"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <span className="font-mono text-xs flex-1 truncate">{k.masked}</span>
                  {k.disabled && (
                    <span className="text-[10px] text-muted-foreground">désactivée</span>
                  )}
                  <button
                    onClick={() => removeKey.mutate(k.id)}
                    title="Supprimer la clé"
                    className="p-1 rounded hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Ajouter une nouvelle clé */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={keyVisible ? "text" : "password"}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder={existingKeys.length ? "Ajouter une autre clé…" : p.placeholder}
                className="w-full h-9 px-3 pr-10 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
              />
              <button
                type="button"
                onClick={() => setKeyVisible((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={handleTest}
              disabled={!draftKey.trim() || isTesting}
              className="flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
            >
              {isTesting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Tester
            </button>
          </div>

          {/* Test result */}
          {testResult === true && (
            <div className="flex items-center gap-1.5 text-xs text-green-500">
              <CheckCircle className="w-3.5 h-3.5" />
              Connexion valide
            </div>
          )}
          {testResult === false && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="w-3.5 h-3.5" />
              Clé invalide ou erreur de connexion
            </div>
          )}
          {existingKeys.length === 0 && !draftKey && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-3.5 h-3.5 rounded-full border-2 border-yellow-500/60 flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-yellow-500/60" />
              </div>
              Nécessite une clé API
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            🔒 La clé est chiffrée (AES-256-GCM) et stockée côté serveur — jamais affichée en clair.
          </p>
        </div>
        )}

        {/* URL de base */}
        <div className="space-y-2">
          <label className="text-sm font-medium">URL de base</label>
          {isEditable ? (
            <input
              type="text"
              value={draftBaseUrl}
              onChange={(e) => setDraftBaseUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          ) : (
            <p className="text-sm font-mono text-muted-foreground px-3 py-2 rounded-lg bg-muted/40 border border-border">
              {draftBaseUrl}
            </p>
          )}
          {isEditable && (
            <p className="text-xs text-muted-foreground">
              URL de requête : {draftBaseUrl}/chat/completions
            </p>
          )}
        </div>

        {/* Modèles (fixés par fournisseur — lecture seule) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Modèles</label>
            <span className="text-xs text-muted-foreground">
              Gérer les modèles de ce fournisseur
            </span>
          </div>
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {models.map((model) => {
              const Icon = TASK_ICONS[model.task];
              return (
                <div key={model.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${TASK_BADGE_COLORS[model.task]}`}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {TASK_LABELS[model.task]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium font-mono">{model.name}</div>
                    <div className="text-xs text-muted-foreground">{model.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
        >
          Fermer
        </button>
        <button
          onClick={handleSave}
          disabled={addKey.isPending}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {addKey.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
