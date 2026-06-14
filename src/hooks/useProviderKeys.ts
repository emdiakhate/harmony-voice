import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Provider, LEGACY_PLAINTEXT_KEYS } from "./useSettings";

/** Clé telle que renvoyée par le serveur : jamais en clair, seulement masquée. */
export interface ProviderKeyEntry {
  id: string;
  provider: Provider;
  label: string;
  masked: string;
  disabled: boolean;
  createdAt: string;
}

const QUERY_KEY = ["provider-keys"] as const;

async function fetchKeys(): Promise<ProviderKeyEntry[]> {
  const res = await fetch("/api/settings/keys");
  if (!res.ok) throw new Error("Impossible de charger les clés");
  const data = await res.json();
  return (data.keys ?? []) as ProviderKeyEntry[];
}

// Garde-fou process-wide : la migration héritée ne tourne qu'une fois.
let legacyMigrationStarted = false;

/**
 * Gestion des clés API stockées chiffrées côté serveur (CRUD via /api/settings/keys).
 * Partagé entre composants via le cache React Query.
 */
export function useProviderKeys() {
  const qc = useQueryClient();
  const { data: keys = [], isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchKeys });

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  // Migration unique : clés héritées (en clair dans localStorage) → store chiffré serveur.
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || legacyMigrationStarted || LEGACY_PLAINTEXT_KEYS.length === 0) return;
    migrated.current = true;
    legacyMigrationStarted = true;
    (async () => {
      let imported = 0;
      for (const k of LEGACY_PLAINTEXT_KEYS) {
        try {
          const res = await fetch("/api/settings/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: k.provider, key: k.key, label: k.label }),
          });
          if (res.ok) imported++;
        } catch {
          /* best-effort : l'utilisateur pourra re-saisir la clé */
        }
      }
      if (imported > 0) {
        console.info(`[useProviderKeys] ${imported} clé(s) héritée(s) migrée(s) vers le store chiffré.`);
        invalidate();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addKey = useMutation({
    mutationFn: async (vars: { provider: Provider; key: string; label?: string }) => {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Échec de l'enregistrement de la clé");
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const removeKey = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/settings/keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Échec de la suppression");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const setKeyDisabled = useMutation({
    mutationFn: async (vars: { id: string; disabled: boolean }) => {
      const res = await fetch(`/api/settings/keys/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: vars.disabled }),
      });
      if (!res.ok) throw new Error("Échec de la mise à jour");
      return res.json();
    },
    onSuccess: invalidate,
  });

  const hasKeyForProvider = (provider: Provider) =>
    keys.some((k) => k.provider === provider && !k.disabled);
  const keysForProvider = (provider: Provider) =>
    keys.filter((k) => k.provider === provider);

  return { keys, isLoading, addKey, removeKey, setKeyDisabled, hasKeyForProvider, keysForProvider };
}
