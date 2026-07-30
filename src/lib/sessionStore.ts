// Lightweight localStorage persistence for the last working session.
//
// In dev the app runs under Vite's HMR client, which forces a full
// `location.reload()` when its WebSocket reconnects after the machine wakes
// from sleep. A reload wipes all volatile React state — including the
// uploaded `File` objects — forcing the user to re-import their file.
//
// We can't serialize `File` objects, but the valuable artifacts (extracted
// text, translation, and the generated audio URLs, which the backend serves
// statically from disk) are serializable. Persisting them makes the reload
// non-destructive: results are restored and audio generation can be resumed
// from the saved text, without re-uploading anything.

export type SessionStatus = "processing" | "done" | "idle";

export interface SessionSnapshot {
  inputMode: string;
  sourceLang: string;
  targetLang: string;
  generationMode: "audio" | "podcast";
  transcription: string;
  translation: string;
  summary: string;
  podcastScript: string;
  audioUrl: string;
  audioChunks: string[];
  // Couverture générée (miniature type livre audio), servie depuis le disque backend.
  coverImageUrl: string;
  // Per-part final audios accumulated across a multi-file queue, plus the single
  // recomposed file — so the "Recomposer l'audio complet" action survives a reload.
  queueAudioUrls: { fileName: string; audioUrl: string }[];
  combinedAudioUrl: string;
  videoId: string;
  localVideoUrl: string;
  // Names only — File objects can't be persisted; used for display/context.
  originalFileNames: string[];
  status: SessionStatus;
  savedAt: number;
}

const KEY = "vocaleez:lastSession";

// Durée de vie d'une session sauvegardée : au-delà, on la considère périmée et
// on la purge (évite qu'une vieille session traîne indéfiniment en localStorage).
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function saveSession(snapshot: SessionSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or storage unavailable — persistence is best-effort.
  }
}

export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as SessionSnapshot;
    // Purge des sessions périmées (au-delà du TTL).
    if (snap.savedAt && Date.now() - snap.savedAt > SESSION_TTL_MS) {
      clearSession();
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// True when a snapshot actually holds restorable work.
export function hasContent(s: SessionSnapshot | null): s is SessionSnapshot {
  if (!s) return false;
  return Boolean(
    s.transcription ||
      s.translation ||
      s.audioUrl ||
      (s.audioChunks && s.audioChunks.length > 0) ||
      (s.queueAudioUrls && s.queueAudioUrls.length > 0) ||
      s.combinedAudioUrl ||
      s.podcastScript ||
      s.summary
  );
}
