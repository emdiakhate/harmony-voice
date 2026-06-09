import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import ProviderList from "@/components/settings/ProviderList";
import ProviderDetailPanel from "@/components/settings/ProviderDetailPanel";
import TaskProviderConfig from "@/components/settings/TaskProviderConfig";
import { type Provider } from "@/hooks/useSettings";

export default function Settings() {
  const navigate = useNavigate();
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

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

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Paramètres</h1>
        </div>

        {/* Provider split panel */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden flex min-h-[460px]">
          <ProviderList
            selectedProvider={selectedProvider}
            onSelect={setSelectedProvider}
          />
          <div className="flex-1 border-l border-border">
            {selectedProvider ? (
              <ProviderDetailPanel
                provider={selectedProvider}
                onClose={() => setSelectedProvider(null)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
                <SettingsIcon className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Sélectionnez un fournisseur pour configurer sa clé API et ses modèles
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Priority & Fallback */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <TaskProviderConfig />
        </section>
      </main>
    </div>
  );
}
