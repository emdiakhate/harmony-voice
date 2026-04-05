import { useState, useEffect, useCallback } from "react";

// --- Types ---

export type Provider = "openai" | "gemini" | "groq" | "openrouter" | "elevenlabs" | "claude";

export type Task = "transcription" | "translation" | "tts";

export interface ApiKeyEntry {
  id: string;
  provider: Provider;
  key: string;
  label: string;
  isValid: boolean | null; // null = not tested
  disabled: boolean;
}

export interface TaskProviderAssignment {
  transcription: Provider[];
  translation: Provider[];
  tts: Provider[];
}

export interface SettingsState {
  apiKeys: ApiKeyEntry[];
  taskAssignments: TaskProviderAssignment;
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
    color: "#000000",
    capabilities: ["tts"],
    placeholder: "xi-...",
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  claude: {
    name: "Claude (Anthropic)",
    color: "#d97706",
    capabilities: ["translation"],
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
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
  translation: ["groq", "openrouter", "openai", "gemini", "claude"],
  tts: ["elevenlabs", "openai", "gemini"],
};

// --- Storage ---

const STORAGE_KEY = "vocaleez-ai-settings";

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { apiKeys: [], taskAssignments: { ...DEFAULT_ASSIGNMENTS } };
}

function saveSettings(state: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- Hook ---

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const addApiKey = useCallback((provider: Provider, key: string, label: string) => {
    setSettings((prev) => ({
      ...prev,
      apiKeys: [
        ...prev.apiKeys,
        { id: generateId(), provider, key, label, isValid: null, disabled: false },
      ],
    }));
  }, []);

  const removeApiKey = useCallback((id: string) => {
    setSettings((prev) => ({
      ...prev,
      apiKeys: prev.apiKeys.filter((k) => k.id !== id),
    }));
  }, []);

  const updateApiKey = useCallback((id: string, updates: Partial<ApiKeyEntry>) => {
    setSettings((prev) => ({
      ...prev,
      apiKeys: prev.apiKeys.map((k) => (k.id === id ? { ...k, ...updates } : k)),
    }));
  }, []);

  const setTaskProviders = useCallback((task: Task, providers: Provider[]) => {
    setSettings((prev) => ({
      ...prev,
      taskAssignments: { ...prev.taskAssignments, [task]: providers },
    }));
  }, []);

  const getProvidersForTask = useCallback(
    (task: Task): Provider[] => {
      return settings.taskAssignments[task] || DEFAULT_ASSIGNMENTS[task];
    },
    [settings.taskAssignments]
  );

  const getKeysForProvider = useCallback(
    (provider: Provider): ApiKeyEntry[] => {
      return settings.apiKeys.filter((k) => k.provider === provider && !k.disabled);
    },
    [settings.apiKeys]
  );

  const hasKeyForProvider = useCallback(
    (provider: Provider): boolean => {
      return settings.apiKeys.some((k) => k.provider === provider && !k.disabled);
    },
    [settings.apiKeys]
  );

  return {
    settings,
    addApiKey,
    removeApiKey,
    updateApiKey,
    setTaskProviders,
    getProvidersForTask,
    getKeysForProvider,
    hasKeyForProvider,
  };
}
