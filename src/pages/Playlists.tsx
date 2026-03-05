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
  Play,
  Clock,
  MoreVertical,
  Download,
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
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"playlists" | "videos">("videos");
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<string | null>(null);

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
      if (selectedPlaylist === id) setSelectedPlaylist(null);
    }
  };

  const deleteVideo = async (id: string) => {
    if (!confirm("Supprimer cette video sauvegardee ?")) return;
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
    return sec > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${m}:00`;
  };

  const getTotalDuration = (pl: Playlist) =>
    pl.videos.reduce((acc, pv) => acc + (pv.video.durationSeconds || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  const currentPlaylist = playlists.find((p) => p.id === selectedPlaylist);

  // Videos not yet in a specific playlist
  const videosNotInPlaylist = (playlistId: string) => {
    const inPlaylist = new Set(
      playlists
        .find((p) => p.id === playlistId)
        ?.videos.map((pv) => pv.videoId) || []
    );
    return videos.filter((v) => !inPlaylist.has(v.id));
  };

  // YouTube-style video row
  const VideoRow = ({
    video,
    index,
    showRemove,
    playlistId,
  }: {
    video: SavedVideo;
    index?: number;
    showRemove?: boolean;
    playlistId?: string;
  }) => (
    <div className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors relative">
      {/* Index number */}
      {index !== undefined && (
        <span className="w-6 text-center text-xs text-muted-foreground shrink-0">
          {index + 1}
        </span>
      )}

      {/* Thumbnail */}
      <div className="w-40 h-[90px] rounded-lg bg-muted shrink-0 overflow-hidden relative group/thumb">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* Duration overlay */}
        {video.durationSeconds > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
        {/* Play overlay on hover */}
        {video.audioUrl && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 py-1">
        <h4 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
          {video.title}
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          {video.sourceType === "youtube" ? "YouTube" : "Fichier"} &middot;{" "}
          {formatDate(video.createdAt)}
        </p>
        {video.audioUrl && (
          <audio
            src={video.audioUrl}
            controls
            className="mt-1.5 h-7 w-full max-w-[280px]"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {video.audioUrl && (
          <a
            href={video.audioUrl}
            download
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Telecharger"
          >
            <Download className="w-4 h-4" />
          </a>
        )}
        {!showRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAddingToPlaylist(addingToPlaylist === video.id ? null : video.id);
            }}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Ajouter a une playlist"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>
        )}
        {showRemove && playlistId ? (
          <button
            onClick={() => removeVideoFromPlaylist(playlistId, video.id)}
            className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
            title="Retirer de la playlist"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => deleteVideo(video.id)}
            className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
            title="Supprimer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Add-to-playlist dropdown */}
      {addingToPlaylist === video.id && playlists.length > 0 && (
        <div className="absolute right-0 top-full z-10 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
          <div className="flex items-center justify-between px-2 pb-2 border-b border-border mb-1">
            <span className="text-xs font-medium">Ajouter a...</span>
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
              onClick={() => addVideoToPlaylist(pl.id, video.id)}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors flex items-center gap-2"
            >
              <ListMusic className="w-3.5 h-3.5" />
              {pl.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
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

      <main className="container max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Ma bibliotheque</h1>

        <div className="flex gap-8">
          {/* Sidebar: Playlists */}
          <aside className="w-72 shrink-0">
            {/* Tabs */}
            <div className="flex gap-1 mb-4">
              <button
                onClick={() => {
                  setTab("videos");
                  setSelectedPlaylist(null);
                }}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === "videos" && !selectedPlaylist
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Video className="w-4 h-4 inline mr-1" />
                Videos ({videos.length})
              </button>
            </div>

            {/* Playlist list */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Playlists
                </span>
              </div>

              {playlists.map((pl) => {
                const isSelected = selectedPlaylist === pl.id;
                const totalDur = getTotalDuration(pl);
                return (
                  <button
                    key={pl.id}
                    onClick={() => {
                      setSelectedPlaylist(isSelected ? null : pl.id);
                      setTab("playlists");
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isSelected
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    {/* Playlist thumbnail mosaic */}
                    <div className="w-10 h-10 rounded-lg bg-muted shrink-0 overflow-hidden grid grid-cols-2 grid-rows-2 gap-px">
                      {pl.videos.slice(0, 4).map((pv, i) =>
                        pv.video.thumbnailUrl ? (
                          <img
                            key={i}
                            src={pv.video.thumbnailUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div
                            key={i}
                            className="w-full h-full bg-muted flex items-center justify-center"
                          >
                            <Music className="w-2.5 h-2.5 text-muted-foreground" />
                          </div>
                        )
                      )}
                      {pl.videos.length === 0 && (
                        <div className="col-span-2 row-span-2 flex items-center justify-center">
                          <ListMusic className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pl.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pl.videos.length} video{pl.videos.length !== 1 ? "s" : ""}
                        {totalDur > 0 && ` \u00B7 ${formatDuration(totalDur)}`}
                      </p>
                    </div>
                  </button>
                );
              })}

              {/* Create playlist */}
              <div className="flex gap-1.5 mt-3 px-1">
                <input
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
                  placeholder="Nouvelle playlist..."
                  className="flex-1 px-3 py-2 rounded-lg bg-muted border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  onClick={createPlaylist}
                  disabled={!newPlaylistName.trim()}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Selected playlist view */}
            {selectedPlaylist && currentPlaylist ? (
              <div className="space-y-4">
                {/* Playlist header (YouTube-style) */}
                <div className="rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-6 flex gap-6">
                  {/* Playlist cover */}
                  <div className="w-56 h-32 rounded-xl bg-muted overflow-hidden shrink-0 grid grid-cols-2 grid-rows-2 gap-px shadow-lg">
                    {currentPlaylist.videos.slice(0, 4).map((pv, i) =>
                      pv.video.thumbnailUrl ? (
                        <img
                          key={i}
                          src={pv.video.thumbnailUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          key={i}
                          className="w-full h-full bg-muted flex items-center justify-center"
                        >
                          <Music className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )
                    )}
                    {currentPlaylist.videos.length === 0 && (
                      <div className="col-span-2 row-span-2 flex items-center justify-center">
                        <ListMusic className="w-12 h-12 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col justify-between py-1">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                        Playlist
                      </p>
                      <h2 className="text-2xl font-bold text-foreground">
                        {currentPlaylist.name}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        {currentPlaylist.videos.length} video
                        {currentPlaylist.videos.length !== 1 ? "s" : ""}
                        {getTotalDuration(currentPlaylist) > 0 && (
                          <>
                            {" \u00B7 "}
                            <Clock className="w-3 h-3 inline" />{" "}
                            {formatDuration(getTotalDuration(currentPlaylist))}
                          </>
                        )}
                        {" \u00B7 "}Creee le {formatDate(currentPlaylist.createdAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => deletePlaylist(currentPlaylist.id)}
                        className="px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors flex items-center gap-1.5"
                      >
                        <Trash2 className="w-4 h-4" />
                        Supprimer
                      </button>
                    </div>
                  </div>
                </div>

                {/* Videos in playlist */}
                {currentPlaylist.videos.length === 0 ? (
                  <div className="rounded-xl border border-border bg-card p-12 text-center">
                    <ListMusic className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-muted-foreground">Playlist vide.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ajoutez des videos depuis l'onglet Videos.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {currentPlaylist.videos.map((pv, i) => (
                      <VideoRow
                        key={pv.id}
                        video={pv.video}
                        index={i}
                        showRemove
                        playlistId={currentPlaylist.id}
                      />
                    ))}
                  </div>
                )}

                {/* Add videos to playlist */}
                {videosNotInPlaylist(currentPlaylist.id).length > 0 && (
                  <div className="mt-4 p-4 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                      Ajouter des videos
                    </p>
                    <div className="space-y-1">
                      {videosNotInPlaylist(currentPlaylist.id).map((v) => (
                        <button
                          key={v.id}
                          onClick={() =>
                            addVideoToPlaylist(currentPlaylist.id, v.id)
                          }
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-left"
                        >
                          <div className="w-12 h-8 rounded bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                            {v.thumbnailUrl ? (
                              <img
                                src={v.thumbnailUrl}
                                alt={v.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Music className="w-3 h-3 text-muted-foreground" />
                            )}
                          </div>
                          <span className="text-sm truncate flex-1">
                            {v.title}
                          </span>
                          <Plus className="w-4 h-4 text-primary shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* All videos view */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">
                    Toutes les videos ({videos.length})
                  </h2>
                </div>

                {videos.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-card p-12 text-center">
                    <Video className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Aucune video sauvegardee.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Les videos apparaitront ici quand vous les enregistrerez
                      depuis la page principale.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {videos.map((v) => (
                      <VideoRow key={v.id} video={v} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
