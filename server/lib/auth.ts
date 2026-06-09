import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma.js';

/**
 * Application locale mono-utilisateur : un seul "utilisateur" implicite porte
 * les clés API, playlists et vidéos enregistrées. Aucune authentification.
 */
export async function getLocalUser() {
  const existing = await prisma.user.findFirst();
  if (existing) return existing;
  return prisma.user.create({ data: {} });
}

/**
 * Attache l'utilisateur local à la requête pour que les routes (clés, playlists,
 * traitements) disposent d'un `user.id` stable. Ne vérifie aucune identité —
 * conservé sous le nom `requireAuth` pour limiter le diff sur les routes.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    (req as any).dbUser = await getLocalUser();
    next();
  } catch (error: any) {
    console.error('[Auth] Error:', error.message);
    res.status(500).json({ error: 'Erreur interne (utilisateur local)' });
  }
}
