"use client";

import { useEffect } from "react";
import { useLang } from "@/lib/i18n";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLang();
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-3xl">⚠️</p>
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("err.title")}</h1>
      <pre className="max-w-full overflow-auto rounded-lg bg-red-50 px-4 py-3 text-left text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
        {error.message}
      </pre>
      <button
        onClick={reset}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {t("err.retry")}
      </button>
    </div>
  );
}
