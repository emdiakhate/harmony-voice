import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isAvailable,
  recordSuccess,
  recordFailure,
  keyIdFor,
  _resetLedger,
} from './ledger.js';
import type { LlmProviderDef } from './providers.js';

const provider: LlmProviderDef = {
  id: 'test',
  label: 'Test',
  baseURL: 'https://example.com/v1',
  defaultModel: 'test-model',
  requiresKey: true,
  rpm: 3,
  rpd: 5,
};

const MODEL = 'test-model';
const KEY = 'key-abc';

beforeEach(() => {
  _resetLedger();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('keyIdFor', () => {
  it('renvoie "public" pour une clé absente', () => {
    expect(keyIdFor(undefined)).toBe('public');
    expect(keyIdFor(null)).toBe('public');
    expect(keyIdFor('')).toBe('public');
  });

  it('est déterministe et ne révèle pas la clé brute', () => {
    const id = keyIdFor('secret-key');
    expect(id).toBe(keyIdFor('secret-key'));
    expect(id).not.toContain('secret');
    expect(id).toHaveLength(10);
  });
});

describe('ledger — disponibilité de base', () => {
  it('une clé neuve est disponible', () => {
    expect(isAvailable(provider, MODEL, KEY)).toBe(true);
  });

  it('respecte le plafond rpm proactif', () => {
    recordSuccess(provider, MODEL, KEY);
    recordSuccess(provider, MODEL, KEY);
    recordSuccess(provider, MODEL, KEY); // atteint rpm=3
    expect(isAvailable(provider, MODEL, KEY)).toBe(false);
  });
});

describe('ledger — cooldowns réactifs', () => {
  it('un 429 met la clé en cooldown puis elle redevient disponible après expiration', () => {
    vi.useFakeTimers();
    recordFailure(provider, MODEL, KEY, 429, 'rate limited');
    expect(isAvailable(provider, MODEL, KEY)).toBe(false);

    // Cooldown 429 = 60s
    vi.advanceTimersByTime(61_000);
    expect(isAvailable(provider, MODEL, KEY)).toBe(true);
  });

  it('un 401 (clé invalide) écarte la clé longtemps (10 min)', () => {
    vi.useFakeTimers();
    recordFailure(provider, MODEL, KEY, 401, 'invalid key');
    expect(isAvailable(provider, MODEL, KEY)).toBe(false);

    vi.advanceTimersByTime(60_000); // 1 min : toujours indisponible
    expect(isAvailable(provider, MODEL, KEY)).toBe(false);

    vi.advanceTimersByTime(10 * 60_000); // au-delà de 10 min
    expect(isAvailable(provider, MODEL, KEY)).toBe(true);
  });

  it('une erreur 5xx pose un cooldown court (15s)', () => {
    vi.useFakeTimers();
    recordFailure(provider, MODEL, KEY, 503, 'server error');
    expect(isAvailable(provider, MODEL, KEY)).toBe(false);

    vi.advanceTimersByTime(16_000);
    expect(isAvailable(provider, MODEL, KEY)).toBe(true);
  });

  it('un succès efface un cooldown existant', () => {
    recordFailure(provider, MODEL, KEY, 503);
    recordSuccess(provider, MODEL, KEY);
    expect(isAvailable(provider, MODEL, KEY)).toBe(true);
  });
});

describe('ledger — isolation par clé', () => {
  it('le cooldown d\'une clé n\'affecte pas une autre clé', () => {
    recordFailure(provider, MODEL, 'key-1', 429);
    expect(isAvailable(provider, MODEL, 'key-1')).toBe(false);
    expect(isAvailable(provider, MODEL, 'key-2')).toBe(true);
  });
});
