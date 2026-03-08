import { useState } from "react";
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  type Provider,
  type ApiKeyEntry,
  PROVIDERS,
  useSettings,
} from "@/hooks/useSettings";

export default function ApiKeyManager() {
  const { settings, addApiKey, removeApiKey, updateApiKey } = useSettings();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>("openai");
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [testingKeys, setTestingKeys] = useState<Set<string>>(new Set());

  const handleAdd = () => {
    if (!newKey.trim()) return;
    addApiKey(newProvider, newKey.trim(), newLabel.trim() || `${PROVIDERS[newProvider].name} #${settings.apiKeys.filter((k) => k.provider === newProvider).length + 1}`);
    setNewKey("");
    setNewLabel("");
    setShowAddForm(false);
  };

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const testKey = async (entry: ApiKeyEntry) => {
    setTestingKeys((prev) => new Set(prev).add(entry.id));
    try {
      const res = await fetch("/api/settings/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: entry.provider, key: entry.key }),
      });
      const data = await res.json();
      updateApiKey(entry.id, { isValid: data.valid });
    } catch {
      updateApiKey(entry.id, { isValid: false });
    } finally {
      setTestingKeys((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "••••••••";
    return key.slice(0, 4) + "•".repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
  };

  // Group keys by provider
  const keysByProvider = Object.keys(PROVIDERS).reduce(
    (acc, p) => {
      const provider = p as Provider;
      acc[provider] = settings.apiKeys.filter((k) => k.provider === provider);
      return acc;
    },
    {} as Record<Provider, ApiKeyEntry[]>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Key className="w-4 h-4" />
            Clés API
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ajoutez vos clés API pour chaque provider. Plusieurs clés par provider sont supportées pour la rotation automatique.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Provider
              </label>
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value as Provider)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {Object.entries(PROVIDERS).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Label (optionnel)
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ex: Compte perso"
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                Clé API
                <a
                  href={PROVIDERS[newProvider].helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </label>
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={PROVIDERS[newProvider].placeholder}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleAdd}
              disabled={!newKey.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Ajouter la clé
            </button>
          </div>
        </div>
      )}

      {/* Keys list grouped by provider */}
      {Object.entries(keysByProvider).map(([provider, keys]) => {
        if (keys.length === 0) return null;
        const p = PROVIDERS[provider as Provider];
        return (
          <div key={provider} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/50 border-b border-border flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                ({keys.length} clé{keys.length > 1 ? "s" : ""})
              </span>
              <div className="flex-1" />
              <div className="flex gap-1">
                {p.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                  >
                    {cap === "transcription" ? "STT" : cap === "translation" ? "Trad" : "TTS"}
                  </span>
                ))}
              </div>
            </div>
            <div className="divide-y divide-border">
              {keys.map((entry) => (
                <div
                  key={entry.id}
                  className={`px-4 py-3 flex items-center gap-3 ${
                    entry.disabled ? "opacity-50" : ""
                  }`}
                >
                  {/* Status icon */}
                  <div className="shrink-0">
                    {testingKeys.has(entry.id) ? (
                      <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                    ) : entry.isValid === true ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : entry.isValid === false ? (
                      <XCircle className="w-4 h-4 text-destructive" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-yellow-500" />
                    )}
                  </div>

                  {/* Key info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{entry.label}</div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {revealedKeys.has(entry.id) ? entry.key : maskKey(entry.key)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleReveal(entry.id)}
                      className="p-1.5 rounded-md hover:bg-muted transition-colors"
                      title={revealedKeys.has(entry.id) ? "Masquer" : "Afficher"}
                    >
                      {revealedKeys.has(entry.id) ? (
                        <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => testKey(entry)}
                      disabled={testingKeys.has(entry.id)}
                      className="px-2 py-1 text-[11px] rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Tester
                    </button>
                    <button
                      onClick={() =>
                        updateApiKey(entry.id, { disabled: !entry.disabled })
                      }
                      className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                        entry.disabled
                          ? "border-primary/30 text-primary hover:bg-primary/10"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {entry.disabled ? "Activer" : "Désactiver"}
                    </button>
                    <button
                      onClick={() => removeApiKey(entry.id)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {settings.apiKeys.length === 0 && !showAddForm && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Key className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Aucune clé API configurée.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Ajoutez vos clés pour utiliser les différents providers d'IA.
          </p>
        </div>
      )}
    </div>
  );
}
