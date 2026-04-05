import { useAuth, RedirectToSignIn } from "@clerk/clerk-react";
import type { ReactNode } from "react";

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Protects routes — redirects to sign-in if not authenticated.
 * In dev mode (no Clerk key), renders children directly.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  // Dev mode: no auth required
  if (!clerkPubKey) {
    return <>{children}</>;
  }

  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn />;
  }

  return <>{children}</>;
}
