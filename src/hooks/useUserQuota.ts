import { useState, useEffect } from "react";

interface UserQuota {
  id: string;
  email: string;
  plan: string;
  podcastEnabled: boolean;
  quota: {
    used: number;
    limit: number;
    remaining: number;
  };
}

export function useUserQuota() {
  const [user, setUser] = useState<UserQuota | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const res = await fetch("/api/user/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch {
      // Silently fail — user might not be authenticated
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  return { user, loading, refetch: fetchUser };
}
