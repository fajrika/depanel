"use client";

import { useEffect, useState } from "react";

const input =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btn =
  "rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function ProfilePage() {
  const [me, setMe] = useState<{ name: string; email: string; role: string; uiLayout?: string } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [uiLayout, setUiLayout] = useState("topbar");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) {
          setMe(d.user);
          setName(d.user.name);
          setEmail(d.user.email);
          setUiLayout(d.user.uiLayout ?? "topbar");
        }
      })
      .catch(() => {});
  }, []);

  async function patch(body: Record<string, string>, which: string) {
    setBusy(which);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? "Gagal menyimpan", ok: false });
      return false;
    }
    if (d.data) {
      setMe((m) => (m ? { ...m, ...d.data } : m));
      // Nav membaca /api/me saat load — refresh ringan agar nama baru tampil
      window.dispatchEvent(new Event("profile-updated"));
    }
    return true;
  }

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    if (await patch({ name, email }, "info")) {
      setMsg({ text: "Profil tersimpan.", ok: true });
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setMsg({ text: "Konfirmasi password tidak sama", ok: false });
      return;
    }
    if (await patch({ currentPassword, newPassword }, "password")) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setMsg({ text: "Password berhasil diganti.", ok: true });
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Profil saya</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Ubah nama, email, dan password akun Anda.
        {me?.role === "admin" && " Anda admin — akun anggota lain dikelola lewat menu Tim."}
      </p>

      {msg && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Info akun */}
      <form onSubmit={saveInfo} className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Informasi akun</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className={label}>Nama</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Email dipakai untuk login.</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button disabled={busy === "info"} className={btn}>
            {busy === "info" ? "Menyimpan…" : "Simpan profil"}
          </button>
        </div>
      </form>

      {/* Tampilan menu */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Tampilan menu</h2>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Pilih posisi menu navigasi aplikasi.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { v: "topbar", l: "Top bar", d: "Menu horizontal di bagian atas", icon: "▬" },
            { v: "sidebar", l: "Side bar", d: "Menu vertikal di sisi kiri", icon: "▮" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={async () => {
                setUiLayout(o.v);
                if (await patch({ uiLayout: o.v }, "layout")) {
                  setMsg({ text: `Tampilan diubah ke ${o.l}.`, ok: true });
                }
              }}
              disabled={busy === "layout"}
              className={`rounded-xl border-2 p-4 text-left transition ${
                uiLayout === o.v
                  ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-600 dark:bg-indigo-950/30"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <span className="text-lg">{o.icon}</span> {o.l}
                {uiLayout === o.v && <span className="ml-auto text-emerald-500">✓</span>}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{o.d}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Ganti password */}
      <form onSubmit={savePassword} className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ganti password</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className={label}>Password saat ini</label>
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={input}
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Password baru (min. 8)</label>
              <input
                required
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={input}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={label}>Ulangi password baru</label>
              <input
                required
                type="password"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={input}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button disabled={busy === "password"} className={btn}>
            {busy === "password" ? "Menyimpan…" : "Ganti password"}
          </button>
        </div>
      </form>
    </div>
  );
}
