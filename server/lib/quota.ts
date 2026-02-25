import { prisma } from './prisma.js';

// Credits = minutes of audio. 1 credit ≈ 1 minute.
export const PLAN_LIMITS: Record<string, { creditsPerMonth: number; podcastEnabled: boolean }> = {
  free:     { creditsPerMonth: 15,   podcastEnabled: false },
  pro:      { creditsPerMonth: 300,  podcastEnabled: true },
  business: { creditsPerMonth: 1200, podcastEnabled: true },
};

/**
 * Get or create a user from their Clerk ID.
 */
export async function getOrCreateUser(clerkId: string, email: string) {
  let user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) {
    user = await prisma.user.create({
      data: { clerkId, email, plan: 'free' },
    });
    console.log(`[Quota] New user created: ${email} (free plan)`);
  }
  return user;
}

/**
 * Get usage for the current month.
 */
export async function getMonthlyUsage(userId: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await prisma.usage.aggregate({
    where: {
      userId,
      createdAt: { gte: startOfMonth },
    },
    _sum: { creditsUsed: true },
  });

  return result._sum.creditsUsed || 0;
}

/**
 * Check if user has enough credits remaining.
 */
export async function checkQuota(userId: string, plan: string): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const used = await getMonthlyUsage(userId);
  const remaining = Math.max(0, limits.creditsPerMonth - used);

  return {
    allowed: remaining > 0,
    used,
    limit: limits.creditsPerMonth,
    remaining,
  };
}

/**
 * Record usage for a completed operation.
 */
export async function recordUsage(
  userId: string,
  type: 'transcription' | 'translation' | 'tts' | 'podcast',
  opts: { durationSeconds?: number; inputChars?: number; metadata?: string } = {},
) {
  // 1 credit per 60 seconds of audio, minimum 1 credit
  const creditsUsed = opts.durationSeconds
    ? Math.max(1, Math.ceil(opts.durationSeconds / 60))
    : 1;

  await prisma.usage.create({
    data: {
      userId,
      type,
      creditsUsed,
      durationSeconds: opts.durationSeconds || 0,
      inputChars: opts.inputChars || 0,
      metadata: opts.metadata,
    },
  });

  console.log(`[Quota] Usage recorded: ${type} = ${creditsUsed} credit(s) for user ${userId}`);
}
