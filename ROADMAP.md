# Depanel — Roadmap Fitur

Status: ⬜ belum · 🟡 dikerjakan · ✅ selesai

| # | Fitur | Status | Selesai |
|---|-------|--------|---------|
| 1 | Notifikasi (Telegram/Discord/webhook) — auto start/stop, backup gagal/berhasil, saldo rendah, server error | ✅ | 2026-07-12 |
| 2 | Dashboard biaya & penghematan (estimasi bulanan + hemat dari scheduling) | ✅ | 2026-07-12 |
| 3 | Restore & kelola arsip Backup DB (restore, download, retensi/hapus) | ✅ | 2026-07-12 |
| 4 | Riwayat metrik & uptime sendiri (sampling berkala tiap 15 mnt + uptime %) | ✅ | 2026-07-12 |
| 5 | Aksi massal (start/stop/restart banyak server sekaligus) | ✅ | 2026-07-12 |
| 6 | 2FA (TOTP) untuk login | ✅ | 2026-07-12 |
| 7 | Firewall per server (rules ACCEPT/DROP) | ✅ | 2026-07-12 |
| 8 | Web console (buka sesi console depa) | ✅ | 2026-07-12 |
| 9 | Resize / ganti tier (+ preview harga) | ✅ | 2026-07-12 |
| 10 | Reinstall / rebuild OS | ✅ | 2026-07-12 |
| 11 | Buat & hapus instance (staff-only, hapus diblok utk server production) | ✅ | 2026-07-12 |
| 12 | Block storage (create/attach/detach/resize/hapus) | ✅ | 2026-07-12 |
| 13 | SSH keys (kelola key per akun) | ✅ | 2026-07-12 |
| 14 | Top-up saldo (buat invoice, bayar manual — bukan auto-charge) | ✅ | 2026-07-12 |

> Catatan: seluruh 14 fitur selesai 2026-07-12. Verifikasi: `tsc --noEmit` bersih, `next build` sukses,
> `build:server` (worker) sukses, dan smoke test runtime (login, render semua halaman baru, alur 2FA
> setup→enable→login penuh) lolos. **Belum di-push ke GitHub** — menunggu perintah push dari kamu.

## Ringkasan implementasi

**Backend / lib baru**
- `src/lib/notify.ts` — kirim ke Telegram/Discord/webhook, `notifyTeam(event)`.
- `src/lib/alerts.ts` — cek saldo rendah & server error (dedup 6 jam), dipanggil worker /15 mnt.
- `src/lib/metrics.ts` — rekam `MetricSample` per server + hitung uptime, retensi 30 hari.
- `src/lib/totp.ts` — TOTP RFC 6238 (HMAC-SHA1 via crypto), base32, otpauth URL.
- `src/lib/server-guard.ts` — `serverCtx`/`accountStaffCtx` guard reusable.
- `src/lib/depa.ts` — ditambah: resize, tier, reinstall, systems, locations, size, instance
  create/delete, console, firewall*, block*, sshKey*, topup*.
- `src/lib/power.ts`, `src/lib/dbbackup.ts` — hook notifikasi + restore/delete run.
- `worker/index.ts` — cron alerts + sampling metrik /15 mnt.

**Skema Prisma**: `User.totpSecret/totpEnabled`, `Team.lowBalanceThreshold`, model
`NotifyChannel`, model `MetricSample`.

**Halaman & komponen UI**
- `/notifications`, `/cost`, `/infra` (baru) + link di `AppShell`.
- `FirewallPanel`, `ConsolePanel`, `ManagePanel` (tab baru di `ServerMonitor`, khusus staff).
- `TwoFactorSection` (profil), field kode 2FA di halaman login.
- `TopupPanel` (di rincian saldo), tombol restore/unduh/hapus di `dbbackup`.
- Aksi massal (checkbox + bar) & badge uptime di dashboard/monitoring.
