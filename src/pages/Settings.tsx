import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import ApiKeyManager from "@/components/settings/ApiKeyManager";
import TaskProviderConfig from "@/components/settings/TaskProviderConfig";

export default function Settings() {
  const navigate = useNavigate();

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
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Parametres</h1>
        </div>

        {/* API Keys Section */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <ApiKeyManager />
        </section>

        {/* Task Provider Assignment Section */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <TaskProviderConfig />
        </section>
      </main>
    </div>
  );
}
