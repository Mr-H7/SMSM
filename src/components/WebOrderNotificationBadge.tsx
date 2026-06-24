"use client";

import { useEffect, useState } from "react";

export default function WebOrderNotificationBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const response = await fetch("/api/internal/web-orders/unseen-count", { cache: "no-store" });
        const body = await response.json();
        if (active && response.ok && body?.ok) setCount(Number(body.count) || 0);
      } catch {
        // Keep the last known count during transient network failures.
      }
    };

    const timer = window.setInterval(refresh, 15_000);
    void refresh();

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <span
      className="ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-black text-white shadow-[0_0_18px_rgba(205,0,0,0.55)]"
      aria-label={count + " طلبات موقع جديدة"}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}