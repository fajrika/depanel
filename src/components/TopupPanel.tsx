"use client";

import { useState } from "react";

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const btn =
  "rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

type Method = { code?: string; id?: string; name?: string; label?: string; fee?: number };
const PRESETS = [50000, 100000, 250000, 500000, 1000000];

function rupiah(n: number) {
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}
function pull<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) return (v as { data: T[] }).data;
  return [];
}
function findLink(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const d = obj as Record<string, unknown>;
  for (const k of ["payment_url", "checkout_url", "url", "qr_url", "invoice_url", "link"]) {
    if (typeof d[k] === "string") return d[k] as string;
  }
  if (d.data && typeof d.data === "object") return findLink(d.data);
  return null;
}

export default function TopupPanel({ accountId }: { accountId: string }) {
  const [amount, setAmount] = useState(100000);
  const [methods, setMethods] = useState<Method[]>([]);
  const [method, setMethod] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [invoice, setInvoice] = useState<{ link: string | null; raw: unknown } | null>(null);

  async function loadMethods() {
    setBusy("methods");
    setMsg(null);
    const res = await fetch(`/api/billing/${accountId}/topup?amount=${amount}`);
    const d = await res.json();
    setBusy(null);
    if (d.ok) {
      const list = pull<Method>(d.data);
      setMethods(list);
      if (list.length && !method) setMethod(list[0].code ?? list[0].id ?? "");
    } else setMsg({ text: d.message ?? "Gagal memuat metode", ok: false });
  }

  async function createInvoice() {
    setBusy("create");
    setMsg(null);
    setInvoice(null);
    const res = await fetch(`/api/billing/${accountId}/topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, payment_method: method, phone_number: phone }),
    });
    const d = await res.json();
    setBusy(null);
    if (d.ok) {
      setInvoice({ link: findLink(d.data), raw: d.data });
      setMsg({ text: "Invoice dibuat. Selesaikan pembayaran di aplikasi pembayaranmu.", ok: true });
    } else setMsg({ text: d.message ?? "Gagal membuat invoice", ok: false });
  }

  return (
    <div className={card}>
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Top up saldo</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Depanel hanya membuat invoice — pembayaran diselesaikan sendiri di aplikasi pembayaranmu. Depanel tidak memindahkan dana.
      </p>

      {msg && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setAmount(p)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${amount === p ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300" : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            {rupiah(p)}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400">Nominal (IDR)</label>
          <input value={amount} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)} className={`${input} mt-1 w-36`} />
        </div>
        <button onClick={loadMethods} disabled={busy === "methods" || amount < 10000} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          {busy === "methods" ? "Memuat…" : "Muat metode bayar"}
        </button>
      </div>

      {methods.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400">Metode</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${input} mt-1`}>
              {methods.map((m, i) => (
                <option key={i} value={m.code ?? m.id}>{m.name ?? m.label ?? m.code ?? m.id}{m.fee ? ` (+${rupiah(m.fee)})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400">No. HP (opsional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={`${input} mt-1 w-40`} />
          </div>
          <button onClick={createInvoice} disabled={busy === "create" || !method} className={btn}>
            {busy === "create" ? "Membuat…" : "Buat invoice"}
          </button>
        </div>
      )}

      {invoice && (
        <div className="mt-4">
          {invoice.link ? (
            <a href={invoice.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
              ↗ Bayar sekarang
            </a>
          ) : (
            <pre className="max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{JSON.stringify(invoice.raw, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
