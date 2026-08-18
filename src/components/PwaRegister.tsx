"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

/** Registrasi service worker + polling update + popup versi baru. */
export default function PwaRegister() {
  const { t } = useLang();
  const [update, setUpdate] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let interval: ReturnType<typeof setInterval> | undefined;

    navigator.serviceWorker
      .register("/sw")
      .then(async (reg) => {
        // cek update berkala (sw.js berubah tiap deploy → updatefound)
        const check = async () => {
          try {
            await reg.update();
          } catch {
            /* ignore */
          }
        };
        interval = setInterval(check, 60_000);
        await check();

        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              setUpdate(true);
            }
          });
        });
      })
      .catch(() => {
        /* SW tidak tersedia — biarkan */
      });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // SW baru mengambil alih — reload otomatis agar langsung versi baru
      window.location.reload();
    });

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  if (!update) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <span className="text-lg">🔄</span>
      <div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("pwa.update")}</p>
        <p className="text-[11px] text-slate-400">{t("pwa.hint")}</p>
      </div>
      <button
        onClick={() => {
          navigator.serviceWorker.getRegistration().then((reg) => {
            reg?.active?.postMessage({ type: "SKIP_WAITING" });
          });
          window.location.reload();
        }}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {t("pwa.reload")}
      </button>
    </div>
  );
}
