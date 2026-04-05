import { useState } from "react";
import {
  Mic,
  Languages,
  Volume2,
  GripVertical,
  Plus,
  X,
  ChevronDown,
  Info,
} from "lucide-react";
import {
  type Provider,
  type Task,
  PROVIDERS,
  TASK_LABELS,
  useSettings,
} from "@/hooks/useSettings";

const TASK_ICONS: Record<Task, typeof Mic> = {
  transcription: Mic,
  translation: Languages,
  tts: Volume2,
};

// Which providers can do which task
function getAvailableProviders(task: Task): Provider[] {
  return (Object.keys(PROVIDERS) as Provider[]).filter((p) =>
    PROVIDERS[p].capabilities.includes(task)
  );
}

// Model info per provider+task
const MODEL_INFO: Record<string, string> = {
  "openai:transcription": "Whisper large-v3",
  "groq:transcription": "Whisper large-v3 (rapide)",
  "openai:translation": "GPT-4o-mini",
  "groq:translation": "LLaMA 3.3 70B",
  "openrouter:translation": "Multi-modèle (auto)",
  "gemini:translation": "Gemini 2.5 Flash",
  "claude:translation": "Claude Sonnet 4",
  "elevenlabs:tts": "Multilingual v2 (Sarah)",
  "openai:tts": "TTS-1 (Nova)",
  "gemini:tts": "Gemini 2.5 Flash TTS (Kore)",
};

export default function TaskProviderConfig() {
  const { settings, setTaskProviders, hasKeyForProvider } = useSettings();
  const [dragState, setDragState] = useState<{
    task: Task;
    fromIndex: number;
  } | null>(null);
  const [addingTo, setAddingTo] = useState<Task | null>(null);

  const handleDragStart = (task: Task, index: number) => {
    setDragState({ task, fromIndex: index });
  };

  const handleDragOver = (e: React.DragEvent, task: Task, toIndex: number) => {
    e.preventDefault();
    if (!dragState || dragState.task !== task) return;
  };

  const handleDrop = (task: Task, toIndex: number) => {
    if (!dragState || dragState.task !== task) return;
    const providers = [...settings.taskAssignments[task]];
    const [moved] = providers.splice(dragState.fromIndex, 1);
    providers.splice(toIndex, 0, moved);
    setTaskProviders(task, providers);
    setDragState(null);
  };

  const removeProvider = (task: Task, index: number) => {
    const providers = [...settings.taskAssignments[task]];
    providers.splice(index, 1);
    setTaskProviders(task, providers);
  };

  const addProvider = (task: Task, provider: Provider) => {
    const providers = [...settings.taskAssignments[task]];
    if (!providers.includes(provider)) {
      providers.push(provider);
      setTaskProviders(task, providers);
    }
    setAddingTo(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Info className="w-4 h-4" />
          Assignation par tâche
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Définissez l'ordre de priorité des providers pour chaque tâche.
          En cas de quota atteint, le provider suivant est utilisé automatiquement.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(["transcription", "translation", "tts"] as Task[]).map((task) => {
          const Icon = TASK_ICONS[task];
          const taskInfo = TASK_LABELS[task];
          const assigned = settings.taskAssignments[task];
          const available = getAvailableProviders(task).filter(
            (p) => !assigned.includes(p)
          );

          return (
            <div
              key={task}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              {/* Task header */}
              <div className="px-4 py-3 bg-muted/50 border-b border-border">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">{taskInfo.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {taskInfo.description}
                </p>
              </div>

              {/* Provider list (drag to reorder) */}
              <div className="p-2 space-y-1 min-h-[80px]">
                {assigned.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Aucun provider assigné
                  </div>
                )}
                {assigned.map((provider, index) => {
                  const p = PROVIDERS[provider];
                  const hasKey = hasKeyForProvider(provider);
                  const modelInfo =
                    MODEL_INFO[`${provider}:${task}`] || "";

                  return (
                    <div
                      key={provider}
                      draggable
                      onDragStart={() => handleDragStart(task, index)}
                      onDragOver={(e) => handleDragOver(e, task, index)}
                      onDrop={() => handleDrop(task, index)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${
                        hasKey
                          ? "border-border bg-background hover:bg-muted/50"
                          : "border-dashed border-yellow-500/40 bg-yellow-500/5"
                      }`}
                    >
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium flex items-center gap-1.5">
                          <span className="text-muted-foreground/60 text-[10px] font-mono w-4">
                            {index + 1}.
                          </span>
                          {p.name}
                          {!hasKey && (
                            <span className="text-[9px] text-yellow-600 bg-yellow-500/10 px-1 py-0.5 rounded">
                              pas de clé
                            </span>
                          )}
                        </div>
                        {modelInfo && (
                          <div className="text-[10px] text-muted-foreground ml-5">
                            {modelInfo}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeProvider(task, index)}
                        className="p-1 rounded hover:bg-destructive/10 transition-colors shrink-0"
                      >
                        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add provider */}
              <div className="px-2 pb-2">
                {addingTo === task ? (
                  <div className="space-y-1">
                    {available.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                        Tous les providers compatibles sont déjà assignés
                      </div>
                    ) : (
                      available.map((provider) => {
                        const p = PROVIDERS[provider];
                        return (
                          <button
                            key={provider}
                            onClick={() => addProvider(task, provider)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs hover:bg-muted transition-colors"
                          >
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: p.color }}
                            />
                            {p.name}
                            {MODEL_INFO[`${provider}:${task}`] && (
                              <span className="text-muted-foreground ml-auto text-[10px]">
                                {MODEL_INFO[`${provider}:${task}`]}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                    <button
                      onClick={() => setAddingTo(null)}
                      className="w-full px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTo(task)}
                    className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground rounded-lg border border-dashed border-border hover:border-primary/30 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Ajouter un provider
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
