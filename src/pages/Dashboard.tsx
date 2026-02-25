import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUserQuota } from "@/hooks/useUserQuota";
import UserMenu from "@/components/UserMenu";
import {
  Languages,
  ArrowLeft,
  Mic,
  FileText,
  Radio,
  Zap,
} from "lucide-react";

interface UsageSummary {
  type: string;
  _sum: { creditsUsed: number | null };
  _count: number;
}

interface UsageEntry {
  id: string;
  type: string;
  creditsUsed: number;
  inputChars: number;
  createdAt: string;
  metadata: string | null;
}

const typeLabels: Record<string, { label: string; icon: typeof Mic }> = {
  tts: { label: "Audio TTS", icon: Mic },
  podcast: { label: "Podcast", icon: Radio },
  transcription: { label: "Transcription", icon: FileText },
  translation: { label: "Traduction", icon: Languages },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, loading } = useUserQuota();
  const [usages, setUsages] = useState<UsageEntry[]>([]);
  const [summary, setSummary] = useState<UsageSummary[]>([]);

  useEffect(() => {
    fetch("/api/user/usage")
      .then((r) => r.json())
      .then((data) => {
        setUsages(data.usages || []);
        setSummary(data.summary || []);
      })
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!user) return null;

  const usedPercent = Math.min(100, Math.round((user.quota.used / user.quota.limit) * 100));

  const planColors: Record<string, string> = {
    free: "text-muted-foreground",
    pro: "text-primary",
    business: "text-yellow-500",
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

      <main className="container max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Plan & Quota */}
        <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Mon abonnement</h2>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <span className={`text-2xl font-bold uppercase ${planColors[user.plan] || ""}`}>
              {user.plan}
            </span>
          </div>

          {/* Quota bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Crédits utilisés ce mois</span>
              <span className="font-medium">
                {user.quota.used} / {user.quota.limit}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  usedPercent > 90
                    ? "bg-destructive"
                    : usedPercent > 70
                    ? "bg-yellow-500"
                    : "bg-primary"
                }`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {user.quota.remaining} crédits restants ({1} crédit = ~1 minute d'audio)
            </p>
          </div>

          {/* Features */}
          <div className="flex gap-3 pt-2">
            <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-muted">
              <Mic className="w-3 h-3" /> Audio TTS
            </span>
            <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full ${
              user.podcastEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through"
            }`}>
              <Radio className="w-3 h-3" /> Mode Podcast
              {!user.podcastEnabled && <span className="text-[10px]">(Pro+)</span>}
            </span>
          </div>

          {/* Upgrade CTA */}
          {user.plan === "free" && (
            <div className="mt-4 p-4 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2 text-primary font-medium text-sm mb-1">
                <Zap className="w-4 h-4" />
                Passez au plan Pro
              </div>
              <p className="text-xs text-muted-foreground">
                300 crédits/mois, mode podcast, toutes les langues — 19€/mois
              </p>
            </div>
          )}
        </section>

        {/* Usage by type */}
        <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Résumé du mois</h2>
          {summary.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune utilisation ce mois-ci.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {summary.map((s) => {
                const info = typeLabels[s.type] || { label: s.type, icon: FileText };
                const Icon = info.icon;
                return (
                  <div key={s.type} className="rounded-xl bg-muted p-4 text-center">
                    <Icon className="w-5 h-5 mx-auto mb-2 text-primary" />
                    <div className="text-2xl font-bold">{s._count}</div>
                    <div className="text-xs text-muted-foreground">{info.label}</div>
                    <div className="text-xs text-primary font-medium mt-1">
                      {s._sum.creditsUsed || 0} crédits
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent activity */}
        <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Activité récente</h2>
          {usages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune activité récente.</p>
          ) : (
            <div className="space-y-2">
              {usages.slice(0, 20).map((u) => {
                const info = typeLabels[u.type] || { label: u.type, icon: FileText };
                const Icon = info.icon;
                const meta = u.metadata ? JSON.parse(u.metadata) : {};
                const date = new Date(u.createdAt);

                return (
                  <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                    <Icon className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {info.label}
                        {meta.videoId && <span className="text-muted-foreground"> — {meta.videoId}</span>}
                        {meta.fileName && <span className="text-muted-foreground"> — {meta.fileName}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {date.toLocaleDateString("fr-FR")} à {date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-primary shrink-0">
                      {u.creditsUsed} crédit{u.creditsUsed > 1 ? "s" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
