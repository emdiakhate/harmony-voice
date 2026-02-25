import { clerkMiddleware, getAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { getOrCreateUser, checkQuota, PLAN_LIMITS } from './quota.js';

/**
 * Clerk middleware — attach to Express app.
 * If CLERK_SECRET_KEY is not set, auth is disabled (dev mode).
 */
export function createAuthMiddleware() {
  if (!process.env.CLERK_SECRET_KEY) {
    console.warn('[Auth] CLERK_SECRET_KEY not set — auth disabled (dev mode)');
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return clerkMiddleware();
}

/**
 * Require authentication on a route.
 * In dev mode (no Clerk keys), creates a default dev user.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Dev mode — no auth required
    if (!process.env.CLERK_SECRET_KEY) {
      const user = await getOrCreateUser('dev_user', 'dev@localhost');
      (req as any).dbUser = user;
      return next();
    }

    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: 'Non authentifié. Connectez-vous pour continuer.' });
    }

    // Sync user to database
    const user = await getOrCreateUser(auth.userId, (auth as any).sessionClaims?.email || 'unknown');
    (req as any).dbUser = user;
    next();
  } catch (error: any) {
    console.error('[Auth] Error:', error.message);
    res.status(500).json({ error: 'Erreur d\'authentification' });
  }
}

/**
 * Check quota before processing. Must be called after requireAuth.
 */
export async function requireQuota(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).dbUser;
    if (!user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const quota = await checkQuota(user.id, user.plan);

    if (!quota.allowed) {
      const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
      return res.status(429).json({
        error: 'Quota mensuel épuisé',
        usage: {
          used: quota.used,
          limit: quota.limit,
          plan: user.plan,
        },
        message: `Vous avez utilisé ${quota.used}/${quota.limit} crédits ce mois-ci. Passez au plan supérieur pour continuer.`,
        upgradePlans: Object.entries(PLAN_LIMITS)
          .filter(([p]) => p !== user.plan && PLAN_LIMITS[p].creditsPerMonth > limits.creditsPerMonth)
          .map(([p, l]) => ({ plan: p, creditsPerMonth: l.creditsPerMonth })),
      });
    }

    (req as any).quota = quota;
    next();
  } catch (error: any) {
    console.error('[Quota] Error:', error.message);
    res.status(500).json({ error: 'Erreur de vérification du quota' });
  }
}

/**
 * Check if podcast mode is allowed for the user's plan.
 */
export function requirePodcastAccess(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).dbUser;
  if (!user) return res.status(401).json({ error: 'Non authentifié' });

  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
  if (!limits.podcastEnabled) {
    return res.status(403).json({
      error: 'Mode podcast non disponible',
      message: 'Le mode podcast est réservé aux plans Pro et Business.',
      plan: user.plan,
    });
  }

  next();
}
