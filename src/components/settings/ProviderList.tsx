import { type Provider, PROVIDERS } from "@/hooks/useSettings";
import { useProviderKeys } from "@/hooks/useProviderKeys";

interface ProviderListProps {
  selectedProvider: Provider | null;
  onSelect: (provider: Provider) => void;
}

const TASK_BADGE: Record<string, string> = {
  transcription: "STT",
  translation: "Trad",
  tts: "TTS",
};

export default function ProviderList({ selectedProvider, onSelect }: ProviderListProps) {
  const { hasKeyForProvider } = useProviderKeys();

  return (
    <aside className="w-[220px] shrink-0 py-2 overflow-y-auto">
      <div className="px-3 pb-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Fournisseurs
        </p>
      </div>
      <ul className="space-y-0.5 px-1">
        {(Object.keys(PROVIDERS) as Provider[]).map((provider) => {
          const p = PROVIDERS[provider];
          const isFree = p.requiresKey === false;
          const connected = hasKeyForProvider(provider);
          const isSelected = selectedProvider === provider;

          return (
            <li key={provider}>
              <button
                onClick={() => onSelect(provider)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all ${
                  isSelected
                    ? "bg-accent border-l-2 border-primary text-foreground"
                    : "hover:bg-muted/60 text-muted-foreground hover:text-foreground border-l-2 border-transparent"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10"
                  style={{ backgroundColor: p.color }}
                />
                <span className="flex-1 text-sm font-medium truncate">{p.name}</span>
                {isFree ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium shrink-0" title="Gratuit — aucune clé requise">
                    Gratuit
                  </span>
                ) : connected ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Connecté" />
                ) : null}
              </button>
              {isSelected && (
                <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                  {p.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium"
                    >
                      {TASK_BADGE[cap]}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
