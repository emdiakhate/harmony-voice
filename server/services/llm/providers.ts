/**
 * Catalogue des fournisseurs LLM compatibles OpenAI (chat completions).
 *
 * Inspiré de FreeLLMAPI : on agrège plusieurs fournisseurs (clés utilisateur +
 * repli .env + tiers gratuits sans clé) derrière une seule interface
 * `/chat/completions`. Tous ces fournisseurs exposent un endpoint compatible
 * avec le SDK `openai` (il suffit de changer `baseURL`).
 *
 * Portée actuelle : LLM-texte uniquement (traduction, détection de langue,
 * résumé, script podcast). La transcription (Whisper) et le TTS ont leur
 * propre logique de fallback ailleurs.
 */

export type LlmProviderId =
  | 'groq'
  | 'openrouter'
  | 'openai'
  | 'gemini'
  | 'pollinations'
  | 'llm7';

export interface LlmProviderDef {
  // Généralisé en string : le même type sert aux catalogues chat, transcription et TTS
  // (qui incluent des ids hors de l'union LlmProviderId, ex. 'elevenlabs').
  id: string;
  /** Nom lisible (logs). */
  label: string;
  /** Base URL compatible OpenAI (`{baseURL}/chat/completions`). */
  baseURL: string;
  /** Modèle par défaut si l'appelant n'en impose pas. */
  defaultModel: string;
  /** Variable d'env servant de repli quand l'utilisateur n'a pas de clé. */
  envKey?: string;
  /** Faux pour les tiers 100% gratuits (Pollinations, LLM7) — aucune clé requise. */
  requiresKey: boolean;
  /** Placeholder envoyé au SDK quand aucune clé n'est nécessaire (le client `openai` refuse une clé vide). */
  noKeyPlaceholder?: string;
  /** Plafonds free-tier indicatifs pour le throttling proactif du ledger (optionnels). */
  rpm?: number;
  rpd?: number;
}

/**
 * Catalogue extensible. Pour ajouter Cerebras / SambaNova / Mistral / Cohere
 * plus tard, il suffit d'ajouter une entrée ici (même forme) — aucun autre
 * changement nécessaire dans le routeur.
 */
export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderDef> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
    requiresKey: true,
    rpm: 30,
    rpd: 14400,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    envKey: 'OPENROUTER_API_KEY',
    requiresKey: true,
    rpm: 20,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    requiresKey: true,
  },
  gemini: {
    id: 'gemini',
    // Endpoint compatible OpenAI de Google (chat completions).
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    envKey: 'GOOGLE_API_KEY',
    requiresKey: true,
    rpm: 15,
    rpd: 1500,
  },
  pollinations: {
    id: 'pollinations',
    label: 'Pollinations (gratuit)',
    baseURL: 'https://text.pollinations.ai/openai',
    defaultModel: 'openai',
    requiresKey: false,
    noKeyPlaceholder: 'unused',
    rpm: 15,
  },
  llm7: {
    id: 'llm7',
    label: 'LLM7 (gratuit)',
    baseURL: 'https://api.llm7.io/v1',
    defaultModel: 'gpt-4o-mini-2024-07-18',
    requiresKey: false,
    // LLM7 accepte un jeton public « unused » pour l'accès anonyme.
    noKeyPlaceholder: 'unused',
    rpm: 10,
  },
};

export function getProviderDef(id: string): LlmProviderDef | undefined {
  return (LLM_PROVIDERS as Record<string, LlmProviderDef>)[id];
}

/** Ordre de priorité par défaut pour la traduction/LLM si l'utilisateur n'a rien défini. */
export const DEFAULT_LLM_CHAIN: LlmProviderId[] = [
  'groq',
  'openrouter',
  'openai',
  'gemini',
  'pollinations',
  'llm7',
];

// ===== Phase 2 : Transcription (Whisper) =====
// Pas de tier gratuit pour la transcription (OpenRouter/Pollinations ne font pas Whisper).
// Groq et OpenAI exposent tous deux l'API audio.transcriptions.

export const TRANSCRIBE_PROVIDERS: Record<string, LlmProviderDef> = {
  groq: {
    id: 'groq',
    label: 'Groq Whisper',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3-turbo',
    envKey: 'GROQ_API_KEY',
    requiresKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI Whisper',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'whisper-1',
    envKey: 'OPENAI_API_KEY',
    requiresKey: true,
  },
};

export const DEFAULT_TRANSCRIBE_CHAIN: string[] = ['groq', 'openai'];

// ===== Phase 2 : Synthèse vocale (TTS) =====
// Fournisseurs à clé. Les fallbacks gratuits (Piper local, Edge TTS, Google Translate TTS)
// sont gérés directement dans tts.ts APRÈS cette chaîne — ils ne nécessitent pas de clé.

export const TTS_PROVIDERS: Record<string, LlmProviderDef> = {
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    baseURL: 'https://api.elevenlabs.io',
    defaultModel: 'eleven_multilingual_v2',
    envKey: 'ELEVENLABS_API_KEY',
    requiresKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI TTS',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'tts-1',
    envKey: 'OPENAI_API_KEY',
    requiresKey: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini TTS',
    baseURL: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash-preview-tts',
    envKey: 'GOOGLE_API_KEY',
    requiresKey: true,
  },
};

export const DEFAULT_TTS_CHAIN: string[] = ['elevenlabs', 'openai', 'gemini'];

// ===== Phase 3 : Génération d'image (couverture / miniature) =====
// OpenRouter expose les modèles « image » via /chat/completions (modalities image+text) —
// pas l'API images.generate ; la logique d'appel vit dans image-generator.ts.
// Pollinations fait office de repli 100% gratuit et sans clé (GET image.pollinations.ai).

export const IMAGE_PROVIDERS: Record<string, LlmProviderDef> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (Nano Banana)',
    baseURL: 'https://openrouter.ai/api/v1',
    // « nano banana » = Gemini 2.5 Flash Image (génération + édition avec image de référence).
    defaultModel: 'google/gemini-2.5-flash-image',
    envKey: 'OPENROUTER_API_KEY',
    requiresKey: true,
  },
  pollinations: {
    id: 'pollinations',
    label: 'Pollinations Image (gratuit)',
    baseURL: 'https://image.pollinations.ai',
    defaultModel: 'flux',
    requiresKey: false,
    noKeyPlaceholder: 'unused',
  },
};

export const DEFAULT_IMAGE_CHAIN: string[] = ['openrouter', 'pollinations'];
