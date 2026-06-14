import { useState, useEffect, useCallback } from "react";

// --- Types ---

export type Provider = "openai" | "gemini" | "groq" | "openrouter" | "elevenlabs" | "pollinations" | "llm7";

export type Task = "transcription" | "translation" | "tts";

// Les clés API ne sont plus stockées côté client : elles vivent chiffrées en base
// (voir useProviderKeys + /api/settings/keys). Ici on ne garde que les préférences
// non sensibles (ordre, URLs de base, modèles).

export interface TaskProviderAssignment {
  transcription: Provider[];
  translation: Provider[];
  tts: Provider[];
}

export interface SettingsState {
  taskAssignments: TaskProviderAssignment;
  providerBaseUrls: Partial<Record<Provider, string>>;
}

// --- Provider metadata ---

export const PROVIDERS: Record<
  Provider,
  {
    name: string;
    color: string;
    capabilities: Task[];
    placeholder: string;
    helpUrl: string;
    /** false = tier 100% gratuit, aucune clé requise (Pollinations, LLM7). Défaut: true. */
    requiresKey?: boolean;
  }
> = {
  openai: {
    name: "OpenAI",
    color: "#10a37f",
    capabilities: ["transcription", "translation", "tts"],
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    name: "Google Gemini",
    color: "#4285f4",
    capabilities: ["translation", "tts"],
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/app/apikey",
  },
  groq: {
    name: "Groq",
    color: "#f55036",
    capabilities: ["transcription", "translation"],
    placeholder: "gsk_...",
    helpUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    name: "OpenRouter",
    color: "#8b5cf6",
    capabilities: ["translation"],
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
  },
  elevenlabs: {
    name: "ElevenLabs",
    color: "#2d2d2d",
    capabilities: ["tts"],
    placeholder: "xi-...",
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  pollinations: {
    name: "Pollinations",
    color: "#ec4899",
    capabilities: ["translation"],
    placeholder: "Aucune clé requise",
    helpUrl: "https://pollinations.ai",
    requiresKey: false,
  },
  llm7: {
    name: "LLM7",
    color: "#0ea5e9",
    capabilities: ["translation"],
    placeholder: "Aucune clé requise",
    helpUrl: "https://llm7.io",
    requiresKey: false,
  },
};

export const PROVIDER_BASE_URLS: Record<Provider, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  elevenlabs: "https://api.elevenlabs.io",
  pollinations: "https://text.pollinations.ai/openai",
  llm7: "https://api.llm7.io/v1",
};

export const EDITABLE_BASE_URL_PROVIDERS: Provider[] = ["openrouter"];

export interface ProviderModel {
  id: string;
  task: Task;
  name: string;
  description: string;
}

export const PROVIDER_MODELS: Record<Provider, ProviderModel[]> = {
  openai: [
    { id: "whisper-1", task: "transcription", name: "Whisper large-v3", description: "Reconnaissance vocale multilingue" },
    { id: "gpt-4o-mini", task: "translation", name: "GPT-4o mini", description: "Traduction économique et précise" },
    { id: "tts-1", task: "tts", name: "TTS-1 (Nova)", description: "Synthèse vocale naturelle" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", task: "translation", name: "Gemini 2.5 Flash", description: "Traduction ultra-rapide" },
    { id: "gemini-2.5-flash-tts", task: "tts", name: "Gemini 2.5 Flash TTS (Kore)", description: "Synthèse vocale multilingue" },
  ],
  groq: [
    { id: "whisper-large-v3", task: "transcription", name: "Whisper large-v3 (rapide)", description: "Transcription accélérée GPU" },
    { id: "llama-3.3-70b-versatile", task: "translation", name: "LLaMA 3.3 70B", description: "Grand modèle open-source" },
  ],
  openrouter: [
    { id: "auto", task: "translation", name: "Auto (multi-modèle)", description: "Sélection automatique du meilleur modèle" },
  ],
  elevenlabs: [
    { id: "eleven_multilingual_v2", task: "tts", name: "Multilingual v2 (Sarah)", description: "Voix premium multilingue" },
  ],
  pollinations: [
    { id: "openai", task: "translation", name: "OpenAI (gratuit)", description: "Modèle gratuit via Pollinations, sans clé API" },
  ],
  llm7: [
    { id: "gpt-4o-mini-2024-07-18", task: "translation", name: "GPT-4o mini (gratuit)", description: "Accès gratuit via LLM7, sans clé API" },
  ],
};

export const TASK_LABELS: Record<Task, { label: string; description: string }> = {
  transcription: {
    label: "Transcription",
    description: "Convertir l'audio en texte (Whisper)",
  },
  translation: {
    label: "Traduction",
    description: "Traduire le texte dans la langue cible",
  },
  tts: {
    label: "Synthèse vocale (TTS)",
    description: "Générer l'audio à partir du texte traduit",
  },
};

// Default priority order per task
const DEFAULT_ASSIGNMENTS: TaskProviderAssignment = {
  transcription: ["groq", "openai"],
  // Les tiers gratuits (pollinations, llm7) ferment la marche : fallback toujours dispo, sans clé.
  translation: ["groq", "openrouter", "openai", "gemini", "pollinations", "llm7"],
  tts: ["elevenlabs", "openai", "gemini"],
};

const DEFAULT_SETTINGS: SettingsState = {
  taskAssignments: { ...DEFAULT_ASSIGNMENTS },
  providerBaseUrls: {},
};

// --- Storage ---

const STORAGE_KEY = "vocaleez-ai-settings";

/**
 * Migration ponctuelle : capture (en mémoire, au chargement du module) les éventuelles
 * clés héritées stockées EN CLAIR dans le localStorage, avant qu'elles ne soient purgées.
 * `useProviderKeys` les ré-importe ensuite dans le store serveur chiffré.
 */
export const LEGACY_PLAINTEXT_KEYS: { provider: Provider; key: string; label?: string }[] = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.apiKeys)) return [];
    return parsed.apiKeys
      .filter((k: any) => k && typeof k.key === "string" && k.key.trim())
      .map((k: any) => ({ provider: k.provider as Provider, key: k.key, label: k.label }));
  } catch {
    return [];
  }
})();

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Retire toute ancienne clé en clair (apiKeys) : les clés vivent désormais chiffrées en base.
      const { apiKeys: _legacy, ...rest } = parsed;
      return {
        ...DEFAULT_SETTINGS,
        ...rest,
        providerBaseUrls: rest.providerBaseUrls ?? {},
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(state: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- Payload de la chaîne LLM envoyé au backend (routing + failover) ---

export interface LlmConfigEntry {
  provider: Provider;
  keys: string[];
  baseUrl?: string;
  model?: string;
}

/**
 * Construit la chaîne de fournisseurs (ordre de priorité d'une tâche donnée) à transmettre
 * au backend dans chaque requête. On inclut TOUS les fournisseurs de la chaîne — même sans
 * clé utilisateur — car le backend ajoutera lui-même le repli .env et les tiers gratuits.
 * Utilisé pour translation (chat LLM), transcription (Whisper) et tts.
 */
export function buildTaskConfig(settings: SettingsState, task: Task): LlmConfigEntry[] {
  const chain = settings.taskAssignments[task]?.length
    ? settings.taskAssignments[task]
    : DEFAULT_ASSIGNMENTS[task];

  return chain
    .filter((provider) => PROVIDERS[provider])
    .map((provider) => {
      // Les clés ne sont plus envoyées par le client : le backend les injecte depuis la base.
      const entry: LlmConfigEntry = { provider, keys: [] };
      const baseUrl = settings.providerBaseUrls[provider];
      if (baseUrl) entry.baseUrl = baseUrl;
      // Le modèle est fixé côté serveur (defaultModel par fournisseur).
      return entry;
    });
}

/** Raccourci : chaîne de la tâche "translation" (chat LLM). */
export function buildLlmConfig(settings: SettingsState): LlmConfigEntry[] {
  return buildTaskConfig(settings, "translation");
}

// --- Hook ---

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setTaskProviders = useCallback((task: Task, providers: Provider[]) => {
    setSettings((prev) => ({
      ...prev,
      taskAssignments: { ...prev.taskAssignments, [task]: providers },
    }));
  }, []);

  const setProviderBaseUrl = useCallback((provider: Provider, url: string) => {
    setSettings((prev) => ({
      ...prev,
      providerBaseUrls: { ...prev.providerBaseUrls, [provider]: url },
    }));
  }, []);

  const getProvidersForTask = useCallback(
    (task: Task): Provider[] => {
      return settings.taskAssignments[task] || DEFAULT_ASSIGNMENTS[task];
    },
    [settings.taskAssignments]
  );

  return {
    settings,
    setTaskProviders,
    setProviderBaseUrl,
    getProvidersForTask,
  };
}
