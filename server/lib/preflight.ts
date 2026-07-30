import { execSync } from 'child_process';

/**
 * Vérification des dépendances système externes (ffmpeg, yt-dlp).
 *
 * Elles sont appelées en sous-processus par plusieurs services et ne sont pas
 * installables via npm. Sans elles, certaines fonctionnalités échouent tard, au
 * milieu d'un traitement, avec une erreur cryptique. On les détecte donc au
 * démarrage et on expose l'état via GET /api/health pour que l'UI puisse alerter.
 */

export interface DependencyStatus {
  /** ffmpeg : requis pour TTS (concat), fusion audio/vidéo, split, normalisation. */
  ffmpeg: boolean;
  /** yt-dlp (ou `python -m yt_dlp`) : requis pour le mode YouTube. */
  ytdlp: boolean;
}

function canRun(command: string): boolean {
  try {
    execSync(command, { stdio: 'ignore', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

let cached: DependencyStatus | null = null;

/** Détecte les binaires système. Résultat mis en cache (les binaires ne changent pas à chaud). */
export function checkSystemDependencies(force = false): DependencyStatus {
  if (cached && !force) return cached;

  const ffmpeg = canRun('ffmpeg -version');
  // yt-dlp peut être dans le PATH, ou disponible via un module Python.
  const ytdlp =
    canRun('yt-dlp --version') ||
    canRun('python -m yt_dlp --version') ||
    canRun('python3 -m yt_dlp --version');

  cached = { ffmpeg, ytdlp };
  return cached;
}

/** Affiche un récapitulatif clair au démarrage, avec l'impact de chaque dépendance manquante. */
export function logDependencyStatus(): DependencyStatus {
  const status = checkSystemDependencies(true);

  console.log('[Preflight] Dépendances système :');
  console.log(
    `  ffmpeg : ${status.ffmpeg ? 'OK' : 'MANQUANT'}${
      status.ffmpeg ? '' : ' — TTS, fusion audio/vidéo, split PDF audio et normalisation seront indisponibles.'
    }`,
  );
  console.log(
    `  yt-dlp : ${status.ytdlp ? 'OK' : 'MANQUANT'}${
      status.ytdlp ? '' : ' — le mode YouTube (URL) sera indisponible. Installez-le : pip install yt-dlp'
    }`,
  );

  if (!status.ffmpeg || !status.ytdlp) {
    console.warn(
      '[Preflight] Des dépendances système manquent. Consultez la section « Prérequis » du README.',
    );
  }

  return status;
}
