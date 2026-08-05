"use client";

import { useCallback, useEffect, useState } from "react";

type Ssh = { id: string; name: string; host: string; port: number; username: string; authType: string; connCount: number };

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

const emptyNs = { name: "", host: "", port: "22", username: "", authType: "password", password: "", privateKey: "", keyPassphrase: "" };

export default function SshKoneksiPage() {
  const [sshs, setSshs] = useState<Ssh[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editSshId, setEditSshId] = useState<string | null>(null);
  const [ns, setNs] = useState(emptyNs);

  const load = useCallback(async () => {
    const res = await fetch("/api/db/ssh");
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const d = await res.json();
    setSshs(d.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function api(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.ok === false) {
      setMsg({ text: d.message ?? "Terjadi kesalahan", ok: false });
      return false;
    }
    load();
    return true;
  }

  if (forbidden) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">Halaman ini hanya untuk admin.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">SSH Koneksi</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Kelola koneksi SSH (jump host) yang dipakai sebagai jalur tunnel untuk koneksi database.
        </p>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 whitespace-pre-wrap rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">SSH Koneksi</h2>
          <button onClick={() => { setShowForm(!showForm); setEditSshId(null); setNs(emptyNs); }} className={btnPrimary}>
            {showForm ? "Tutup form" : "+ Tambah koneksi SSH"}
          </button>
        </div>

        {showForm && (
          <form
            className={`${card} animate-fade-up mb-4 space-y-5`}
            onSubmit={async (e) => {
              e.preventDefault();
              const payload = { ...ns, port: Number(ns.port) || 22 };
              const ok = await api(editSshId ? `/api/db/ssh/${editSshId}` : "/api/db/ssh", editSshId ? "PATCH" : "POST", payload);
              if (ok) {
                setShowForm(false);
                setEditSshId(null);
                setNs(emptyNs);
                setMsg({ text: editSshId ? "Koneksi SSH diperbarui." : "Koneksi SSH tersimpan (tes koneksi berhasil).", ok: true });
              }
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editSshId ? "Edit Koneksi SSH" : "Buat Koneksi SSH"}</h3>
              <button type="button" onClick={() => { setShowForm(false); setEditSshId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕ Tutup</button>
            </div>

            <div className="flex flex-wrap gap-4">
              <div><label className={label}>Nama</label><input required value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} placeholder="mis. Jump Server Produksi" className={`${input} mt-1 w-56`} /></div>
              <div><label className={label}>Host</label><input required value={ns.host} onChange={(e) => setNs({ ...ns, host: e.target.value })} placeholder="103.x.x.x" className={`${input} mt-1 w-56`} /></div>
              <div><label className={label}>Port</label><input value={ns.port} onChange={(e) => setNs({ ...ns, port: e.target.value })} className={`${input} mt-1 w-24`} /></div>
              <div><label className={label}>Username</label><input required value={ns.username} onChange={(e) => setNs({ ...ns, username: e.target.value })} placeholder="root" className={`${input} mt-1 w-44`} /></div>
            </div>

            <div>
              <label className={label}>Metode autentikasi</label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {([{ v: "password", l: "🔑 Password" }, { v: "key", l: "🗝️ Public Key" }] as const).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setNs({ ...ns, authType: o.v })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${ns.authType === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            {ns.authType === "password" ? (
              <div>
                <label className={label}>Password</label>
                <input type="password" required={!editSshId} value={ns.password} onChange={(e) => setNs({ ...ns, password: e.target.value })} placeholder={editSshId ? "Kosongkan jika tidak diubah" : ""} className={`${input} mt-1 w-72`} />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className={label}>Private key (PEM)</label>
                  <textarea
                    required={!editSshId}
                    value={ns.privateKey}
                    onChange={(e) => setNs({ ...ns, privateKey: e.target.value })}
                    placeholder={editSshId ? "Tempel private key baru, kosongkan jika memakai yang tersimpan" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                    spellCheck={false}
                    className={`${input} mt-1 w-full font-mono text-xs`}
                    rows={6}
                  />
                </div>
                <div>
                  <label className={label}>Passphrase (opsional)</label>
                  <input type="password" value={ns.keyPassphrase} onChange={(e) => setNs({ ...ns, keyPassphrase: e.target.value })} placeholder="Passphrase private key jika ada" className={`${input} mt-1 w-72`} />
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Koneksi SSH ini dipakai sebagai jalur tunnel untuk koneksi database. Arahkan DNS/port MySQL di server SSH ke database tujuan (mis. localhost:3306).
            </p>

            <div className="flex justify-end">
              <button disabled={busy} className={btnPrimary}>{busy ? "…" : editSshId ? "Simpan edit" : "Tes & simpan"}</button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        ) : sshs.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
            Belum ada koneksi SSH. Tambahkan jump host untuk mengakses database di balik tunnel.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sshs.map((s) => (
              <div key={s.id} className={`${card} flex items-center justify-between gap-3 !p-4`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{s.name}</p>
                    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {s.authType === "key" ? "🗝️ Public key" : "🔑 Password"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-400">{s.username}@{s.host}:{s.port} · {s.connCount} koneksi DB</p>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button onClick={() => { setEditSshId(s.id); setNs({ name: s.name, host: s.host, port: String(s.port), username: s.username, authType: s.authType === "key" ? "key" : "password", password: "", privateKey: "", keyPassphrase: "" }); setShowForm(true); }} className="font-medium text-slate-500 hover:underline dark:text-slate-400">Edit</button>
                  <button onClick={() => confirm(`Hapus koneksi SSH "${s.name}"?`) && api(`/api/db/ssh/${s.id}`, "DELETE")} className="font-medium text-red-500 hover:underline">Hapus</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
