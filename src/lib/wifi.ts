// Helper server untuk modul WiFi (route handlers + auth + presets). Server-only.
import "server-only";
import { prisma } from "./db";
import { getCurrentUser } from "./auth";
import { getActiveTeam, canUseFeature, type ActiveTeam } from "./team";
import type { WifiBand, WifiAntennaType } from "./wifi-engine";

export type WifiGuard =
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; team: ActiveTeam }
  | { ok: false; status: number; message: string };

/** Auth + scope team + izin fitur wifi. */
export async function requireWifi(): Promise<WifiGuard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, message: "Unauthorized" };
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "wifi"))) {
    return { ok: false, status: 403, message: "Anda tidak diberi izin membuka simulator WiFi" };
  }
  return { ok: true, user, team };
}

/** Pastikan proyek milik tim aktif. */
export async function ownWifiProject(teamId: string, projectId: string) {
  const p = await prisma.wifiProject.findFirst({ where: { id: projectId, teamId } });
  if (!p) {
    return { ok: false as const, status: 404, message: "Proyek tidak ditemukan" };
  }
  return { ok: true as const, project: p };
}

/** Daftar preset vendor AP (diseed otomatis saat pertama kali diminta). */
export const DEFAULT_PRESETS: { brand: string; model: string; band: WifiBand; txPowerDbm: number; antennaGainDbi: number; antennaType: WifiAntennaType }[] = [
  { brand: "TP-Link", model: "Archer AX55", band: "BAND_2_4", txPowerDbm: 23, antennaGainDbi: 4, antennaType: "OMNIDIRECTIONAL" },
  { brand: "TP-Link", model: "Archer AX55", band: "BAND_5", txPowerDbm: 23, antennaGainDbi: 4, antennaType: "OMNIDIRECTIONAL" },
  { brand: "TP-Link", model: "EAP670", band: "BAND_5", txPowerDbm: 20, antennaGainDbi: 5, antennaType: "OMNIDIRECTIONAL" },
  { brand: "Ubiquiti", model: "UniFi 6 Lite", band: "BAND_2_4", txPowerDbm: 20, antennaGainDbi: 3, antennaType: "OMNIDIRECTIONAL" },
  { brand: "Ubiquiti", model: "UniFi 6 Lite", band: "BAND_5", txPowerDbm: 20, antennaGainDbi: 3, antennaType: "OMNIDIRECTIONAL" },
  { brand: "Ubiquiti", model: "U6-LR", band: "BAND_5", txPowerDbm: 23, antennaGainDbi: 4, antennaType: "OMNIDIRECTIONAL" },
  { brand: "Ubiquiti", model: "NanoStation 5AC", band: "BAND_5", txPowerDbm: 26, antennaGainDbi: 16, antennaType: "PATCH" },
  { brand: "MikroTik", model: "hAP ac3", band: "BAND_2_4", txPowerDbm: 20, antennaGainDbi: 2.5, antennaType: "OMNIDIRECTIONAL" },
  { brand: "MikroTik", model: "hAP ac3", band: "BAND_5", txPowerDbm: 20, antennaGainDbi: 2.5, antennaType: "OMNIDIRECTIONAL" },
  { brand: "MikroTik", model: "cAP ax", band: "BAND_5", txPowerDbm: 22, antennaGainDbi: 3, antennaType: "OMNIDIRECTIONAL" },
  { brand: "MikroTik", model: "SXTsq 5 ac", band: "BAND_5", txPowerDbm: 25, antennaGainDbi: 14, antennaType: "PANEL" },
];

export async function ensurePresets(): Promise<void> {
  const count = await prisma.wifiApPreset.count();
  if (count === 0) {
    await prisma.wifiApPreset.createMany({ data: DEFAULT_PRESETS });
  }
}
