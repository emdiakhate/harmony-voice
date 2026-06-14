/**
 * Chargement des clés API d'un utilisateur depuis la base (déchiffrées en mémoire)
 * et injection dans les chaînes de fournisseurs au moment de la requête.
 *
 * Les clés ne transitent plus par le navigateur : le client envoie l'ordre/les modèles
 * (sans clés), et le serveur injecte ici les clés stockées chiffrées en DB.
 */

import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import type { LlmConfigInput } from './router.js';

/** clés actives de l'utilisateur, groupées par fournisseur (déchiffrées). */
export async function loadUserKeys(userId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.providerKey.findMany({
    where: { userId, disabled: false },
    orderBy: { createdAt: 'asc' },
  });

  const map: Record<string, string[]> = {};
  for (const row of rows) {
    try {
      const plain = decrypt(row.encryptedKey);
      (map[row.provider] ||= []).push(plain);
    } catch {
      console.warn(`[Keystore] Déchiffrement impossible pour la clé ${row.id} (${row.provider}) — ignorée.`);
    }
  }
  return map;
}

/**
 * Injecte les clés DB de l'utilisateur dans une chaîne reçue du client (sans clés).
 * Les fournisseurs absents de la map gardent une liste vide → repli .env / tier gratuit
 * géré ensuite par resolveChain.
 */
export function injectKeys(
  config: LlmConfigInput | null,
  keyMap: Record<string, string[]>,
): LlmConfigInput | null {
  if (!config) return config;
  return config.map((entry) => ({
    ...entry,
    keys: keyMap[entry.provider] ?? entry.keys ?? [],
  }));
}
