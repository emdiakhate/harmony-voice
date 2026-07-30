import { describe, it, expect } from 'vitest';
import { splitTextIntoChunks } from './translator.js';

describe('splitTextIntoChunks', () => {
  it('renvoie un tableau vide pour une chaîne vide', () => {
    expect(splitTextIntoChunks('', 100)).toEqual([]);
  });

  it('garde un texte court en un seul bloc', () => {
    const text = 'Bonjour le monde.';
    expect(splitTextIntoChunks(text, 100)).toEqual(['Bonjour le monde.']);
  });

  it('découpe aux frontières de phrases sans dépasser maxLength', () => {
    const text = 'Phrase une. Phrase deux. Phrase trois. Phrase quatre.';
    const chunks = splitTextIntoChunks(text, 25);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(25);
    }
    // Aucune donnée perdue : la concaténation contient toutes les phrases.
    const joined = chunks.join(' ');
    expect(joined).toContain('Phrase une');
    expect(joined).toContain('Phrase quatre');
  });

  it('conserve un texte sans frontière de phrase en un seul bloc (aucune perte)', () => {
    // Limitation connue : sans ponctuation, le découpage par phrase ne peut pas
    // séparer le texte ; il reste en un bloc unique (pas de troncature/perte).
    const text = 'a'.repeat(250);
    const chunks = splitTextIntoChunks(text, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks.join('')).toHaveLength(250);
  });

  it('ne produit pas de blocs vides', () => {
    const text = 'Un. Deux. Trois.';
    const chunks = splitTextIntoChunks(text, 10);
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
  });
});
