import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Volume2, VolumeX, Languages } from "lucide-react";

interface LocalVideoPlayerProps {
  videoUrl: string;
  translatedAudioUrl?: string;
}

const LocalVideoPlayer = ({ videoUrl, translatedAudioUrl }: LocalVideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [useTranslatedAudio, setUseTranslatedAudio] = useState(!!translatedAudioUrl);
  const syncingRef = useRef(false);

  // When translated audio becomes available, enable it
  useEffect(() => {
    if (translatedAudioUrl) {
      setUseTranslatedAudio(true);
    }
  }, [translatedAudioUrl]);

  // Sync: mute video when using translated audio
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = useTranslatedAudio && !!translatedAudioUrl;
  }, [useTranslatedAudio, translatedAudioUrl]);

  // Sync audio with video on play/pause/seek
  const syncAudioToVideo = useCallback(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || syncingRef.current) return;

    syncingRef.current = true;

    // Sync time if drifted more than 0.3s
    if (Math.abs(audio.currentTime - video.currentTime) > 0.3) {
      audio.currentTime = video.currentTime;
    }

    if (!video.paused && video.muted) {
      audio.play().catch(() => {});
    } else if (video.paused) {
      audio.pause();
    }

    syncingRef.current = false;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => syncAudioToVideo();
    const onPause = () => { audioRef.current?.pause(); };
    const onSeeked = () => syncAudioToVideo();
    const onTimeUpdate = () => {
      const audio = audioRef.current;
      if (!audio || !video) return;
      if (Math.abs(audio.currentTime - video.currentTime) > 0.5) {
        audio.currentTime = video.currentTime;
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [syncAudioToVideo]);

  const toggleAudioMode = () => {
    if (!translatedAudioUrl) return;
    const next = !useTranslatedAudio;
    setUseTranslatedAudio(next);

    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    if (next) {
      // Switch to translated audio
      video.muted = true;
      if (audio && !video.paused) {
        audio.currentTime = video.currentTime;
        audio.play().catch(() => {});
      }
    } else {
      // Switch back to original audio
      video.muted = false;
      audio?.pause();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card overflow-hidden"
    >
      <div className="relative">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          className="w-full"
          muted={useTranslatedAudio && !!translatedAudioUrl}
        />

        {/* Hidden audio element for translated audio */}
        {translatedAudioUrl && (
          <audio ref={audioRef} src={translatedAudioUrl} preload="auto" />
        )}

        {/* Audio toggle badge */}
        {translatedAudioUrl && (
          <button
            onClick={toggleAudioMode}
            className={`absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm transition-all ${
              useTranslatedAudio
                ? "bg-primary/90 text-primary-foreground"
                : "bg-black/60 text-white hover:bg-black/80"
            }`}
          >
            {useTranslatedAudio ? (
              <>
                <Languages className="w-3.5 h-3.5" />
                Audio traduit
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                Audio original
              </>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default LocalVideoPlayer;
