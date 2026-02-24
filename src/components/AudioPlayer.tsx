import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
  RotateCcw,
  Radio,
} from "lucide-react";

interface AudioPlayerProps {
  audioChunks?: string[];
  audioUrl?: string;
  isStreaming?: boolean;
  title?: string;
}

const AudioPlayer = ({
  audioChunks = [],
  audioUrl,
  isStreaming = false,
  title = "Audio traduit",
}: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);

  // Chunk streaming state
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [useFinalAudio, setUseFinalAudio] = useState(false);
  const [waitingForChunk, setWaitingForChunk] = useState(false);
  const hasAutoPlayed = useRef(false);

  const inChunkMode = audioChunks.length > 0 && !useFinalAudio;

  // Auto-play first chunk when it arrives
  useEffect(() => {
    if (audioChunks.length === 1 && !hasAutoPlayed.current && audioRef.current) {
      hasAutoPlayed.current = true;
      audioRef.current.src = audioChunks[0];
      audioRef.current.volume = volume;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [audioChunks.length]);

  // When waiting for next chunk and it arrives, auto-continue
  useEffect(() => {
    if (waitingForChunk && audioChunks[currentChunkIndex] && audioRef.current) {
      setWaitingForChunk(false);
      audioRef.current.src = audioChunks[currentChunkIndex];
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [audioChunks.length, waitingForChunk, currentChunkIndex]);

  // When streaming is done and we have the final URL, switch after current playback
  useEffect(() => {
    if (!isStreaming && audioUrl && !useFinalAudio && !isPlaying) {
      switchToFinalAudio();
    }
  }, [isStreaming, audioUrl, isPlaying]);

  const switchToFinalAudio = useCallback(() => {
    if (!audioUrl || !audioRef.current) return;
    setUseFinalAudio(true);
    audioRef.current.src = audioUrl;
    audioRef.current.load();
  }, [audioUrl]);

  // Handle chunk ended - chain to next
  const handleEnded = () => {
    if (useFinalAudio) {
      setIsPlaying(false);
      return;
    }

    const nextIndex = currentChunkIndex + 1;

    if (nextIndex < audioChunks.length) {
      // Next chunk available - play it
      setCurrentChunkIndex(nextIndex);
      if (audioRef.current) {
        audioRef.current.src = audioChunks[nextIndex];
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else if (isStreaming) {
      // Waiting for next chunk to be generated
      setCurrentChunkIndex(nextIndex);
      setWaitingForChunk(true);
      setIsPlaying(false);
    } else {
      // All chunks played - switch to final
      setIsPlaying(false);
      if (audioUrl) switchToFinalAudio();
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    // If final audio is ready and nothing loaded, load it first
    if (!audio.src && audioUrl) {
      switchToFinalAudio();
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const vol = parseFloat(e.target.value);
    audio.volume = vol;
    setVolume(vol);
    setIsMuted(vol === 0);
  };

  const restart = () => {
    if (useFinalAudio && audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
    } else if (audioChunks.length > 0 && audioRef.current) {
      // Restart from first chunk
      setCurrentChunkIndex(0);
      audioRef.current.src = audioChunks[0];
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-4 space-y-3"
    >
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-primary" />
          {title}
          {inChunkMode && (
            <span className="text-xs text-primary flex items-center gap-1">
              <Radio className="w-3 h-3 animate-pulse" />
              Partie {Math.min(currentChunkIndex + 1, audioChunks.length)}/{isStreaming ? '...' : audioChunks.length}
            </span>
          )}
          {waitingForChunk && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Chargement...
            </span>
          )}
        </p>
        {audioUrl && (
          <a
            href={audioUrl}
            download
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            title="Télécharger l'audio"
          >
            <Download className="w-4 h-4" />
          </a>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 transition-all"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>
          <button
            onClick={restart}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            title="Recommencer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 space-y-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            disabled={inChunkMode}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer disabled:opacity-50"
            style={{
              background: `linear-gradient(to right, hsl(var(--primary)) ${progressPercent}%, hsl(var(--muted)) ${progressPercent}%)`,
            }}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleMute}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full"
          />
        </div>
      </div>
    </motion.div>
  );
};

export default AudioPlayer;
