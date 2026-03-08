import { UserButton, useAuth } from "@clerk/clerk-react";
import { useUserQuota } from "@/hooks/useUserQuota";
import { useNavigate } from "react-router-dom";
import { BarChart3, ListMusic, Settings } from "lucide-react";

export default function UserMenu() {
  const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const { user, loading } = useUserQuota();
  const navigate = useNavigate();

  if (loading) return null;

  const planLabel: Record<string, string> = {
    free: "Free",
    pro: "Pro",
    business: "Business",
  };

  return (
    <div className="flex items-center gap-3">
      {user && (
        <>
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
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {user.quota.used}/{user.quota.limit} crédits
          </button>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-primary/10 text-primary">
            {planLabel[user.plan] || user.plan}
          </span>
        </>
      )}
      {clerkPubKey ? (
        <UserButton afterSignOutUrl="/sign-in" />
      ) : (
        <span className="text-xs text-muted-foreground">Dev mode</span>
      )}
    </div>
  );
}
