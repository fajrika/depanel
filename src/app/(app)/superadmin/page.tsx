"use client";

import { useCallback, useEffect, useState } from "react";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  teams: { id: string; name: string; role: string; isPersonal: boolean }[];
};
type TeamRow = {
  id: string;
  name: string;
  isPersonal: boolean;
  accountCount: number;
  members: { id: string; name: string; email: string; role: string }[];
};

const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function SuperAdminPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [myId, setMyId] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "member" });

  const load = useCallback(async () => {
    const [oRes, meRes] = await Promise.all([fetch("/api/superadmin/overview"), fetch("/api/me")]);
    if (oRes.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const o = await oRes.json();
    const meD = await meRes.json();
    setUsers(o.data?.users ?? []);
    setTeams(o.data?.teams ?? []);
    setMyId(meD?.user?.id ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  async function impersonate(u: UserRow) {
    if (!confirm(`Masuk sebagai ${u.name} (${u.email})?\n\nAnda akan melihat aplikasi persis seperti dia. Banner kuning akan muncul untuk kembali.`)) return;
    const ok = await api("/api/superadmin/impersonate", "POST", { userId: u.id });
    if (ok) window.location.href = "/";
  }

  if (forbidden) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
        Halaman ini khusus super admin (akun pertama aplikasi).
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">⚡ Super Admin</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Kendali penuh atas seluruh pengguna dan tim di aplikasi. Hanya Anda yang bisa membuka halaman ini.
        </p>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ===== semua user ===== */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Semua pengguna</h2>

        <form
          className={`${card} mb-4 flex flex-wrap items-end gap-3 p-5`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await api("/api/users", "POST", nu)) setNu({ name: "", email: "", password: "", role: "member" });
          }}
        >
          <div><label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Nama</label><input required value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} className={`${input} mt-1 w-40`} /></div>
          <div><label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Email</label><input required type="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} className={`${input} mt-1 w-56`} /></div>
          <div><label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Password (min. 8)</label><input required type="text" minLength={8} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} className={`${input} mt-1 w-44`} /></div>
          <button disabled={busy} className={btnPrimary}>+ Daftarkan user</button>
        </form>

        {loading ? (
          <div className={`${card} h-32 animate-pulse`} />
        ) : (
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-3 font-semibold">Pengguna</th>
                  <th className="px-4 py-3 font-semibold">Tim</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {u.name} {u.id === myId && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-400">super admin</span>}
                      </p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.teams.filter((t) => !t.isPersonal).map((t) => (
                          <span key={t.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {t.name} · {t.role}
                          </span>
                        ))}
                        {u.teams.filter((t) => !t.isPersonal).length === 0 && <span className="text-xs text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${u.active ? "text-emerald-600" : "text-red-500"}`}>{u.active ? "aktif" : "nonaktif"}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {u.id !== myId && (
                        <>
                          <button onClick={() => impersonate(u)} disabled={busy || !u.active} className="mr-3 font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400">
                            🎭 Masuk sebagai
                          </button>
                          <button onClick={() => api(`/api/users/${u.id}`, "PATCH", { active: !u.active })} disabled={busy} className="mr-3 font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-100">
                            {u.active ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                          <button
                            onClick={() => {
                              const pw = prompt(`Password baru untuk ${u.email} (min. 8):`);
                              if (pw) api(`/api/users/${u.id}`, "PATCH", { password: pw });
                            }}
                            disabled={busy}
                            className="mr-3 font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-100"
                          >
                            Reset pw
                          </button>
                          <button onClick={() => confirm(`Hapus akun ${u.email}?`) && api(`/api/users/${u.id}`, "DELETE")} disabled={busy} className="font-medium text-red-500 hover:text-red-700 disabled:opacity-40">
                            Hapus
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===== semua tim ===== */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Semua tim</h2>
        {loading ? (
          <div className={`${card} h-32 animate-pulse`} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {teams.map((t) => (
              <div key={t.id} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <span>{t.isPersonal ? "👤" : "👥"}</span>
                    <span className="truncate">{t.name}</span>
                    <span className="text-[10px] font-normal text-slate-400">{t.accountCount} akun API</span>
                  </p>
                  {!t.isPersonal && (
                    <button
                      onClick={() => confirm(`(Super admin) Hapus tim "${t.name}" beserta seluruh datanya?`) && api(`/api/superadmin/teams/${t.id}`, "DELETE")}
                      disabled={busy}
                      className="shrink-0 text-xs font-medium text-red-500 hover:underline disabled:opacity-40"
                    >
                      Hapus
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.members.map((m) => (
                    <span key={m.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {m.name} · {m.role}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
