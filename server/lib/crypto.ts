/**
 * Chiffrement des clés API stockées en base (AES-256-GCM), inspiré de FreeLLMAPI.
 *
 * Les clés ne sont jamais persistées en clair : on stocke `iv:authTag:ciphertext`
 * (base64) et on déchiffre uniquement en mémoire, au moment d'appeler un fournisseur.
 *
 * La clé de chiffrement est résolue dans cet ordre (zéro configuration pour un
 * usage local) :
 *   1) ENCRYPTION_KEY (hex 64) dans l'environnement — préserve les données existantes ;
 *   2) fichier local `.encryption-key` (généré au 1er lancement) ;
 *   3) génération automatique d'une clé 32 octets, persistée dans `.encryption-key`.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGO = 'aes-256-gcm';
const KEY_FILE = path.join(process.cwd(), '.encryption-key');

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  // 1) Variable d'environnement (prioritaire — ne casse pas une installation existante).
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv && fromEnv.length === 64) {
    cachedKey = Buffer.from(fromEnv, 'hex');
    return cachedKey;
  }

  // 2) Fichier local déjà généré.
  try {
    if (fs.existsSync(KEY_FILE)) {
      const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
      if (hex.length === 64) {
        cachedKey = Buffer.from(hex, 'hex');
        return cachedKey;
      }
    }
  } catch {
    /* on régénère ci-dessous */
  }

  // 3) Génération automatique + persistance.
  const hex = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(KEY_FILE, hex, { encoding: 'utf8', mode: 0o600 });
    console.log('[Crypto] Clé de chiffrement générée automatiquement → .encryption-key');
  } catch (e: any) {
    console.warn("[Crypto] Impossible d'écrire .encryption-key (clé en mémoire uniquement) :", e?.message);
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/** Indique si le chiffrement est utilisable (toujours vrai : clé auto-générée au besoin). */
export function isEncryptionConfigured(): boolean {
  try {
    return getKey().length === 32;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Payload chiffré invalide');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Aperçu masqué d'une clé en clair, pour l'affichage (jamais la clé entière). */
export function maskKey(plain: string): string {
  if (plain.length <= 8) return '•'.repeat(plain.length);
  return `${plain.slice(0, 4)}…${plain.slice(-4)}`;
}
