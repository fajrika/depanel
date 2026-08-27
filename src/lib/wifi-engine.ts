// Mesin simulasi WiFi (COST-231 Multi-Wall + log-distance). Pure TS, tanpa React —
// dipakai dari editor canvas (client). Interferensi dihitung on-the-fly (tidak disimpan).

export type WifiBand = "BAND_2_4" | "BAND_5" | "BAND_6";
export type WifiAntennaType = "OMNIDIRECTIONAL" | "PATCH" | "PANEL";
export type WifiWallMaterial = "DRYWALL" | "WOOD" | "GLASS" | "BRICK" | "CONCRETE";

export interface WifiWallDto {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: WifiWallMaterial;
}

export interface WifiApDto {
  id: string;
  name: string;
  ssid?: string | null;
  band: WifiBand;
  channel: number;
  channelWidth: number;
  txPowerDbm: number;
  antennaGainDbi: number;
  antennaType: WifiAntennaType;
  azimuthDeg?: number | null;
  heightM: number;
  posX: number;
  posY: number;
  enabled: boolean;
}

export interface WifiProjectDto {
  id: string;
  name: string;
  description?: string | null;
  widthM: number;
  heightM: number;
  scalePxPerM: number;
  bgColor: string;
  floorplanData?: string | null;
  pathLossExponent: number;
  deadZoneDbm: number;
}

/** Kerugian material dinding (dB) — COST-231 Multi-Wall. */
export const MATERIAL_LOSS: Record<WifiWallMaterial, number> = {
  DRYWALL: 5,
  WOOD: 6,
  GLASS: 8,
  BRICK: 12,
  CONCRETE: 20,
};

/** Path loss referensi pada 1 m per band (dB). */
export const BAND_PL0: Record<WifiBand, number> = {
  BAND_2_4: 40,
  BAND_5: 46,
  BAND_6: 48,
};

export const NOISE_FLOOR_DBM = -95;

/** Sinyal kuat — ujung hijau gradasi RSSI. */
export const STRONG_SIGNAL_DBM = -50;

/** Kanal yang valid per band. */
export const CHANNELS_BY_BAND: Record<WifiBand, number[]> = {
  BAND_2_4: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  BAND_5: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  BAND_6: [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93, 97, 101, 105, 109, 113, 117, 121, 125, 129, 133, 137, 141, 145, 149, 153, 157, 161, 165, 169, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209, 213, 217, 221, 225, 229, 233],
};

export const CHANNEL_WIDTHS: number[] = [20, 40, 80, 160];

export function bandLabel(band: WifiBand): string {
  return band === "BAND_2_4" ? "2.4" : band === "BAND_5" ? "5" : "6";
}

/** Normalisasi sudut ke [-180, 180]. */
function normDeg(a: number): number {
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Uji potongan dua segmen (AP→titik vs dinding). */
export function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Gain efektif antena ke arah titik (dB). Directional: cos² terhadap azimuth, ±60°, falloff di luar. */
export function antennaGain(ap: WifiApDto, dx: number, dy: number): number {
  if (ap.antennaType === "OMNIDIRECTIONAL") return ap.antennaGainDbi;
  const az = ((ap.azimuthDeg ?? 0) % 360) * (Math.PI / 180);
  const theta = Math.atan2(dy, dx);
  const delta = normDeg(((theta - az) * 180) / Math.PI) * (Math.PI / 180);
  const deg = Math.abs((delta * 180) / Math.PI);
  if (deg <= 60) {
    const cos2 = Math.cos(delta) ** 2;
    return ap.antennaGainDbi + 10 * Math.log10(Math.max(cos2, 1e-6));
  }
  return ap.antennaGainDbi - 15;
}

/** RSSI di titik (x,y) dari satu AP, tanpa interferensi. */
export function computeRssi(ap: WifiApDto, walls: WifiWallDto[], x: number, y: number, n: number): number {
  const dx = x - ap.posX;
  const dy = y - ap.posY;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) d = 1;
  const pl0 = BAND_PL0[ap.band];
  let wallLoss = 0;
  for (const w of walls) {
    if (segIntersect(ap.posX, ap.posY, x, y, w.x1, w.y1, w.x2, w.y2)) wallLoss += MATERIAL_LOSS[w.material];
  }
  const pl = pl0 + 10 * n * Math.log10(d) + wallLoss;
  return ap.txPowerDbm + antennaGain(ap, dx, dy) - pl;
}

/**
 * Faktor interferensi antar kanal (0 = tidak mengganggu, 1 = co-channel).
 * 2.4G: beda 1 ≈ 0.3, beda 2 ≈ 0.6, beda ≥3 ≈ 0; 5G/6G: beda 1 ≈ 0.7, sisanya 0.
 */
export function adjacentFactor(a: WifiApDto, b: WifiApDto): number {
  if (a.band !== b.band) return 0;
  const d = Math.abs(a.channel - b.channel);
  if (d === 0) return 1;
  if (a.band === "BAND_2_4") {
    if (d === 1) return 0.3;
    if (d === 2) return 0.6;
    return 0;
  }
  if (d === 1) return 0.7;
  return 0;
}

export interface PointInfo {
  x: number;
  y: number;
  bestRssi: number | null; // sinyal terbaik (dBm)
  bestAp: WifiApDto | null; // AP yang memberi sinyal terbaik
  sinrDb: number | null;
  isDead: boolean; // RSSI < ambang dead zone
  coverageOk: boolean; // tercakup (bukan dead zone) && SINR ≥ 15
  interferers: { ap: WifiApDto; rssi: number; factor: number }[]; // AP lain yang mengganggu
}

/** Evaluasi satu titik denah — simulasi user berdiri di titik itu. */
export function evaluatePoint(proj: WifiProjectDto, aps: WifiApDto[], walls: WifiWallDto[], x: number, y: number): PointInfo {
  const enabled = aps.filter((a) => a.enabled);
  if (enabled.length === 0) {
    return { x, y, bestRssi: null, bestAp: null, sinrDb: null, isDead: true, coverageOk: false, interferers: [] };
  }
  let best = -Infinity;
  let bestAp: WifiApDto | null = null;
  const rssis: { ap: WifiApDto; rssi: number }[] = [];
  for (const ap of enabled) {
    const r = computeRssi(ap, walls, x, y, proj.pathLossExponent);
    rssis.push({ ap, rssi: r });
    if (r > best) {
      best = r;
      bestAp = ap;
    }
  }
  const sLin = Math.pow(10, best / 10);
  let iLin = 0;
  const interferers: { ap: WifiApDto; rssi: number; factor: number }[] = [];
  for (const { ap, rssi } of rssis) {
    if (!bestAp || ap.id === bestAp.id) continue;
    const f = adjacentFactor(bestAp, ap);
    if (f <= 0) continue;
    iLin += f * Math.pow(10, rssi / 10);
    interferers.push({ ap, rssi, factor: f });
  }
  const noiseLin = Math.pow(10, NOISE_FLOOR_DBM / 10);
  const sinrDb = 10 * Math.log10(sLin / (noiseLin + iLin));
  const isDead = best < proj.deadZoneDbm;
  const coverageOk = !isDead && sinrDb >= 15;
  return { x, y, bestRssi: best, bestAp, sinrDb, isDead, coverageOk, interferers };
}

export interface SimResult {
  rssi: Float32Array; // dBm terbaik per sel (-Infinity bila tidak ada AP aktif)
  sinr: Float32Array; // dB per sel (-Infinity bila tidak ada AP aktif)
  signalCoveragePct: number; // % sel dengan RSSI ≥ deadZoneDbm
  sinrCoveragePct: number; // % sel dengan SINR ≥ 15 dB
  deadZonePct: number; // % sel dead zone (RSSI < deadZoneDbm)
  totalEnabled: number;
}

/** Hitung grid RSSI + SINR. cols×rows = jumlah sel; sel = luasDenah/cols. */
export function computeGrid(proj: WifiProjectDto, aps: WifiApDto[], walls: WifiWallDto[], cols: number, rows: number): SimResult {
  const n = cols * rows;
  const rssi = new Float32Array(n);
  const sinr = new Float32Array(n);
  const enabled = aps.filter((a) => a.enabled);
  const cellW = proj.widthM / cols;
  const cellH = proj.heightM / rows;
  let signalOk = 0;
  let sinrOk = 0;

  for (let i = 0; i < n; i++) {
    const cx = i % cols;
    const cy = (i / cols) | 0;
    const x = (cx + 0.5) * cellW;
    const y = (cy + 0.5) * cellH;

    if (enabled.length === 0) {
      rssi[i] = -Infinity;
      sinr[i] = -Infinity;
      continue;
    }

    let best = -Infinity;
    let bestIdx = -1;
    for (let k = 0; k < enabled.length; k++) {
      const r = computeRssi(enabled[k], walls, x, y, proj.pathLossExponent);
      if (r > best) {
        best = r;
        bestIdx = k;
      }
    }
    rssi[i] = best;

    if (bestIdx >= 0) {
      const sLin = Math.pow(10, best / 10);
      let iLin = 0;
      for (let k = 0; k < enabled.length; k++) {
        if (k === bestIdx) continue;
        const f = adjacentFactor(enabled[bestIdx], enabled[k]);
        if (f <= 0) continue;
        const r = computeRssi(enabled[k], walls, x, y, proj.pathLossExponent);
        iLin += f * Math.pow(10, r / 10);
      }
      const noiseLin = Math.pow(10, NOISE_FLOOR_DBM / 10);
      const sinrDb = 10 * Math.log10(sLin / (noiseLin + iLin));
      sinr[i] = sinrDb;
      if (best >= proj.deadZoneDbm) signalOk++;
      if (sinrDb >= 15) sinrOk++;
    } else {
      sinr[i] = -Infinity;
    }
  }

  const total = Math.max(n, 1);
  const activeCount = enabled.length;
  return {
    rssi,
    sinr,
    signalCoveragePct: activeCount === 0 ? 0 : (signalOk / total) * 100,
    sinrCoveragePct: activeCount === 0 ? 0 : (sinrOk / total) * 100,
    deadZonePct: activeCount === 0 ? 100 : ((total - signalOk) / total) * 100,
    totalEnabled: activeCount,
  };
}

/** Warna heatmap RSSI: t 0..1 (merah → kuning → hijau), -95 dBm → -50 dBm. */
export function rssiColor(rssiDbm: number): string {
  const t = Math.min(1, Math.max(0, (rssiDbm - NOISE_FLOOR_DBM) / (STRONG_SIGNAL_DBM - NOISE_FLOOR_DBM)));
  return hsl(t * 120, 80, 50);
}

/** Warna heatmap SINR: 0 dB (merah) → 30 dB (hijau). */
export function sinrColor(sinrDb: number): string {
  const t = Math.min(1, Math.max(0, sinrDb / 30));
  return hsl(t * 120, 80, 50);
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l / 100 - 1)) * (s / 100);
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l / 100 - c / 2;
  const to = (v: number) => Math.round((v + m) * 255);
  return `rgb(${to(r)},${to(g)},${to(b)})`;
}
