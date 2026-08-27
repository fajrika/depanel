"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  canViewBilling: boolean;
  canViewCost: boolean;
  canViewReports: boolean;
  canSchedule: boolean;
  canBackup: boolean;
  canBackupDb: boolean;
  canSsh: boolean;
  canInfra: boolean;
  canAccounts: boolean;
  canNotify: boolean;
  canFirewall: boolean;
  canConsole: boolean;
  canManage: boolean;
  canWifi: boolean;
  hiddenServerIds: string[];
};
type Team = {
  id: string;
  name: string;
  isPersonal: boolean;
  myRole: string;
  members: Member[];
  accounts: { id: string; name: string }[];
  servers: { id: string; hostname: string }[];
};

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "owner"
      ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:ring-amber-900"
      : role === "admin"
        ? "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-400 dark:ring-indigo-900"
        : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${cls}`}>{role}</span>;
}

export default function TeamsPage() {
  const { t } = useLang();
  const [teams, setTeams] = useState<Team[]>([]);
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const [teamName, setTeamName] = useState("");
  const [invite, setInvite] = useState<Record<string, string>>({});
  // editor visibilitas server per member: "teamId:userId" yang sedang dibuka
  const [serverEditor, setServerEditor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tRes, meRes] = await Promise.all([fetch("/api/teams"), fetch("/api/me")]);
    const t = await tRes.json();
    const meD = await meRes.json();
    setTeams(t.data ?? []);
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
      setMsg({ text: d.message ?? t("teams.errGeneric"), ok: false });
      return false;
    }
    load();
    window.dispatchEvent(new Event("profile-updated")); // refresh switcher di nav
    return true;
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("teams.title")}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("teams.subtitle1")} <b>Owner</b> {t("teams.subtitle2")}{" "}
          <b>admin</b> {t("teams.subtitle3")} <b>member</b> {t("teams.subtitle4")}.
        </p>
      </div>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* buat tim */}
      <form
        className={`${card} flex flex-wrap items-end gap-3`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await api("/api/teams", "POST", { name: teamName })) {
            setTeamName("");
            setMsg({ text: t("teams.created"), ok: true });
          }
        }}
      >
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{t("teams.newName")}</label>
          <input required value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={t("teams.namePlaceholder")} className={`${input} mt-1 w-full max-w-sm`} />
        </div>
        <button disabled={busy} className={btnPrimary}>+ {t("teams.createBtn")}</button>
      </form>

      {/* daftar tim */}
      {loading ? (
        <div className={`${card} h-40 animate-pulse`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {teams.map((team) => {
            const iAmOwner = team.myRole === "owner";
            const iAmStaff = iAmOwner || team.myRole === "admin";
            return (
              <div key={team.id} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                      <span>{team.isPersonal ? "👤" : "👥"}</span>
                      <span className="truncate">{team.name}</span>
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {team.members.length} {t("teams.membersUnit")} · {team.accounts.length} {t("teams.accountsUnit")} · {t("teams.you")} <b>{team.myRole}</b>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    {!team.isPersonal && iAmOwner && (
                      <button
                        onClick={() => confirm(`${t("teams.confirmDelete1")} "${team.name}" ${t("teams.confirmDelete2")}`) && api(`/api/teams/${team.id}`, "DELETE")}
                        className="font-medium text-red-500 hover:underline"
                      >
                        {t("teams.deleteBtn")}
                      </button>
                    )}
                    {!team.isPersonal && !iAmOwner && (
                      <button
                        onClick={() => confirm(`${t("teams.confirmLeave1")} "${team.name}"${t("teams.confirmLeave2")}`) && api(`/api/teams/${team.id}/members`, "DELETE", { userId: myId })}
                        className="font-medium text-slate-500 hover:underline dark:text-slate-400"
                      >
                        {t("teams.leave")}
                      </button>
                    )}
                  </div>
                </div>

                {/* anggota */}
                <div className="mt-4 space-y-2">
                  {team.members.map((m) => {
                    const targetIsOwner = m.role === "owner";
                    const canKick =
                      m.id !== myId && !targetIsOwner && (iAmOwner || (team.myRole === "admin" && m.role === "member"));
                    return (
                      <div
                        key={m.id}
                        className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/40"
                      >
                        {/* Lantai 1 — identitas */}
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                            {m.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                              {m.name} {m.id === myId && <span className="text-xs text-slate-400">({t("teams.youLabel")})</span>}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">{m.email}</p>
                          </div>
                          <RoleBadge role={m.role} />
                          {canKick && (
                            <button
                              onClick={() => confirm(`${t("teams.confirmKick1")} ${m.name} ${t("teams.confirmKick2")}`) && api(`/api/teams/${team.id}/members`, "DELETE", { userId: m.id })}
                              disabled={busy}
                              className="shrink-0 text-[11px] font-medium text-red-500 hover:underline"
                            >
                              {t("teams.kick")}
                            </button>
                          )}
                        </div>

                        {/* Lantai 2 — izin & aksi role */}
                        {((iAmStaff && m.role === "member") || (iAmOwner && m.id !== myId && !team.isPersonal)) && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200/70 pt-2 dark:border-slate-700/60">
                            {iAmStaff && m.role === "member" && (
                              <>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipBilling")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canViewBilling}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canViewBilling: !m.canViewBilling })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permBilling")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipSchedule")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canSchedule}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canSchedule: !m.canSchedule })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permSchedule")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipBackup")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canBackup}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canBackup: !m.canBackup })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permBackup")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipCost")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canViewCost}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canViewCost: !m.canViewCost })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permCost")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipReports")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canViewReports}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canViewReports: !m.canViewReports })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permReports")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipBackupDb")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canBackupDb}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canBackupDb: !m.canBackupDb })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permBackupDb")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipSsh")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canSsh}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canSsh: !m.canSsh })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permSsh")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipInfra")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canInfra}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canInfra: !m.canInfra })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permInfra")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipAccounts")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canAccounts}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canAccounts: !m.canAccounts })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permAccounts")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipNotify")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canNotify}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canNotify: !m.canNotify })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permNotify")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipFirewall")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canFirewall}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canFirewall: !m.canFirewall })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permFirewall")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipConsole")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canConsole}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canConsole: !m.canConsole })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permConsole")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipManage")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canManage}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canManage: !m.canManage })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permManage")}
                                </label>
                                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400" title={t("teams.tipWifi")}>
                                  <input
                                    type="checkbox"
                                    checked={m.canWifi}
                                    disabled={busy}
                                    onChange={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, canWifi: !m.canWifi })}
                                    className="h-3 w-3 accent-emerald-600"
                                  />
                                  {t("teams.permWifi")}
                                </label>
                                <button
                                  onClick={() => setServerEditor(serverEditor === `${team.id}:${m.id}` ? null : `${team.id}:${m.id}`)}
                                  title={t("teams.tipServerVis")}
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition ${
                                    m.hiddenServerIds.length > 0
                                      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:ring-amber-900"
                                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                  }`}
                                >
                                  🖥 {t("teams.serverVisLabel")}{m.hiddenServerIds.length > 0 ? ` (${team.servers.length - m.hiddenServerIds.length}/${team.servers.length})` : ""}
                                </button>
                              </>
                            )}

                            {iAmOwner && m.id !== myId && !team.isPersonal && (
                              <div className="ml-auto flex gap-1 text-[11px]">
                                {m.role === "member" && (
                                  <button onClick={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, role: "admin" })} disabled={busy} className="rounded px-1.5 py-0.5 font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40">
                                    → {t("teams.toAdmin")}
                                  </button>
                                )}
                                {m.role === "admin" && (
                                  <button onClick={() => api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, role: "member" })} disabled={busy} className="rounded px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                                    → {t("teams.toMember")}
                                  </button>
                                )}
                                <button
                                  onClick={() =>
                                    confirm(`${t("teams.confirmOwn1")} "${team.name}" ke ${m.name}${t("teams.confirmOwn2")} ${m.name} ${t("teams.confirmOwn3")}`) &&
                                    api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, role: "owner" })
                                  }
                                  disabled={busy}
                                  className="rounded px-1.5 py-0.5 font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                                >
                                  👑 {t("teams.makeOwner")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* editor visibilitas server per member */}
                        {serverEditor === `${team.id}:${m.id}` && (
                          <div className="animate-fade-up mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              {t("teams.serverVisHeader")} {m.name} {t("teams.serverVisHeader2")}
                            </p>
                            {team.servers.length === 0 ? (
                              <p className="mt-1.5 text-[11px] text-slate-400">{t("teams.noServers")}</p>
                            ) : (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {team.servers.map((srv) => {
                                  const shown = !m.hiddenServerIds.includes(srv.id);
                                  return (
                                    <button
                                      key={srv.id}
                                      disabled={busy}
                                      onClick={() => {
                                        const nextHidden = shown
                                          ? [...m.hiddenServerIds, srv.id]
                                          : m.hiddenServerIds.filter((x) => x !== srv.id);
                                        api(`/api/teams/${team.id}/members`, "PATCH", { userId: m.id, hiddenServerIds: nextHidden });
                                      }}
                                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                                        shown
                                          ? "bg-emerald-600 text-white shadow-sm"
                                          : "bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500"
                                      }`}
                                    >
                                      {shown ? "✓ " : ""}{srv.hostname}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* undang member */}
                  {iAmStaff && !team.isPersonal && (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await api(`/api/teams/${team.id}/members`, "POST", { email: invite[team.id] ?? "" })) {
                          setInvite((v) => ({ ...v, [team.id]: "" }));
                        }
                      }}
                    >
                      <input
                        required
                        type="email"
                        value={invite[team.id] ?? ""}
                        onChange={(e) => setInvite((v) => ({ ...v, [team.id]: e.target.value }))}
                        placeholder={t("teams.invitePlaceholder")}
                        className={`${input} min-w-0 flex-1 !py-1.5 text-xs`}
                      />
                      <button disabled={busy} className="shrink-0 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                        + {t("teams.invite")}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
