/**
 * Routeur multi-clés (chat, transcription, TTS) — cœur du système inspiré de FreeLLMAPI.
 *
 * Une chaîne de fournisseurs ordonnée par priorité (réglages utilisateur + repli .env
 * + tiers gratuits) est parcourue dans l'ordre : on saute les clés en cooldown (ledger),
 * on tente, et on bascule automatiquement sur 429/5xx/erreur.
 *
 * `runWithFallback` est le moteur générique : il ne sait rien de l'API appelée. Chaque
 * domaine (chat, Whisper, TTS) fournit sa propre fonction `run(attempt)`.
 */

import OpenAI from 'openai';
import {
  LLM_PROVIDERS,
  DEFAULT_LLM_CHAIN,
  TRANSCRIBE_PROVIDERS,
  DEFAULT_TRANSCRIBE_CHAIN,
  TTS_PROVIDERS,
  DEFAULT_TTS_CHAIN,
  IMAGE_PROVIDERS,
  DEFAULT_IMAGE_CHAIN,
  type LlmProviderDef,
} from './providers.js';
import { isAvailable, recordSuccess, recordFailure, keyIdFor } from './ledger.js';

/** Entrée envoyée par le frontend (ou construite côté serveur). Ordre = priorité. */
export interface LlmConfigEntry {
  provider: string;
  keys?: string[]; // clés utilisateur (0..n)
  baseUrl?: string; // override optionnel (ex. OpenRouter custom)
  model?: string; // override optionnel du modèle
}

export type LlmConfigInput = LlmConfigEntry[];

/** Un « essai » concret : un fournisseur + une clé + un modèle. */
export interface Attempt {
  def: LlmProviderDef;
  baseURL: string;
  model: string;
  apiKey: string;
  keyId: string;
  /** true si c'est une clé .env (repli) plutôt qu'une clé utilisateur. */
  fromEnv: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompleteOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  attempts: Attempt[];
  onProviderSwitch?: (from: string, to: string) => void;
  label?: string;
}

/**
 * Construit la liste ordonnée d'essais à partir d'une config et d'un catalogue de fournisseurs.
 * - Ordre = ordre du tableau (priorité utilisateur), sinon `defaultOrder`.
 * - Pour chaque fournisseur : clés utilisateur d'abord, puis repli .env, puis slot
 *   « public » pour les tiers gratuits sans clé.
 * - Un fournisseur qui exige une clé mais n'en a aucune (ni user ni .env) est ignoré.
 */
export function resolveChain(
  input: LlmConfigInput | null | undefined,
  catalog: Record<string, LlmProviderDef>,
  defaultOrder: string[],
): Attempt[] {
  const chain: LlmConfigEntry[] =
    input && input.length > 0 ? input : defaultOrder.map((id) => ({ provider: id }));

  const attempts: Attempt[] = [];

  for (const entry of chain) {
    const def = catalog[entry.provider];
    if (!def) continue;

    const baseURL = entry.baseUrl?.trim() || def.baseURL;
    const model = entry.model?.trim() || def.defaultModel;

    const userKeys = (entry.keys || [])
      .map((k) => (k || '').trim())
      .filter((k) => k.length > 0);

    for (const key of userKeys) {
      attempts.push({ def, baseURL, model, apiKey: key, keyId: keyIdFor(key), fromEnv: false });
    }

    // Repli .env (après les clés utilisateur)
    const envKey = def.envKey ? process.env[def.envKey] : undefined;
    if (envKey && envKey.trim() && !userKeys.includes(envKey.trim())) {
      const k = envKey.trim();
      attempts.push({ def, baseURL, model, apiKey: k, keyId: keyIdFor(k), fromEnv: true });
    }

    // Tier gratuit sans clé
    if (!def.requiresKey && userKeys.length === 0) {
      attempts.push({
        def,
        baseURL,
        model,
        apiKey: def.noKeyPlaceholder || 'unused',
        keyId: 'public',
        fromEnv: false,
      });
    }
  }

  return attempts;
}

export function resolveLlmConfig(input?: LlmConfigInput | null): Attempt[] {
  return resolveChain(input, LLM_PROVIDERS, DEFAULT_LLM_CHAIN);
}

export function resolveTranscribeConfig(input?: LlmConfigInput | null): Attempt[] {
  return resolveChain(input, TRANSCRIBE_PROVIDERS, DEFAULT_TRANSCRIBE_CHAIN);
}

export function resolveTtsConfig(input?: LlmConfigInput | null): Attempt[] {
  return resolveChain(input, TTS_PROVIDERS, DEFAULT_TTS_CHAIN);
}

export function resolveImageConfig(input?: LlmConfigInput | null): Attempt[] {
  return resolveChain(input, IMAGE_PROVIDERS, DEFAULT_IMAGE_CHAIN);
}

/** Au moins un fournisseur LLM (chat) disponible ? Sert aux gardes des endpoints. */
export function hasAnyProvider(input?: LlmConfigInput | null): boolean {
  return resolveLlmConfig(input).length > 0;
}

function httpStatusOf(err: any): number | undefined {
  return err?.status ?? err?.statusCode ?? err?.response?.status;
}

export interface RunWithFallbackOptions<T> {
  attempts: Attempt[];
  label: string;
  /** Exécute l'appel pour un essai donné. Doit lever en cas d'échec. */
  run: (attempt: Attempt) => Promise<T>;
  /** Optionnel : considérer un résultat comme un échec léger (ex. réponse vide) → bascule. */
  isEmpty?: (result: T) => boolean;
  onProviderSwitch?: (from: string, to: string) => void;
}

/**
 * Moteur de failover générique. Parcourt les essais (clés en cooldown différées),
 * met à jour le ledger, et renvoie le premier succès. Lève si tout échoue.
 */
export async function runWithFallback<T>(opts: RunWithFallbackOptions<T>): Promise<T> {
  const { attempts, label, run, isEmpty, onProviderSwitch } = opts;

  if (attempts.length === 0) {
    throw new Error(`[${label}] Aucun fournisseur disponible (ni clé utilisateur, ni clé .env, ni tier gratuit).`);
  }

  const deferred: Attempt[] = [];
  let lastError: Error | null = null;
  let lastProvider: string | null = null;

  const tryAttempt = async (a: Attempt, ignoreCooldown: boolean): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (!ignoreCooldown && !isAvailable(a.def, a.model, a.keyId)) {
      deferred.push(a);
      return { ok: false };
    }

    if (lastProvider && lastProvider !== a.def.id) {
      onProviderSwitch?.(lastProvider, a.def.id);
    }
    lastProvider = a.def.id;

    const keySrc = a.keyId === 'public' ? 'sans clé' : a.fromEnv ? 'clé .env' : 'clé user';
    console.log(`[${label}] → ${a.def.label} (${a.model}, ${keySrc})`);

    try {
      const value = await run(a);
      if (isEmpty?.(value)) {
        recordFailure(a.def, a.model, a.keyId, undefined, 'réponse vide');
        lastError = new Error(`${a.def.label} a renvoyé une réponse vide`);
        return { ok: false };
      }
      recordSuccess(a.def, a.model, a.keyId);
      return { ok: true, value };
    } catch (err: any) {
      const status = httpStatusOf(err);
      recordFailure(a.def, a.model, a.keyId, status, err?.message);
      lastError = err;
      console.warn(`[${label}] ✗ ${a.def.label}: ${status ?? ''} ${err?.message || err}`);
      return { ok: false };
    }
  };

  // Passe 1 : respecter les cooldowns du ledger.
  for (const a of attempts) {
    const r = await tryAttempt(a, false);
    if (r.ok) return r.value;
  }

  // Passe 2 : retenter les différés en ignorant le cooldown.
  for (const a of deferred) {
    const r = await tryAttempt(a, true);
    if (r.ok) return r.value;
  }

  throw lastError || new Error(`[${label}] Tous les fournisseurs ont échoué.`);
}

async function callChat(attempt: Attempt, opts: ChatCompleteOptions): Promise<string> {
  const client = new OpenAI({ apiKey: attempt.apiKey, baseURL: attempt.baseURL });
  const resp = await client.chat.completions.create({
    model: attempt.model,
    messages: opts.messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  });
  return resp.choices?.[0]?.message?.content || '';
}

/**
 * Complétion chat en parcourant la chaîne de fournisseurs (clés user > .env > gratuit).
 * Lève si tous les candidats échouent.
 */
export async function chatComplete(opts: ChatCompleteOptions): Promise<string> {
  return runWithFallback<string>({
    attempts: opts.attempts,
    label: opts.label || 'LLM',
    onProviderSwitch: opts.onProviderSwitch,
    isEmpty: (s) => !s.trim(),
    run: (a) => callChat(a, opts),
  });
}

/** Décrit une chaîne résolue pour les logs (ex. "groq > openrouter(.env) > pollinations(free)"). */
export function describeChain(attempts: Attempt[]): string {
  const seen: string[] = [];
  for (const a of attempts) {
    const tag = `${a.def.id}${a.fromEnv ? '(.env)' : a.keyId === 'public' ? '(free)' : ''}`;
    if (!seen.includes(tag)) seen.push(tag);
  }
  return seen.join(' > ');
}

export { LLM_PROVIDERS };
