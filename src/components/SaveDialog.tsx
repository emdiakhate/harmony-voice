import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Download,
  Music,
  Video,
  ListMusic,
  Plus,
  Check,
  BookmarkPlus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface Playlist {
  id: string;
  name: string;
  videos: { videoId: string }[];
}

interface SaveDialogProps {
  open: boolean;
  onClose: () => void;
  audioUrl: string;
  videoId?: string;
  title: string;
  sourceType: "youtube" | "file";
  youtubeUrl?: string;
  transcription?: string;
  translation?: string;
  targetLanguage: string;
  onDownloadVideo?: () => void;
  isDownloadingVideo?: boolean;
}

export default function SaveDialog({
  open,
  onClose,
  audioUrl,
  videoId,
  title,
  sourceType,
  youtubeUrl,
  transcription,
  translation,
  targetLanguage,
  onDownloadVideo,
  isDownloadingVideo,
}: SaveDialogProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [savedVideoId, setSavedVideoId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [addedToPlaylists, setAddedToPlaylists] = useState<Set<string>>(new Set());
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);

  useEffect(() => {
    if (open) {
      setSavedVideoId(null);
      setAddedToPlaylists(new Set());
      setLoadingPlaylists(true);
      fetch("/api/playlists")
        .then((r) => r.json())
        .then(setPlaylists)
        .catch(() => {})
        .finally(() => setLoadingPlaylists(false));
    }
  }, [open]);

  const handleSaveToLibrary = async () => {
    if (savedVideoId) return; // already saved
    setIsSaving(true);

    const thumbnailUrl =
      videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
    const estimatedDuration = translation ? Math.ceil(translation.length / 15) : 0;

    try {
      const res = await fetch("/api/videos/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          youtubeUrl: youtubeUrl || null,
          sourceType,
          originalText: transcription || null,
          translatedText: translation || null,
          audioUrl: audioUrl || null,
          targetLanguage,
          durationSeconds: estimatedDuration,
          thumbnailUrl,
        }),
      });
      if (res.ok) {
        const video = await res.json();
        setSavedVideoId(video.id);
        toast.success("Sauvegarde dans votre bibliotheque !");
      }
    } catch {
      toast.error("Erreur lors de la sauvegarde");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    // Auto-save to library if not done yet
    let vid = savedVideoId;
    if (!vid) {
      setIsSaving(true);
      const thumbnailUrl =
        videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
      const estimatedDuration = translation ? Math.ceil(translation.length / 15) : 0;

      try {
        const res = await fetch("/api/videos/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            youtubeUrl: youtubeUrl || null,
            sourceType,
            originalText: transcription || null,
            translatedText: translation || null,
            audioUrl: audioUrl || null,
            targetLanguage,
            durationSeconds: estimatedDuration,
            thumbnailUrl:
              videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null,
          }),
        });
        if (res.ok) {
          const video = await res.json();
          vid = video.id;
          setSavedVideoId(video.id);
        } else {
          toast.error("Erreur lors de la sauvegarde");
          setIsSaving(false);
          return;
        }
      } catch {
        toast.error("Erreur lors de la sauvegarde");
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    // Add to playlist
    try {
      const res = await fetch(`/api/playlists/${playlistId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: vid }),
      });
      if (res.ok) {
        setAddedToPlaylists((prev) => new Set([...prev, playlistId]));
        toast.success("Ajout a la playlist !");
      } else if (res.status === 409) {
        toast.info("Deja dans cette playlist");
        setAddedToPlaylists((prev) => new Set([...prev, playlistId]));
      }
    } catch {
      toast.error("Erreur lors de l'ajout");
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPlaylistName.trim() }),
      });
      if (res.ok) {
        const pl = await res.json();
        setPlaylists((prev) => [pl, ...prev]);
        setNewPlaylistName("");
      }
    } catch {
      toast.error("Erreur lors de la creation");
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="font-display font-semibold text-foreground">
              Enregistrer l'audio
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Download buttons */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Telecharger
              </p>
              <a
                href={audioUrl}
                download="audio_traduit.mp3"
                className="w-full py-3 rounded-xl bg-muted border border-border text-foreground font-medium text-sm hover:bg-muted/80 transition-all flex items-center justify-center gap-2"
              >
                <Music className="w-4 h-4" />
                Telecharger l'audio (.mp3)
              </a>
              {videoId && onDownloadVideo && (
                <button
                  onClick={onDownloadVideo}
                  disabled={isDownloadingVideo}
                  className="w-full py-3 rounded-xl bg-muted border border-border text-foreground font-medium text-sm hover:bg-muted/80 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isDownloadingVideo ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fusion en cours...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Telecharger la video traduite (.mp4)
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Save to library */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Bibliotheque
              </p>
              <button
                onClick={handleSaveToLibrary}
                disabled={!!savedVideoId || isSaving}
                className={`w-full py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                  savedVideoId
                    ? "bg-primary/10 border border-primary/30 text-primary"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                } disabled:opacity-70`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sauvegarde...
                  </>
                ) : savedVideoId ? (
                  <>
                    <Check className="w-4 h-4" />
                    Sauvegarde dans Videos
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-4 h-4" />
                    Sauvegarder dans Videos
                  </>
                )}
              </button>
            </div>

            {/* Add to playlist */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Playlists
              </p>

              {loadingPlaylists ? (
                <div className="text-center py-3 text-sm text-muted-foreground">
                  Chargement...
                </div>
              ) : playlists.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Aucune playlist. Creez-en une ci-dessous.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {playlists.map((pl) => {
                    const added = addedToPlaylists.has(pl.id);
                    return (
                      <button
                        key={pl.id}
                        onClick={() => !added && handleAddToPlaylist(pl.id)}
                        disabled={added}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                          added
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted text-foreground"
                        }`}
                      >
                        <ListMusic className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{pl.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {pl.videos.length} video{pl.videos.length !== 1 ? "s" : ""}
                        </span>
                        {added && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Create new playlist inline */}
              <div className="flex gap-2 pt-1">
                <input
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreatePlaylist()}
                  placeholder="Nouvelle playlist..."
                  className="flex-1 px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim()}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
