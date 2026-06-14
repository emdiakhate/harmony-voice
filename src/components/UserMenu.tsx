import { useNavigate } from "react-router-dom";
import { ListMusic, Settings } from "lucide-react";

// Outil local sans authentification : simple navigation (réglages + playlists).
export default function UserMenu() {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => navigate("/settings")}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        Parametres
      </button>
      <button
        onClick={() => navigate("/playlists")}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ListMusic className="w-3.5 h-3.5" />
        Playlists
      </button>
    </div>
  );
}
