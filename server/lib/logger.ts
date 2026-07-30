/**
 * Journalisation minimale avec niveau réglable via la variable d'env `LOG_LEVEL`
 * (`debug` | `info` | `warn` | `error`, défaut `info`).
 *
 * Le serveur émet beaucoup de logs de progression (`console.log`). Pour un usage
 * local, l'utilisateur peut vouloir les réduire sans modifier le code. Plutôt que
 * de réécrire les ~125 appels `console.*` existants, on applique au démarrage un
 * filtre global : en dessous du seuil choisi, `console.log`/`.info`/`.debug`
 * deviennent des no-op. `console.warn` et `console.error` restent toujours actifs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return (raw in LEVELS ? raw : 'info') as LogLevel;
}

/** Applique le seuil `LOG_LEVEL` en neutralisant les niveaux console inférieurs. */
export function applyLogLevel(): void {
  const threshold = LEVELS[currentLevel()];
  const noop = () => {};
  if (threshold > LEVELS.debug) console.debug = noop;
  if (threshold > LEVELS.info) {
    console.log = noop;
    console.info = noop;
  }
  if (threshold > LEVELS.warn) console.warn = noop;
}

/** Logger explicite pour le nouveau code (respecte le même seuil). */
export const logger = {
  debug: (...args: unknown[]) => LEVELS[currentLevel()] <= LEVELS.debug && console.debug(...args),
  info: (...args: unknown[]) => LEVELS[currentLevel()] <= LEVELS.info && console.log(...args),
  warn: (...args: unknown[]) => LEVELS[currentLevel()] <= LEVELS.warn && console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
