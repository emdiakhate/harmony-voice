/**
 * Génération de couverture (miniature) pour un audio / podcast — façon livre audio.
 *
 * Réutilise le moteur de failover du routeur (`runWithFallback`) : la chaîne d'essais
 * est résolue par `resolveImageConfig` (OpenRouter « nano banana » → repli gratuit
 * Pollinations). Chaque fournisseur a sa propre logique d'appel :
 *   - OpenRouter : modèle image via /chat/completions (modalities image+text) →
 *     l'image revient en data URL base64 dans `message.images[]` ; supporte une image
 *     de référence en entrée.
 *   - Pollinations : simple GET sur image.pollinations.ai (sans clé, sans référence).
 *
 * L'image peut ensuite être embarquée comme pochette ID3 du MP3 (`embedCoverArt`),
 * pour s'afficher dans n'importe quel lecteur externe.
 */

import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runWithFallback, type Attempt } from './llm/router.js';

const execFileAsync = promisify(execFile);

/** Délai max par essai (la génération d'image peut être lente). */
const IMAGE_TIMEOUT_MS = 90_000;

export type CoverStyle =
  | 'audiobook'
  | 'minimal'
  | 'photographic'
  | 'illustrated'
  | 'abstract';

const STYLE_DESCRIPTORS: Record<CoverStyle, string> = {
  audiobook:
    'classic professional audiobook cover, clean layout, dramatic lighting, premium publishing look',
  minimal:
    'minimalist design, lots of negative space, simple geometric shapes, refined modern typography',
  photographic:
    'photorealistic cinematic photography, rich depth of field, natural lighting',
  illustrated:
    'hand-drawn editorial illustration, warm colors, artistic and expressive',
  abstract:
    'bold abstract art, vibrant gradients and shapes, contemporary and eye-catching',
};

export interface CoverPromptInput {
  title?: string;
  author?: string;
  subtitle?: string;
  style?: CoverStyle;
  /** Extrait du contenu (traduction/résumé) pour guider le sujet visuel. */
  contentHint?: string;
}

/** Construit un prompt « pochette de livre audio » à partir des métadonnées. */
export function buildCoverPrompt(input: CoverPromptInput): string {
  const style = STYLE_DESCRIPTORS[input.style ?? 'audiobook'];
  const lines: string[] = [
    'Design a square book / audiobook cover artwork.',
    `Style: ${style}.`,
    'Square 1:1 composition, high contrast, sharp focus, visually striking, suitable as a small thumbnail.',
  ];

  if (input.title?.trim()) {
    lines.push(`Render the TITLE prominently and legibly: "${input.title.trim()}".`);
  }
  if (input.subtitle?.trim()) {
    lines.push(`Smaller subtitle text: "${input.subtitle.trim()}".`);
  }
  if (input.author?.trim()) {
    lines.push(`Author name credited at the bottom: "${input.author.trim()}".`);
  }

  const hint = (input.contentHint || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (hint) {
    lines.push(`The cover should visually evoke this content: ${hint}`);
  }

  lines.push('Avoid spelling mistakes in any rendered text. No watermark, no borders.');
  return lines.join('\n');
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return Buffer.from(dataUrl, 'base64');
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  return meta.includes('base64')
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data), 'utf8');
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Erreur portant le statut HTTP pour que le ledger applique le bon cooldown. */
function httpError(status: number, message: string): Error {
  const err: any = new Error(message);
  err.status = status;
  return err;
}

/** OpenRouter : génération via /chat/completions (modalities image+text). */
async function runOpenRouter(attempt: Attempt, prompt: string, referenceImageDataUrl?: string): Promise<Buffer> {
  const content: any[] = [{ type: 'text', text: prompt }];
  if (referenceImageDataUrl) {
    content.push({ type: 'image_url', image_url: { url: referenceImageDataUrl } });
  }

  const resp = await fetchWithTimeout(`${attempt.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${attempt.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: attempt.model,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw httpError(resp.status, `OpenRouter image ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await resp.json();
  const dataUrl: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) {
    throw new Error('OpenRouter: aucune image dans la réponse (le modèle ne sait peut-être pas générer d\'image)');
  }
  return dataUrlToBuffer(dataUrl);
}

/** Pollinations : GET direct, gratuit, sans clé (pas d'image de référence). */
async function runPollinations(attempt: Attempt, prompt: string): Promise<Buffer> {
  // `referrer` aide la fiabilité du tier anonyme (throttling/file d'attente Pollinations).
  const url =
    `${attempt.baseURL}/prompt/${encodeURIComponent(prompt)}` +
    `?width=1024&height=1024&nologo=true&referrer=vocaleezai&model=${encodeURIComponent(attempt.model)}`;

  const resp = await fetchWithTimeout(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw httpError(resp.status, `Pollinations image ${resp.status}: ${body.slice(0, 200)}`);
  }
  const ct = resp.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) {
    throw new Error(`Pollinations: réponse non-image (content-type ${ct || 'inconnu'})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export interface GenerateCoverOptions {
  prompt: string;
  referenceImageDataUrl?: string;
  attempts: Attempt[];
  onProviderSwitch?: (from: string, to: string) => void;
}

/**
 * Génère l'image de couverture en parcourant la chaîne (clés user > .env > gratuit),
 * avec bascule automatique sur erreur. Lève si tous les fournisseurs échouent.
 */
export async function generateCoverImage(opts: GenerateCoverOptions): Promise<Buffer> {
  return runWithFallback<Buffer>({
    attempts: opts.attempts,
    label: 'ImageGen',
    onProviderSwitch: opts.onProviderSwitch,
    isEmpty: (b) => !b || b.length === 0,
    run: (attempt) =>
      attempt.def.id === 'pollinations'
        ? runPollinations(attempt, opts.prompt)
        : runOpenRouter(attempt, opts.prompt, opts.referenceImageDataUrl),
  });
}

/**
 * Embarque une image comme pochette ID3 d'un MP3 (best-effort, via ffmpeg).
 * En cas d'échec (ffmpeg absent/erreur), on ne touche pas au fichier d'origine —
 * la couverture reste affichée côté app.
 */
export async function embedCoverArt(mp3Path: string, coverPath: string): Promise<void> {
  const tmpOut = `${mp3Path}.cover_tmp.mp3`;
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-v', 'error',
        '-y',
        '-i', mp3Path,
        '-i', coverPath,
        '-map', '0:a',
        '-map', '1',
        '-c', 'copy',
        '-id3v2_version', '3',
        '-metadata:s:v', 'title=Album cover',
        '-metadata:s:v', 'comment=Cover (front)',
        '-disposition:v', 'attached_pic',
        tmpOut,
      ],
      { timeout: 120_000, maxBuffer: 1024 * 1024 * 16 },
    );
    fs.renameSync(tmpOut, mp3Path);
  } catch (err: any) {
    console.error(`[cover] Intégration ID3 échouée (best-effort): ${err?.message || err}`);
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}
