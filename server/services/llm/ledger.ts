/**
 * Ledger mémoire santé + rate-limit pour le routeur LLM.
 *
 * Reprend (en simplifié) les concepts de `ratelimit.ts` + `health.ts` de
 * FreeLLMAPI : on suit la consommation et l'état par tuple
 * `(provider, model, clé)`. Le ledger vit dans la mémoire du process serveur
 * et persiste donc entre les requêtes, même si la config des clés est envoyée
 * à chaque requête par le frontend.
 *
 * Deux mécanismes :
 *  - Réactif (principal) : sur 429/5xx, on pose un cooldown sur la clé.
 *  - Proactif (optionnel) : si rpm/rpd sont définis pour le fournisseur, on
 *    évite de dépasser le plafond free-tier connu.
 */

import crypto from 'crypto';
import type { LlmProviderDef } from './providers.js';

export type LedgerStatus = 'healthy' | 'cooldown' | 'rate_limited' | 'invalid' | 'error';

interface LedgerEntry {
  rpmCount: number;
  rpmWindowStart: number;
  rpdCount: number;
  rpdWindowStart: number;
  cooldownUntil: number; // epoch ms ; 0 = pas de cooldown
  status: LedgerStatus;
  lastError?: string;
}

const RPM_WINDOW_MS = 60_000;
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000;

// Durées de cooldown réactif
const COOLDOWN_429_MS = 60_000; // rate limit fournisseur
const COOLDOWN_5XX_MS = 15_000; // erreur serveur transitoire
const COOLDOWN_INVALID_MS = 10 * 60_000; // clé invalide (401/403) — on l'écarte longtemps

const ledger = new Map<string, LedgerEntry>();

/** Identifiant court et non réversible d'une clé (jamais la clé brute). */
export function keyIdFor(rawKey: string | undefined | null): string {
  if (!rawKey) return 'public';
  return crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 10);
}

function ledgerKey(provider: string, model: string, keyId: string): string {
  return `${provider}:${model}:${keyId}`;
}

function getEntry(k: string): LedgerEntry {
  let e = ledger.get(k);
  if (!e) {
    const now = Date.now();
    e = {
      rpmCount: 0,
      rpmWindowStart: now,
      rpdCount: 0,
      rpdWindowStart: now,
      cooldownUntil: 0,
      status: 'healthy',
    };
    ledger.set(k, e);
  }
  return e;
}

function rollWindows(e: LedgerEntry, now: number) {
  if (now - e.rpmWindowStart >= RPM_WINDOW_MS) {
    e.rpmWindowStart = now;
    e.rpmCount = 0;
  }
  if (now - e.rpdWindowStart >= RPD_WINDOW_MS) {
    e.rpdWindowStart = now;
    e.rpdCount = 0;
  }
}

/**
 * Une clé est-elle utilisable maintenant ? (pas en cooldown, sous les plafonds connus)
 */
export function isAvailable(provider: LlmProviderDef, model: string, keyId: string): boolean {
  const now = Date.now();
  const e = getEntry(ledgerKey(provider.id, model, keyId));
  rollWindows(e, now);

  if (e.cooldownUntil > now) return false;
  // Le cooldown est expiré : on repasse l'état à healthy.
  if (e.status === 'cooldown' || e.status === 'rate_limited') e.status = 'healthy';
  if (e.status === 'invalid') return false; // clé invalide : écartée jusqu'à expiration du cooldown ci-dessus

  if (provider.rpm && e.rpmCount >= provider.rpm) return false;
  if (provider.rpd && e.rpdCount >= provider.rpd) return false;

  return true;
}

export function recordSuccess(provider: LlmProviderDef, model: string, keyId: string) {
  const now = Date.now();
  const e = getEntry(ledgerKey(provider.id, model, keyId));
  rollWindows(e, now);
  e.rpmCount += 1;
  e.rpdCount += 1;
  e.status = 'healthy';
  e.cooldownUntil = 0;
  e.lastError = undefined;
}

/**
 * Enregistre un échec et pose un cooldown adapté au type d'erreur.
 * `status` est le code HTTP si disponible.
 */
export function recordFailure(
  provider: LlmProviderDef,
  model: string,
  keyId: string,
  httpStatus: number | undefined,
  message?: string,
) {
  const now = Date.now();
  const e = getEntry(ledgerKey(provider.id, model, keyId));
  rollWindows(e, now);
  e.lastError = message;

  if (httpStatus === 429) {
    e.status = 'rate_limited';
    e.cooldownUntil = now + COOLDOWN_429_MS;
    // On considère la fenêtre rpm comme saturée pour éviter de re-cogner.
    if (provider.rpm) e.rpmCount = provider.rpm;
  } else if (httpStatus === 401 || httpStatus === 403) {
    e.status = 'invalid';
    e.cooldownUntil = now + COOLDOWN_INVALID_MS;
  } else if (httpStatus !== undefined && httpStatus >= 500) {
    e.status = 'error';
    e.cooldownUntil = now + COOLDOWN_5XX_MS;
  } else {
    // Erreur réseau / timeout / inconnue : court cooldown.
    e.status = 'error';
    e.cooldownUntil = now + COOLDOWN_5XX_MS;
  }
}

/** Réinitialise tout le ledger (tests). */
export function _resetLedger() {
  ledger.clear();
}
