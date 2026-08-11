"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLang } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code: code || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.need2fa) {
          setNeed2fa(true);
          setError(code ? t("login.tfaWrong") : t("login.tfaNeeded"));
          return;
        }
        setError(data.message ?? t("login.fail"));
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(t("login.networkErr"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">⚡ Depanel</h1>
          <button
            type="button"
            onClick={() => setLang(lang === "id" ? "en" : "id")}
            title={`${t("lang.title")}: ${t(`lang.${lang}`)}`}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {lang === "id" ? "ID" : "EN"}
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("login.subtitle")}</p>

        <label className="mt-5 block text-sm font-medium">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />

        <label className="mt-4 block text-sm font-medium">{t("login.password")}</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />

        {need2fa && (
          <>
            <label className="mt-4 block text-sm font-medium">{t("login.tfaCode")}</label>
            <input
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </>
        )}

        {error && <p className="mt-3 rounded-md bg-red-50 dark:bg-red-950/50 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-md bg-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? t("login.processing") : t("login.submit")}
        </button>
      </form>
    </div>
  );
}
