import { useEffect, useState } from "react";
import type { HealthResponse } from "@odoo/shared";

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    // Proxied to @odoo/core by Vite during development
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-950 text-gray-100">
      <h1 className="text-4xl font-bold tracking-tight">odoo monorepo</h1>
      <p className="text-gray-400">
        React + Tailwind + Vite in <code className="text-emerald-400">@odoo/web</code>, Express in{" "}
        <code className="text-emerald-400">@odoo/core</code>
      </p>
      {health ? (
        <p className="rounded-lg bg-emerald-900/50 px-4 py-2 text-emerald-300">
          core API is up ✅ ({new Date(health.timestamp).toLocaleTimeString()})
        </p>
      ) : (
        <p className="rounded-lg bg-red-900/50 px-4 py-2 text-red-300">
          core API not reachable — wait for it or start it separately
        </p>
      )}
    </main>
  );
}
