import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import UserMenu from "@/components/UserMenu";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ListMusic,
  Video,
  Music,
  ChevronDown,
  ChevronRight,
  BookmarkPlus,
  X,
} from "lucide-react";

interface SavedVideo {
  id: string;
  title: string;
  youtubeUrl: string | null;
  sourceType: string;
  audioUrl: string | null;
  targetLanguage: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  createdAt: string;
  playlists: { playlist: { id: string; name: string } }[];
}

interface PlaylistVideo {
  id: string;
  videoId: string;
  video: SavedVideo;
  addedAt: string;
}

interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  videos: PlaylistVideo[];
}

export default function Playlists() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"playlists" | "videos">("videos");

  useEffect(() => {
    Promise.all([
      fetch("/api/playlists").then((r) => r.json()),
      fetch("/api/videos").then((r) => r.json()),
    ])
      .then(([p, v]) => {
        setPlaylists(p);
        setVideos(v);
      })
      .finally(() => setLoading(false));
  }, []);

  const createPlaylist = async () => {
    if (!newPlaylistName.trim()) return;
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
  };

  const deletePlaylist = async (id: string) => {
    if (!confirm("Supprimer cette playlist ?")) return;
    const res = await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPlaylists((prev) => prev.filter((p) => p.id !== id));
      if (expandedPlaylist === id) setExpandedPlaylist(null);
    }
  };

  const deleteVideo = async (id: string) => {
    if (!confirm("Supprimer cette vidéo sauvegardée ?")) return;
    const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
    if (res.ok) {
      setVideos((prev) => prev.filter((v) => v.id !== id));
      setPlaylists((prev) =>
        prev.map((p) => ({
          ...p,
          videos: p.videos.filter((pv) => pv.videoId !== id),
        }))
      );
    }
  };

  const addVideoToPlaylist = async (playlistId: string, videoId: string) => {
    const res = await fetch(`/api/playlists/${playlistId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlistId ? updated : p))
      );
      setAddingToPlaylist(null);
    }
  };

  const removeVideoFromPlaylist = async (
    playlistId: string,
    videoId: string
  ) => {
    const res = await fetch(`/api/playlists/${playlistId}/videos/${videoId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const updated = await res.json();
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlistId ? updated : p))
      );
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const formatDuration = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}min ${sec}s` : `${m}min`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  // Videos not yet in a specific playlist
  const videosNotInPlaylist = (playlistId: string) => {
    const inPlaylist = new Set(
      playlists
        .find((p) => p.id === playlistId)
        ?.videos.map((pv) => pv.videoId) || []
    );
    return videos.filter((v) => !inPlaylist.has(v.id));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <UserMenu />
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Ma bibliothèque</h1>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("videos")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "videos"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Video className="w-4 h-4 inline mr-1.5" />
            Vidéos ({videos.length})
          </button>
          <button
            onClick={() => setTab("playlists")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "playlists"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListMusic className="w-4 h-4 inline mr-1.5" />
            Playlists ({playlists.length})
          </button>
        </div>

        {/* ===== Videos Tab ===== */}
        {tab === "videos" && (
          <section className="space-y-3">
            {videos.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-12 text-center">
                <Video className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Aucune vidéo sauvegardée.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Les vidéos apparaîtront ici quand vous les enregistrerez depuis la page principale.
                </p>
              </div>
            ) : (
              videos.map((v) => (
                <div
                  key={v.id}
                  className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 group"
                >
                  {/* Thumbnail */}
                  <div className="w-24 h-16 rounded-lg bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                    {v.thumbnailUrl ? (
                      <img
                        src={v.thumbnailUrl}
                        alt={v.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Music className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium truncate">{v.title}</h3>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>{v.sourceType === "youtube" ? "YouTube" : "Fichier"}</span>
                      {v.durationSeconds > 0 && (
                        <span>{formatDuration(v.durationSeconds)}</span>
                      )}
                      <span>{formatDate(v.createdAt)}</span>
                    </div>
                    {v.audioUrl && (
                      <audio
                        src={v.audioUrl}
                        controls
                        className="mt-2 h-8 w-full max-w-xs"
                      />
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() =>
                        setAddingToPlaylist(
                          addingToPlaylist === v.id ? null : v.id
                        )
                      }
                      className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      title="Ajouter à une playlist"
                    >
                      <BookmarkPlus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteVideo(v.id)}
                      className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Add to playlist dropdown */}
                  {addingToPlaylist === v.id && playlists.length > 0 && (
                    <div className="absolute right-16 mt-32 z-10 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
                      <div className="flex items-center justify-between px-2 pb-2 border-b border-border mb-1">
                        <span className="text-xs font-medium">
                          Ajouter à...
                        </span>
                        <button
                          onClick={() => setAddingToPlaylist(null)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      {playlists.map((pl) => (
                        <button
                          key={pl.id}
                          onClick={() => addVideoToPlaylist(pl.id, v.id)}
                          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                        >
                          {pl.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        {/* ===== Playlists Tab ===== */}
        {tab === "playlists" && (
          <section className="space-y-4">
            {/* Create playlist */}
            <div className="flex gap-2">
              <input
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
                placeholder="Nouvelle playlist..."
                className="flex-1 px-4 py-2 rounded-lg bg-muted border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={createPlaylist}
                disabled={!newPlaylistName.trim()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Créer
              </button>
            </div>

            {playlists.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-12 text-center">
                <ListMusic className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">Aucune playlist.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Créez une playlist pour organiser vos vidéos.
                </p>
              </div>
            ) : (
              playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  {/* Playlist header */}
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() =>
                      setExpandedPlaylist(
                        expandedPlaylist === pl.id ? null : pl.id
                      )
                    }
                  >
                    {expandedPlaylist === pl.id ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <ListMusic className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium">{pl.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {pl.videos.length} vidéo
                        {pl.videos.length !== 1 ? "s" : ""} &middot;{" "}
                        {formatDate(pl.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePlaylist(pl.id);
                      }}
                      className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Expanded: videos in playlist */}
                  {expandedPlaylist === pl.id && (
                    <div className="border-t border-border">
                      {pl.videos.length === 0 ? (
                        <p className="text-sm text-muted-foreground p-4">
                          Playlist vide. Ajoutez des vidéos depuis l'onglet Vidéos.
                        </p>
                      ) : (
                        pl.videos.map((pv) => (
                          <div
                            key={pv.id}
                            className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                          >
                            <div className="w-16 h-10 rounded bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                              {pv.video.thumbnailUrl ? (
                                <img
                                  src={pv.video.thumbnailUrl}
                                  alt={pv.video.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Music className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">
                                {pv.video.title}
                              </p>
                              {pv.video.audioUrl && (
                                <audio
                                  src={pv.video.audioUrl}
                                  controls
                                  className="mt-1 h-7 w-full max-w-xs"
                                />
                              )}
                            </div>
                            <button
                              onClick={() =>
                                removeVideoFromPlaylist(pl.id, pv.videoId)
                              }
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                              title="Retirer de la playlist"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      )}

                      {/* Add video to this playlist */}
                      {videosNotInPlaylist(pl.id).length > 0 && (
                        <div className="p-3 bg-muted/30">
                          <p className="text-xs text-muted-foreground mb-2">
                            Ajouter une vidéo :
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {videosNotInPlaylist(pl.id)
                              .slice(0, 5)
                              .map((v) => (
                                <button
                                  key={v.id}
                                  onClick={() =>
                                    addVideoToPlaylist(pl.id, v.id)
                                  }
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-card border border-border text-xs hover:border-primary/50 transition-colors"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span className="truncate max-w-[150px]">
                                    {v.title}
                                  </span>
                                </button>
                              ))}
                            {videosNotInPlaylist(pl.id).length > 5 && (
                              <span className="text-xs text-muted-foreground px-2 py-1">
                                +{videosNotInPlaylist(pl.id).length - 5} autres
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
        )}
      </main>
    </div>
  );
}
