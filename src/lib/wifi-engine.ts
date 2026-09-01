// Mesin simulasi WiFi (COST-231 Multi-Wall + log-distance), pure TS tanpa React.
// Mendukung multi-lantai: jarak 3D + redaman slab per material lantai (beton/kayu/gipsum).
// Interferensi dihitung on-the-fly (tidak disimpan). 1 AP bisa punya banyak radio.

export type WifiBand = "BAND_2_4" | "BAND_5" | "BAND_6";
export type WifiAntennaType = "OMNIDIRECTIONAL" | "PATCH" | "PANEL";
export type WifiWallMaterial = "DRYWALL" | "WOOD" | "GLASS" | "BRICK" | "CONCRETE";
export type WifiFloorMaterial = "CONCRETE" | "WOOD" | "GYPSUM";

export interface WifiFloorDto {
  id: string;
  name: string;
  level: number;
  heightM: number;
  material: WifiFloorMaterial;
  floorplanData?: string | null;
}

export interface WifiWallDto {
  id: string;
  floorId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: WifiWallMaterial;
}

/** Satu radio (satu band) pada access point. */
export interface WifiRadioDto {
  id: string;
  band: WifiBand;
  channel: number;
  channelWidth: number;
  txPowerDbm: number;
  antennaGainDbi: number;
  antennaType: WifiAntennaType;
  azimuthDeg?: number | null;
  enabled: boolean;
}

export interface WifiApDto {
  id: string;
  floorId: string;
  name: string;
  ssid?: string | null;
  heightM: number;
  posX: number;
  posY: number;
  enabled: boolean;
  radios: WifiRadioDto[];
}

export interface WifiProjectDto {
  id: string;
  name: string;
  description?: string | null;
  widthM: number;
  heightM: number;
  scalePxPerM: number;
  bgColor: string;
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

/** Kerugian slab lantai (dB per lantai yang ditembus). */
export const FLOOR_MATERIAL_LOSS: Record<WifiFloorMaterial, number> = {
  CONCRETE: 20,
  WOOD: 12,
  GYPSUM: 8,
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

/** Gain efektif antena radio ke arah titik (dB). Directional: cos² terhadap azimuth, ±60°, falloff di luar. */
export function antennaGain(radio: WifiRadioDto, dx: number, dy: number): number {
  if (radio.antennaType === "OMNIDIRECTIONAL") return radio.antennaGainDbi;
  const az = ((radio.azimuthDeg ?? 0) % 360) * (Math.PI / 180);
  const theta = Math.atan2(dy, dx);
  const delta = normDeg(((theta - az) * 180) / Math.PI) * (Math.PI / 180);
  const deg = Math.abs((delta * 180) / Math.PI);
  if (deg <= 60) {
    const cos2 = Math.cos(delta) ** 2;
    return radio.antennaGainDbi + 10 * Math.log10(Math.max(cos2, 1e-6));
  }
  return radio.antennaGainDbi - 15;
}

/** Tinggi dasar (z, meter) lantai = jumlah tinggi semua lantai di bawahnya. */
export function floorBaseZ(floors: WifiFloorDto[], floor: WifiFloorDto): number {
  return floors.filter((f) => f.level < floor.level).reduce((s, f) => s + f.heightM, 0);
}

/** Redaman total slab yang ditembus antara dua lantai (0 bila sama). Slab milik lantai bawah. */
export function floorLossBetween(floors: WifiFloorDto[], a: WifiFloorDto, b: WifiFloorDto): number {
  if (a.id === b.id) return 0;
  const lo = Math.min(a.level, b.level);
  const hi = Math.max(a.level, b.level);
  let loss = 0;
  for (const f of floors) {
    if (f.level >= lo && f.level < hi) loss += FLOOR_MATERIAL_LOSS[f.material];
  }
  return loss;
}

function floorById(floors: WifiFloorDto[], id: string): WifiFloorDto | null {
  return floors.find((f) => f.id === id) ?? null;
}

/** RSSI di titik (x,y) lantai target dari satu radio AP, tanpa interferensi. */
export function computeRssi(
  ap: WifiApDto,
  radio: WifiRadioDto,
  floors: WifiFloorDto[],
  walls: WifiWallDto[],
  targetFloor: WifiFloorDto,
  x: number,
  y: number,
  n: number,
): number {
  const apFloor = floorById(floors, ap.floorId) ?? targetFloor;
  const dx = x - ap.posX;
  const dy = y - ap.posY;
  const dz = (floorBaseZ(floors, targetFloor) + targetFloor.heightM / 2) - (floorBaseZ(floors, apFloor) + ap.heightM);
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1) d = 1;
  const pl0 = BAND_PL0[radio.band];
  let wallLoss = 0;
  if (apFloor.id === targetFloor.id) {
    for (const w of walls) {
      if (w.floorId !== targetFloor.id) continue;
      if (segIntersect(ap.posX, ap.posY, x, y, w.x1, w.y1, w.x2, w.y2)) wallLoss += MATERIAL_LOSS[w.material];
    }
  }
  const floorLoss = floorLossBetween(floors, apFloor, targetFloor);
  const pl = pl0 + 10 * n * Math.log10(d) + wallLoss + floorLoss;
  return radio.txPowerDbm + antennaGain(radio, dx, dy) - pl;
}

/**
 * Faktor interferensi antar radio (0 = tidak mengganggu, 1 = co-channel).
 * 2.4G: beda 1 ≈ 0.3, beda 2 ≈ 0.6, beda ≥3 ≈ 0; 5G/6G: beda 1 ≈ 0.7, sisanya 0.
 * Beda band = 0 (tidak saling mengganggu).
 */
export function adjacentFactor(r1: WifiRadioDto, r2: WifiRadioDto): number {
  if (r1.band !== r2.band) return 0;
  const d = Math.abs(r1.channel - r2.channel);
  if (d === 0) return 1;
  if (r1.band === "BAND_2_4") {
    if (d === 1) return 0.3;
    if (d === 2) return 0.6;
    return 0;
  }
  if (d === 1) return 0.7;
  return 0;
}

/** Semua radio aktif dari daftar AP, opsional difilter per band. */
export function activeRadios(aps: WifiApDto[], onlyBand?: WifiBand | null): { ap: WifiApDto; radio: WifiRadioDto }[] {
  const out: { ap: WifiApDto; radio: WifiRadioDto }[] = [];
  for (const ap of aps) {
    if (!ap.enabled) continue;
    for (const radio of ap.radios) {
      if (!radio.enabled) continue;
      if (onlyBand && radio.band !== onlyBand) continue;
      out.push({ ap, radio });
    }
  }
  return out;
}

export interface SimResult {
  rssi: Float32Array; // dBm terbaik per sel (-Infinity bila tidak ada radio aktif)
  sinr: Float32Array; // dB per sel (-Infinity bila tidak ada radio aktif)
  signalCoveragePct: number; // % sel dengan RSSI ≥ deadZoneDbm
  sinrCoveragePct: number; // % sel dengan SINR ≥ 15 dB
  deadZonePct: number; // % sel dead zone (RSSI < deadZoneDbm)
  totalEnabled: number; // jumlah radio aktif (sesuai filter band)
}

/** Hitung grid RSSI + SINR untuk SATU lantai. cols×rows = jumlah sel. */
export function computeGrid(
  proj: WifiProjectDto,
  floors: WifiFloorDto[],
  aps: WifiApDto[],
  walls: WifiWallDto[],
  cols: number,
  rows: number,
  targetFloor: WifiFloorDto,
  onlyBand?: WifiBand | null,
): SimResult {
  const n = cols * rows;
  const rssi = new Float32Array(n);
  const sinr = new Float32Array(n);
  const radios = activeRadios(aps, onlyBand);
  const cellW = proj.widthM / cols;
  const cellH = proj.heightM / rows;
  let signalOk = 0;
  let sinrOk = 0;

  for (let i = 0; i < n; i++) {
    const cx = i % cols;
    const cy = (i / cols) | 0;
    const x = (cx + 0.5) * cellW;
    const y = (cy + 0.5) * cellH;

    if (radios.length === 0) {
      rssi[i] = -Infinity;
      sinr[i] = -Infinity;
      continue;
    }

    let best = -Infinity;
    let bestIdx = -1;
    for (let k = 0; k < radios.length; k++) {
      const r = computeRssi(radios[k].ap, radios[k].radio, floors, walls, targetFloor, x, y, proj.pathLossExponent);
      if (r > best) {
        best = r;
        bestIdx = k;
      }
    }
    rssi[i] = best;

    if (bestIdx >= 0) {
      const sLin = Math.pow(10, best / 10);
      let iLin = 0;
      for (let k = 0; k < radios.length; k++) {
        if (k === bestIdx) continue;
        const f = adjacentFactor(radios[bestIdx].radio, radios[k].radio);
        if (f <= 0) continue;
        const r = computeRssi(radios[k].ap, radios[k].radio, floors, walls, targetFloor, x, y, proj.pathLossExponent);
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
  return {
    rssi,
    sinr,
    signalCoveragePct: radios.length === 0 ? 0 : (signalOk / total) * 100,
    sinrCoveragePct: radios.length === 0 ? 0 : (sinrOk / total) * 100,
    deadZonePct: radios.length === 0 ? 100 : ((total - signalOk) / total) * 100,
    totalEnabled: radios.length,
  };
}

export interface PointInfo {
  x: number;
  y: number;
  floor: WifiFloorDto;
  bestRssi: number | null; // sinyal terbaik (dBm)
  bestAp: WifiApDto | null; // AP yang memberi sinyal terbaik
  bestRadio: WifiRadioDto | null; // radio (band/channel) yang memberi sinyal terbaik
  sinrDb: number | null;
  isDead: boolean; // RSSI < ambang dead zone
  coverageOk: boolean; // tercakup (bukan dead zone) && SINR ≥ 15
  interferers: { ap: WifiApDto; radio: WifiRadioDto; rssi: number; factor: number }[]; // radio lain yang mengganggu
}

/** Evaluasi satu titik denah — simulasi user berdiri di lantai itu. */
export function evaluatePoint(
  proj: WifiProjectDto,
  floors: WifiFloorDto[],
  aps: WifiApDto[],
  walls: WifiWallDto[],
  x: number,
  y: number,
  targetFloor: WifiFloorDto,
  onlyBand?: WifiBand | null,
): PointInfo {
  const radios = activeRadios(aps, onlyBand);
  if (radios.length === 0) {
    return { x, y, floor: targetFloor, bestRssi: null, bestAp: null, bestRadio: null, sinrDb: null, isDead: true, coverageOk: false, interferers: [] };
  }
  let best = -Infinity;
  let bestIdx = -1;
  const rssis: { ap: WifiApDto; radio: WifiRadioDto; rssi: number }[] = [];
  for (const { ap, radio } of radios) {
    const r = computeRssi(ap, radio, floors, walls, targetFloor, x, y, proj.pathLossExponent);
    rssis.push({ ap, radio, rssi: r });
    if (r > best) {
      best = r;
      bestIdx = rssis.length - 1;
    }
  }
  const bestAp = rssis[bestIdx]?.ap ?? null;
  const bestRadio = rssis[bestIdx]?.radio ?? null;
  const sLin = Math.pow(10, best / 10);
  let iLin = 0;
  const interferers: { ap: WifiApDto; radio: WifiRadioDto; rssi: number; factor: number }[] = [];
  for (const { ap, radio, rssi } of rssis) {
    if (radio.id === bestRadio?.id) continue;
    const f = adjacentFactor(bestRadio!, radio);
    if (f <= 0) continue;
    iLin += f * Math.pow(10, rssi / 10);
    interferers.push({ ap, radio, rssi, factor: f });
  }
  const noiseLin = Math.pow(10, NOISE_FLOOR_DBM / 10);
  const sinrDb = 10 * Math.log10(sLin / (noiseLin + iLin));
  const isDead = best < proj.deadZoneDbm;
  const coverageOk = !isDead && sinrDb >= 15;
  return { x, y, floor: targetFloor, bestRssi: best, bestAp, bestRadio, sinrDb, isDead, coverageOk, interferers };
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