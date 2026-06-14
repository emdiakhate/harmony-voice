import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Format canonique de l'audio assemblé.
// Tous les fournisseurs TTS sortent en mono ; 44,1 kHz est la cadence source la plus
// élevée (ElevenLabs/Piper) → normaliser ici est sans perte pour eux et un simple
// suréchantillonnage propre pour les sources 24 kHz (Gemini/OpenAI/Edge).
const TARGET_SAMPLE_RATE = 44100;

/**
 * Assemble plusieurs buffers audio (MP3/WAV/…) en UN seul MP3 propre.
 *
 * Pourquoi : coller bout à bout des fichiers MP3 déjà encodés via `Buffer.concat()`
 * empile plusieurs en-têtes (ID3/Xing/Info) et mélange des fréquences d'échantillonnage
 * différentes (24 kHz Gemini/OpenAI/Edge vs 44,1 kHz ElevenLabs/Piper, silences/jingles).
 * Résultat : le lecteur verrouille la cadence sur la première trame et rejoue les autres
 * à la mauvaise vitesse (voix 3× trop rapide/lente), et calcule une durée fausse →
 * longues coupures silencieuses.
 *
 * Ici on décode chaque morceau, on le ré-échantillonne vers une cadence unique, puis on
 * ré-encode l'ensemble en un seul flux MP3 cohérent (en-tête + durée corrects).
 */
export async function concatMp3Buffers(buffers: Buffer[]): Promise<Buffer> {
  const parts = buffers.filter((b) => b && b.length > 0);

  if (parts.length === 0) {
    throw new Error('concatMp3Buffers: aucun buffer audio non vide à assembler');
  }
  // Un seul morceau : déjà un MP3 propre d'un seul fournisseur → rien à ré-encoder.
  if (parts.length === 1) {
    return parts[0];
  }

  const tmpDir = os.tmpdir();
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inputPaths = parts.map((_, i) => path.join(tmpDir, `concat_${stamp}_${i}.bin`));
  const outPath = path.join(tmpDir, `concat_${stamp}_out.mp3`);

  try {
    parts.forEach((buf, i) => fs.writeFileSync(inputPaths[i], buf));

    // Pour chaque entrée : ré-échantillonnage vers la cadence cible + format uniforme
    // (s16, mono) pour que le filtre `concat` reçoive des flux compatibles, puis
    // ré-encodage MP3 en une seule passe → un fichier valide avec une durée correcte.
    const inputArgs: string[] = [];
    const filterLabels: string[] = [];
    let filter = '';
    inputPaths.forEach((p, i) => {
      inputArgs.push('-i', p);
      filter += `[${i}:a]aresample=${TARGET_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono[a${i}];`;
      filterLabels.push(`[a${i}]`);
    });
    filter += `${filterLabels.join('')}concat=n=${parts.length}:v=0:a=1[out]`;

    await execFileAsync('ffmpeg', [
      '-v', 'error',
      '-y',
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[out]',
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      outPath,
    ], { timeout: 300000, maxBuffer: 1024 * 1024 * 16 });

    return fs.readFileSync(outPath);
  } catch (err: any) {
    // Filet de sécurité : ne jamais renvoyer « pas d'audio ». Si ffmpeg échoue ou est
    // absent, on retombe sur l'ancien comportement (concat brut) — au pire l'audio est
    // tel qu'avant le correctif, mais on ne perd jamais le résultat.
    console.error(`[audio-concat] Fusion ffmpeg échouée, repli sur concat brut: ${err?.message || err}`);
    return Buffer.concat(parts);
  } finally {
    for (const p of inputPaths) {
      try { fs.unlinkSync(p); } catch {}
    }
    try { fs.unlinkSync(outPath); } catch {}
  }
}
