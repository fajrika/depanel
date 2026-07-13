"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  hostname: string;
  account: string;
  pricePerHour: number;
  estMonthly: number;
  scheduled: boolean;
  offPercent: number;
  monthlySaving: number;
};
type Data = {
  team: { id: string; name: string };
  monthlyList: number;
  monthlySaving: number;
  monthlyNet: number;
  servers: Row[];
};

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

function rupiah(n: number): string {
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" | "slate" }) {
  const c = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100";
  return (
    <div className={card}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${c}`}>{value}</p>
    </div>
  );
}

export default function CostPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing/cost")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Biaya &amp; penghematan</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Estimasi biaya bulanan bila server selalu menyala, dan hematnya dari penjadwalan nyala-mati.
      </p>

      {loading ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
      ) : !data ? (
        <p className="mt-6 text-sm text-red-600">Gagal memuat data biaya.</p>
      ) : (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Stat label="Estimasi bila selalu on" value={rupiah(data.monthlyList)} tone="slate" />
            <Stat label="Hemat dari jadwal / bln" value={rupiah(data.monthlySaving)} tone="emerald" />
            <Stat label="Estimasi biaya bersih" value={rupiah(data.monthlyNet)} tone="amber" />
          </div>

          <div className={`${card} mt-6 overflow-x-auto`}>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Server</th>
                  <th className="py-2 pr-4 font-medium">Biaya/jam</th>
                  <th className="py-2 pr-4 font-medium">Est/bulan</th>
                  <th className="py-2 pr-4 font-medium">Mati terjadwal</th>
                  <th className="py-2 font-medium">Hemat/bln</th>
                </tr>
              </thead>
              <tbody>
                {data.servers.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/50">
                    <td className="py-2 pr-4 font-medium text-slate-800 dark:text-slate-100">{s.hostname}</td>
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{rupiah(s.pricePerHour)}</td>
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{rupiah(s.estMonthly)}</td>
                    <td className="py-2 pr-4">
                      {s.scheduled ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{s.offPercent}%</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">tanpa jadwal</span>
                      )}
                    </td>
                    <td className="py-2 font-medium text-emerald-600 dark:text-emerald-400">{s.monthlySaving > 0 ? rupiah(s.monthlySaving) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            *Penghematan disimulasikan dari jadwal mingguan (sampel 30 menit) × harga per jam. Angka aktual bergantung pemakaian nyata.
          </p>
        </>
      )}
    </div>
  );
}
