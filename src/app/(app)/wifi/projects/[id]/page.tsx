"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import {
  computeGrid,
  evaluatePoint,
  activeRadios,
  floorBaseZ,
  CHANNELS_BY_BAND,
  CHANNEL_WIDTHS,
  MATERIAL_LOSS,
  FLOOR_MATERIAL_LOSS,
  bandLabel,
  rssiColor,
  sinrColor,
  type WifiWallDto,
  type WifiApDto,
  type WifiRadioDto,
  type WifiFloorDto,
  type WifiFloorMaterial,
  type WifiProjectDto,
  type WifiBand,
  type WifiAntennaType,
  type WifiWallMaterial,
  type SimResult,
  type PointInfo,
} from "@/lib/wifi-engine";

type Tool = "select" | "wall" | "ap" | "measure" | "status" | "delete";
type Mode = "signal" | "sinr" | "dead" | "coverage";
type WallMaterialKey = "DRYWALL" | "WOOD" | "GLASS" | "BRICK" | "CONCRETE";

type Preset = { id: string; brand: string; model: string; band: WifiBand; txPowerDbm: number; antennaGainDbi: number; antennaType: WifiAntennaType };

const TOOLS: { id: Tool; icon: string }[] = [
  { id: "select", icon: "🖱️" },
  { id: "wall", icon: "🧱" },
  { id: "ap", icon: "📶" },
  { id: "measure", icon: "📐" },
  { id: "status", icon: "🧍" },
  { id: "delete", icon: "🗑️" },
];

const MATERIALS: { id: WallMaterialKey; icon: string }[] = [
  { id: "DRYWALL", icon: "🧱" },
  { id: "WOOD", icon: "🪵" },
  { id: "GLASS", icon: "🪟" },
  { id: "BRICK", icon: "🧱" },
  { id: "CONCRETE", icon: "⬛" },
];

const BAND_COLOR: Record<WifiBand, string> = { BAND_2_4: "#22c55e", BAND_5: "#3b82f6", BAND_6: "#a855f7" };
const MATERIAL_DRAW: Record<WallMaterialKey, string> = { DRYWALL: "#cbd5e1", WOOD: "#b45309", GLASS: "#38bdf8", BRICK: "#dc2626", CONCRETE: "#64748b" };

export default function WifiEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLang();
  const id = params.id;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);

  const [project, setProject] = useState<WifiProjectDto | null>(null);
  const [floors, setFloors] = useState<WifiFloorDto[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const [walls, setWalls] = useState<WifiWallDto[]>([]);
  const [aps, setAps] = useState<WifiApDto[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [wallMaterial, setWallMaterial] = useState<WallMaterialKey>("DRYWALL");
  const [mode, setMode] = useState<Mode>("signal");
  const [bandFilter, setBandFilter] = useState<"ALL" | WifiBand>("ALL");
  const [selectedApId, setSelectedApId] = useState<string | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);

  const [view, setView] = useState({ x: 40, y: 20, scale: 1 });
  const [view3d, setView3d] = useState(false);
  const [iso, setIso] = useState({ rot: 0, zoom: 1, ox: 0, oy: 0 }); // rotasi 90°, zoom, pan 3D
  const [isoOpacity, setIsoOpacity] = useState(60); // transparansi slab lantai atas di 3D (0 = lantai bawah disembunyikan)
  const [otherApOpacity, setOtherApOpacity] = useState(25); // transparansi AP lantai lain di 2D (0 = disembunyikan)
  const [floorPanelId, setFloorPanelId] = useState<string | null>(null);
  const [measure, setMeasure] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [draftWall, setDraftWall] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [pointInfo, setPointInfo] = useState<{ x: number; y: number; info: PointInfo } | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simsByFloor, setSimsByFloor] = useState<Record<string, SimResult>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showPanel, setShowPanel] = useState(true);

  // refs agar draw loop & event handler tidak stale-closure
  const stateRef = useRef({ project, floors, activeFloorId, walls, aps, view, view3d, iso, isoOpacity, otherApOpacity, tool, mode, bandFilter, selectedApId, selectedWallId, measure, draftWall, wallMaterial, sim, simsByFloor, pointInfo });
  stateRef.current = { project, floors, activeFloorId, walls, aps, view, view3d, iso, isoOpacity, otherApOpacity, tool, mode, bandFilter, selectedApId, selectedWallId, measure, draftWall, wallMaterial, sim, simsByFloor, pointInfo };

  const dragRef = useRef<{ kind: "pan" | "ap" | "wall" | "measure" | "iso"; id?: string; sx: number; sy: number; startX: number; startY: number; startX2?: number; startY2?: number; toolAtStart?: string; startSnap?: { floors: WifiFloorDto[]; walls: WifiWallDto[]; aps: WifiApDto[] } } | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const wallStartRef = useRef<{ x: number; y: number } | null>(null);
  const measureStartRef = useRef<{ x: number; y: number } | null>(null);
  const wallFinalizedRef = useRef(false);

  // finalisasi gambar dinding — dipanggil dari mouseup canvas & window (agar
  // tetap jadi walau mouse dilepas di luar canvas), dijaga anti-dobel.
  const finalizeWallRef = useRef<() => void>(() => {});
  finalizeWallRef.current = () => {
    const s = stateRef.current;
    if (s.tool !== "wall" || !s.draftWall || wallFinalizedRef.current) return;
    wallFinalizedRef.current = true;
    const d = s.draftWall;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.2) createWall(d.x1, d.y1, d.x2, d.y2, s.wallMaterial);
    setDraftWall(null);
    wallStartRef.current = null;
  };

  useEffect(() => {
    const onWinUp = () => finalizeWallRef.current();
    window.addEventListener("mouseup", onWinUp);
    return () => window.removeEventListener("mouseup", onWinUp);
  }, []);
  const floorplanImgRef = useRef<HTMLImageElement | null>(null);
  const carpetCacheRef = useRef<Record<string, HTMLCanvasElement>>({});
  const historyRef = useRef<{ floors: WifiFloorDto[]; walls: WifiWallDto[]; aps: WifiApDto[] }[]>([]);

  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? floors[0] ?? null;

  useEffect(() => {
    const fp = activeFloor?.floorplanData;
    if (fp) {
      const img = new Image();
      img.src = fp;
      img.onload = () => {
        floorplanImgRef.current = img;
      };
    } else {
      floorplanImgRef.current = null;
    }
  }, [activeFloor?.floorplanData]);

  /* ---------- hitung transform ---------- */
  const toScreen = useCallback((x: number, y: number): [number, number] => {
    const s = stateRef.current;
    if (!s.project) return [0, 0];
    const k = s.project.scalePxPerM * s.view.scale;
    return [x * k + s.view.x, y * k + s.view.y];
  }, []);

  const toWorld = useCallback((sx: number, sy: number): [number, number] => {
    const s = stateRef.current;
    if (!s.project) return [0, 0];
    const k = s.project.scalePxPerM * s.view.scale;
    return [(sx - s.view.x) / k, (sy - s.view.y) / k];
  }, []);

  /* ---------- sim ---------- */
  const recomputeSim = useCallback(() => {
    const s = stateRef.current;
    const p = s.project;
    if (!p || s.floors.length === 0) return;
    const onlyBand = s.bandFilter === "ALL" ? null : s.bandFilter;
    const cellWorld = Math.max(0.25, Math.max(p.widthM, p.heightM) / 180);
    const cols = Math.max(4, Math.ceil(p.widthM / cellWorld));
    const rows = Math.max(4, Math.ceil(p.heightM / cellWorld));
    const target = s.floors.find((f) => f.id === s.activeFloorId) ?? s.floors[0];
    setSim(computeGrid(p, s.floors, s.aps, s.walls, cols, rows, target, onlyBand));
    const byFloor: Record<string, SimResult> = {};
    for (const f of s.floors) byFloor[f.id] = computeGrid(p, s.floors, s.aps, s.walls, cols, rows, f, onlyBand);
    setSimsByFloor(byFloor);
  }, []);

  const debounceRef = useRef<number | null>(null);
  const scheduleSim = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(recomputeSim, 150);
  }, [recomputeSim]);

  /* ---------- muat data ---------- */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wifi/projects/${id}`);
      const d = await res.json();
      if (!d.ok) {
        setErr(d.message ?? "Gagal memuat proyek");
        return;
      }
      setProject(d.data);
      const fl = (d.data.floors ?? []).sort((a: WifiFloorDto, b: WifiFloorDto) => a.level - b.level);
      setFloors(fl);
      setActiveFloorId((cur) => (cur && fl.some((f: WifiFloorDto) => f.id === cur) ? cur : (fl[0]?.id ?? null)));
      setWalls(d.data.walls ?? []);
      setAps(d.data.accessPoints ?? []);
      setView({ x: 40, y: 20, scale: 1 });
      setSim(null);
      setSimsByFloor({});
      setPointInfo(null);
    } catch {
      setErr("Gagal memuat proyek");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/wifi/presets")
      .then((r) => r.json())
      .then((d) => d.ok && setPresets(d.data ?? []))
      .catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!project) return;
    const k = project.scalePxPerM;
    const cw = canvasRef.current?.clientWidth ?? 800;
    const ch = canvasRef.current?.clientHeight ?? 500;
    const scale = Math.min(cw / (project.widthM * k + 80), ch / (project.heightM * k + 80));
    setView((v) => ({ ...v, scale: Math.min(v.scale, scale) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (project && floors.length > 0) scheduleSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.widthM, project?.heightM, project?.pathLossExponent, project?.deadZoneDbm, walls, aps, bandFilter, floors, activeFloorId]);

  /* ---------- hit-test ---------- */
  function hitTest(sx: number, sy: number): { ap?: WifiApDto; wall?: WifiWallDto } {
    const s = stateRef.current;
    for (let i = s.aps.length - 1; i >= 0; i--) {
      const ap = s.aps[i];
      if (ap.floorId !== s.activeFloorId) continue;
      const [px, py] = toScreen(ap.posX, ap.posY);
      if (Math.hypot(px - sx, py - sy) <= 14) return { ap };
    }
    for (let i = s.walls.length - 1; i >= 0; i--) {
      const w = s.walls[i];
      if (w.floorId !== s.activeFloorId) continue;
      const [ax, ay] = toScreen(w.x1, w.y1);
      const [bx, by] = toScreen(w.x2, w.y2);
      const d = distToSeg(sx, sy, ax, ay, bx, by);
      if (d <= 8) return { wall: w };
    }
    return {};
  }

  /* ---------- undo ---------- */
  function pushHistory() {
    const s = stateRef.current;
    historyRef.current.push({ floors: s.floors, walls: s.walls, aps: s.aps });
    if (historyRef.current.length > 40) historyRef.current.shift();
  }

  async function undo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    const payload = {
      widthM: stateRef.current.project?.widthM,
      heightM: stateRef.current.project?.heightM,
      floors: prev.floors.map((f) => ({ name: f.name, level: f.level, heightM: f.heightM, material: f.material, floorplanData: f.floorplanData })),
      walls: prev.walls.map((w) => ({
        floorIndex: prev.floors.findIndex((f) => f.id === w.floorId),
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
        material: w.material,
      })),
      accessPoints: prev.aps.map((a) => ({
        floorIndex: prev.floors.findIndex((f) => f.id === a.floorId),
        name: a.name,
        ssid: a.ssid,
        heightM: a.heightM,
        posX: a.posX,
        posY: a.posY,
        enabled: a.enabled,
        radios: a.radios.map((r) => ({
          band: r.band,
          channel: r.channel,
          channelWidth: r.channelWidth,
          txPowerDbm: r.txPowerDbm,
          antennaGainDbi: r.antennaGainDbi,
          antennaType: r.antennaType,
          azimuthDeg: r.azimuthDeg,
          enabled: r.enabled,
        })),
      })),
    };
    setSaving(true);
    try {
      const res = await fetch(`/api/wifi/projects/${id}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
        historyRef.current.push(prev);
        return;
      }
      await load(); // muat ulang dengan id baru dari server
      setSelectedApId(null);
      setSelectedWallId(null);
      setPointInfo(null);
    } finally {
      setSaving(false);
    }
  }

  /* ---------- aksi API ---------- */
  async function createWall(x1: number, y1: number, x2: number, y2: number, material: WallMaterialKey) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/walls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ floorId: stateRef.current.activeFloorId ?? stateRef.current.floors[0]?.id, x1, y1, x2, y2, material }),
    });
    const d = await res.json();
    if (d.ok && d.data) setWalls((w) => [...w, d.data]);
    else setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
  }

  async function createAp(x: number, y: number) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/access-points`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "AP", floorId: stateRef.current.activeFloorId ?? stateRef.current.floors[0]?.id, posX: x, posY: y }),
    });
    const d = await res.json();
    if (d.ok && d.data) {
      setAps((a) => [...a, d.data]);
      setSelectedApId(d.data.id);
    } else setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
  }

  async function removeAp(apId: string) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/access-points/${apId}`, { method: "DELETE" });
    const d = await res.json();
    if (d.ok) {
      setAps((a) => a.filter((x) => x.id !== apId));
      setSelectedApId((s) => (s === apId ? null : s));
    } else setMsg({ text: d.message ?? t("wif.deleteErr"), ok: false });
  }

  async function removeWall(wallId: string) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/walls/${wallId}`, { method: "DELETE" });
    const d = await res.json();
    if (d.ok) {
      setWalls((w) => w.filter((x) => x.id !== wallId));
      setSelectedWallId((s) => (s === wallId ? null : s));
    } else setMsg({ text: d.message ?? t("wif.deleteErr"), ok: false });
  }

  /* ---------- lantai ---------- */
  async function addFloor() {
    pushHistory();
    const next = stateRef.current.floors.length + 1;
    const res = await fetch(`/api/wifi/projects/${id}/floors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Lantai ${next}`, level: next, heightM: 3, material: "CONCRETE" }),
    });
    const d = await res.json();
    if (d.ok && d.data) {
      setFloors((list) => [...list, d.data]);
      setActiveFloorId(d.data.id);
      setFloorPanelId(d.data.id);
    } else setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
  }

  function updateFloorLocal(floorId: string, patch: Partial<WifiFloorDto>) {
    setFloors((list) => list.map((f) => (f.id === floorId ? { ...f, ...patch } : f)));
    fetch(`/api/wifi/projects/${id}/floors/${floorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
      })
      .catch(() => setMsg({ text: t("wif.saveErr"), ok: false }));
  }

  async function deleteFloor(floorId: string) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/floors/${floorId}`, { method: "DELETE" });
    const d = await res.json();
    if (d.ok) {
      setFloors((list) => {
        const rest = list.filter((f) => f.id !== floorId);
        setActiveFloorId((cur) => (cur === floorId ? (rest[0]?.id ?? null) : cur));
        return rest;
      });
      setFloorPanelId((p) => (p === floorId ? null : p));
      setSelectedApId((s) => {
        const ap = aps.find((a) => a.id === s);
        return ap?.floorId === floorId ? null : s;
      });
      setSelectedWallId((s) => {
        const w = walls.find((x) => x.id === s);
        return w?.floorId === floorId ? null : s;
      });
    } else setMsg({ text: d.message ?? t("wif.deleteErr"), ok: false });
  }

  const patchApRef = useRef<{ timer: number | null; pending: Partial<WifiApDto> }>({ timer: null, pending: {} });
  function updateApLocal(apId: string, patch: Partial<WifiApDto>) {
    setAps((list) => list.map((a) => (a.id === apId ? { ...a, ...patch } : a)));
    patchApRef.current.pending = { ...patchApRef.current.pending, ...patch };
    if (patchApRef.current.timer) window.clearTimeout(patchApRef.current.timer);
    patchApRef.current.timer = window.setTimeout(async () => {
      const pending = patchApRef.current.pending;
      patchApRef.current.pending = {};
      if (Object.keys(pending).length === 0) return;
      try {
        const res = await fetch(`/api/wifi/projects/${id}/access-points/${apId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending),
        });
        const d = await res.json();
        if (!res.ok || d.ok === false) setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
      } catch {
        setMsg({ text: t("wif.saveErr"), ok: false });
      }
    }, 400);
  }

  const patchRadioRef = useRef<{ timer: number | null; pending: Partial<WifiRadioDto> }>({ timer: null, pending: {} });
  function updateRadioLocal(apId: string, radioId: string, patch: Partial<WifiRadioDto>) {
    setAps((list) =>
      list.map((a) => (a.id === apId ? { ...a, radios: a.radios.map((r) => (r.id === radioId ? { ...r, ...patch } : r)) } : a)),
    );
    patchRadioRef.current.pending = { ...patchRadioRef.current.pending, ...patch };
    if (patchRadioRef.current.timer) window.clearTimeout(patchRadioRef.current.timer);
    patchRadioRef.current.timer = window.setTimeout(async () => {
      const pending = patchRadioRef.current.pending;
      patchRadioRef.current.pending = {};
      if (Object.keys(pending).length === 0) return;
      try {
        const res = await fetch(`/api/wifi/projects/${id}/access-points/${apId}/radios/${radioId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending),
        });
        const d = await res.json();
        if (!res.ok || d.ok === false) setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
      } catch {
        setMsg({ text: t("wif.saveErr"), ok: false });
      }
    }, 400);
  }

  async function addRadio(apId: string, band: WifiBand) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/access-points/${apId}/radios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ band, channel: CHANNELS_BY_BAND[band][0] }),
    });
    const d = await res.json();
    if (d.ok && d.data) {
      setAps((list) => list.map((a) => (a.id === apId ? { ...a, radios: [...a.radios, d.data] } : a)));
    } else setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
  }

  async function removeRadio(apId: string, radioId: string) {
    pushHistory();
    const res = await fetch(`/api/wifi/projects/${id}/access-points/${apId}/radios/${radioId}`, { method: "DELETE" });
    const d = await res.json();
    if (d.ok) {
      setAps((list) => list.map((a) => (a.id === apId ? { ...a, radios: a.radios.filter((r) => r.id !== radioId) } : a)));
    } else setMsg({ text: d.message ?? t("wif.deleteErr"), ok: false });
  }

  async function applyPreset(apId: string, preset: Preset) {
    const ap = aps.find((a) => a.id === apId);
    const existing = ap?.radios.find((r) => r.band === preset.band);
    if (existing) {
      updateRadioLocal(apId, existing.id, {
        txPowerDbm: preset.txPowerDbm,
        antennaGainDbi: preset.antennaGainDbi,
        antennaType: preset.antennaType,
      });
    } else {
      pushHistory();
      const res = await fetch(`/api/wifi/projects/${id}/access-points/${apId}/radios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          band: preset.band,
          channel: CHANNELS_BY_BAND[preset.band][0],
          txPowerDbm: preset.txPowerDbm,
          antennaGainDbi: preset.antennaGainDbi,
          antennaType: preset.antennaType,
        }),
      });
      const d = await res.json();
      if (d.ok && d.data) {
        setAps((list) => list.map((a) => (a.id === apId ? { ...a, radios: [...a.radios, d.data] } : a)));
      } else setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
    }
  }

  const selectedAp = aps.find((a) => a.id === selectedApId) ?? null;

  /* ---------- rendering ---------- */
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      render();
    };
    const loop = () => {
      if (raf) return;
      raf = requestAnimationFrame(draw);
    };
    loop();
    const iv = setInterval(loop, 40);
    return () => {
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (s.view3d) {
      render3D();
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const p = s.project;
    if (!p) return;
    const k = p.scalePxPerM * s.view.scale;
    const x0 = s.view.x;
    const y0 = s.view.y;
    const wPx = p.widthM * k;
    const hPx = p.heightM * k;

    // latar denah
    ctx.fillStyle = p.bgColor;
    ctx.fillRect(x0 - 40, y0 - 40, wPx + 80, hPx + 80);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, y0, wPx, hPx);
    ctx.strokeStyle = "rgba(100,116,139,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, wPx, hPx);

    // denah (gambar)
    const fpImg = floorplanImgRef.current;
    if (fpImg && fpImg.complete && fpImg.naturalWidth > 0) ctx.drawImage(fpImg, x0, y0, wPx, hPx);

    // grid meter
    ctx.strokeStyle = "rgba(100,116,139,0.12)";
    ctx.lineWidth = 1;
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "rgba(100,116,139,0.7)";
    const stepM = p.scalePxPerM >= 15 ? 1 : 2;
    for (let gx = 0; gx <= p.widthM; gx += stepM) {
      const gsx = x0 + gx * k;
      ctx.beginPath();
      ctx.moveTo(gsx, y0);
      ctx.lineTo(gsx, y0 + hPx);
      ctx.stroke();
      ctx.fillText(`${gx}m`, gsx + 2, y0 + hPx + 14);
    }
    for (let gy = 0; gy <= p.heightM; gy += stepM) {
      const gsy = y0 + gy * k;
      ctx.beginPath();
      ctx.moveTo(x0, gsy);
      ctx.lineTo(x0 + wPx, gsy);
      ctx.stroke();
      ctx.fillText(`${gy}m`, x0 - 22, gsy + 3);
    }

    // heatmap
    if (s.sim && s.project && activeRadios(s.aps, s.bandFilter === "ALL" ? null : s.bandFilter).length > 0) {
      const cellWorld = Math.max(0.25, Math.max(p.widthM, p.heightM) / 180);
      const cols = Math.max(4, Math.ceil(p.widthM / cellWorld));
      const rows = Math.max(4, Math.ceil(p.heightM / cellWorld));
      let gridCanvas = gridRef.current;
      if (!gridCanvas || gridCanvas.width !== cols || gridCanvas.height !== rows) {
        gridCanvas = document.createElement("canvas");
        gridCanvas.width = cols;
        gridCanvas.height = rows;
        gridRef.current = gridCanvas;
      }
      const gctx = gridCanvas.getContext("2d");
      if (gctx) {
        const img = gctx.createImageData(cols, rows);
        const data = img.data;
        for (let i = 0; i < cols * rows; i++) {
          const r = s.mode === "sinr" ? s.sim.sinr[i] : s.sim.rssi[i];
          let col: string | null = null;
          if (s.mode === "signal") col = rssiColor(r);
          else if (s.mode === "sinr") col = sinrColor(r);
          else if (s.mode === "dead") col = r < p.deadZoneDbm ? "rgba(239,68,68,0.6)" : null;
          else col = r >= p.deadZoneDbm ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.45)";
          if (col) {
            const m = col.match(/rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/);
            if (m) {
              data[i * 4] = Number(m[1]);
              data[i * 4 + 1] = Number(m[2]);
              data[i * 4 + 2] = Number(m[3]);
              data[i * 4 + 3] = Math.round((m[4] ? Number(m[4]) : 0.55) * 255);
            }
          } else {
            data[i * 4 + 3] = 0;
          }
        }
        gctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(gridCanvas, x0, y0, wPx, hPx);
      }
    }

    // dinding
    for (const w of s.walls) {
      if (w.floorId !== s.activeFloorId) continue;
      const [ax, ay] = toScreen(w.x1, w.y1);
      const [bx, by] = toScreen(w.x2, w.y2);
      ctx.strokeStyle = MATERIAL_DRAW[w.material];
      ctx.lineWidth = w.id === s.selectedWallId ? 6 : 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (w.id === s.selectedWallId) {
        ctx.strokeStyle = "#f59e0b";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // draft wall
    if (s.draftWall) {
      const [ax, ay] = toScreen(s.draftWall.x1, s.draftWall.y1);
      const [bx, by] = toScreen(s.draftWall.x2, s.draftWall.y2);
      ctx.strokeStyle = MATERIAL_DRAW[s.wallMaterial];
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // AP
    for (const ap of s.aps) {
      if (ap.floorId !== s.activeFloorId && s.otherApOpacity <= 0) continue; // AP lantai lain disembunyikan
      const [px, py] = toScreen(ap.posX, ap.posY);
      const isSel = ap.id === s.selectedApId;
      ctx.globalAlpha = ap.floorId === s.activeFloorId ? 1 : Math.min(1, Math.max(0, s.otherApOpacity / 100));
      const bands = [...new Set(ap.radios.map((r) => r.band))];
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = isSel ? "#f59e0b" : "#0f172a";
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.stroke();
      // dot per band radio
      const dots = bands.filter((b) => ap.radios.some((r) => r.band === b && r.enabled));
      if (dots.length > 0) {
        const step = (Math.PI * 2) / dots.length;
        dots.forEach((b, i) => {
          const a = -Math.PI / 2 + i * step;
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * 6, py + Math.sin(a) * 6, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = BAND_COLOR[b];
          ctx.fill();
        });
      }
      if (ap.radios.some((r) => r.antennaType !== "OMNIDIRECTIONAL")) {
        const r = ap.radios.find((x) => x.antennaType !== "OMNIDIRECTIONAL")!;
        const az = ((r.azimuthDeg ?? 0) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(az) * 18, py + Math.sin(az) * 18);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (ap.enabled === false) {
        ctx.beginPath();
        ctx.moveTo(px - 6, py - 6);
        ctx.lineTo(px + 6, py + 6);
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = "#0f172a";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ap.name, px, py - 16);
      const chText = ap.radios.map((r) => `ch${r.channel}`).join(" ");
      ctx.fillStyle = "rgba(15,23,42,0.7)";
      ctx.fillText(chText, px, py + 22);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }

    // pengukur jarak
    if (s.measure) {
      const [ax, ay] = toScreen(s.measure.x1, s.measure.y1);
      const [bx, by] = toScreen(s.measure.x2, s.measure.y2);
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      const dx = s.measure.x2 - s.measure.x1;
      const dy = s.measure.y2 - s.measure.y1;
      const dist = Math.hypot(dx, dy);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      ctx.fillStyle = "#0369a1";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(`${dist.toFixed(2)} m`, mx + 8, my - 6);
    }

    // marker simulasi user (tool status)
    if (s.pointInfo) {
      const [px, py] = toScreen(s.pointInfo.x, s.pointInfo.y);
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🧍", px, py + 4);
      ctx.textAlign = "left";
    }
  }

  /* ---------- render 3D isometrik ---------- */
  const FLOOR_DRAW: Record<WifiFloorMaterial, string> = { CONCRETE: "#94a3b8", WOOD: "#d9a066", GYPSUM: "#e2e8f0" };

  function carpetCanvas(floor: WifiFloorDto, p: WifiProjectDto, mode: Mode, band: string, deadZone: number): HTMLCanvasElement | null {
    const key = `${floor.id}|${mode}|${band}|${deadZone}|${p.deadZoneDbm}`;
    const cached = carpetCacheRef.current[key];
    if (cached) return cached;
    const sim = stateRef.current.simsByFloor[floor.id];
    if (!sim) return null;
    const cellWorld = Math.max(0.25, Math.max(p.widthM, p.heightM) / 180);
    const cols = Math.max(4, Math.ceil(p.widthM / cellWorld));
    const rows = Math.max(4, Math.ceil(p.heightM / cellWorld));
    const cv = document.createElement("canvas");
    cv.width = cols;
    cv.height = rows;
    const gctx = cv.getContext("2d");
    if (!gctx) return null;
    const img = gctx.createImageData(cols, rows);
    const data = img.data;
    for (let i = 0; i < cols * rows; i++) {
      const r = mode === "sinr" ? sim.sinr[i] : sim.rssi[i];
      let col: string | null = null;
      if (mode === "signal") col = rssiColor(r);
      else if (mode === "sinr") col = sinrColor(r);
      else if (mode === "dead") col = r < p.deadZoneDbm ? "rgba(239,68,68,0.6)" : null;
      else col = r >= p.deadZoneDbm ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.45)";
      if (col) {
        const m = col.match(/rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/);
        if (m) {
          data[i * 4] = Number(m[1]);
          data[i * 4 + 1] = Number(m[2]);
          data[i * 4 + 2] = Number(m[3]);
          data[i * 4 + 3] = Math.round((m[4] ? Number(m[4]) : 0.55) * 255);
        }
      } else {
        data[i * 4 + 3] = 0;
      }
    }
    gctx.putImageData(img, 0, 0);
    carpetCacheRef.current = { ...carpetCacheRef.current, [key]: cv };
    return cv;
  }

  function render3D() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const p = s.project;
    if (!p || s.floors.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = p.bgColor;
    ctx.fillRect(0, 0, cw, ch);

    const rot = (s.iso.rot % 4) * (Math.PI / 2);
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const totalH = s.floors.reduce((a, f) => a + f.heightM, 0);
    const unit = Math.min(cw / ((p.widthM + p.heightM) * 1.15), ch / ((p.widthM + p.heightM) * 0.75 + totalH * 0.95)) * s.iso.zoom;
    const u = unit * 0.866;
    const v = unit * 0.5;
    const uz = unit * 0.85;
    const cx = cw / 2 + s.iso.ox;
    const cy = ch / 2 + s.iso.oy;

    const proj = (x: number, y: number, z: number): [number, number] => {
      const rx = x * cosR - y * sinR;
      const ry = x * sinR + y * cosR;
      return [cx + (rx - ry) * u, cy + (rx + ry) * v - z * uz];
    };

    // sisi-sisi yang menghadap kamera (normal +x/+y setelah rotasi)
    const faceVisible = (nx: number, ny: number) => nx * cosR - ny * sinR + (nx * sinR + ny * cosR) > 0;

    const slabThick = 0.25;
    const floors = [...s.floors].sort((a, b) => a.level - b.level);
    const op = Math.min(1, Math.max(0, s.isoOpacity / 100)); // 1 = slab atas tembus pandang
    const skipLower = op < 0.2; // lantai bawah disembunyikan penuh bila hampir opaque
    const topFloor = floors[floors.length - 1];

    for (const f of floors) {
      const isTop = f.id === topFloor?.id;
      if (skipLower && !isTop) continue;
      const base = floorBaseZ(floors, f);
      const matColor = FLOOR_DRAW[f.material];
      const topZ = base;

      // slab (bawah topZ — sisi + alas); slab lantai non-puncak mengikuti transparansi
      const zBot = base - slabThick;
      const slabSideAlpha = isTop ? 0.8 : 0.8 * (1 - op);
      const slabFaces: { pts: [number, number, number][]; fill: string }[] = [];
      if (faceVisible(1, 0)) slabFaces.push({ pts: [[p.widthM, 0, zBot], [p.widthM, p.heightM, zBot], [p.widthM, p.heightM, topZ], [p.widthM, 0, topZ]], fill: matColor });
      if (faceVisible(-1, 0)) slabFaces.push({ pts: [[0, 0, zBot], [0, p.heightM, zBot], [0, p.heightM, topZ], [0, 0, topZ]], fill: matColor });
      if (faceVisible(0, 1)) slabFaces.push({ pts: [[0, p.heightM, zBot], [p.widthM, p.heightM, zBot], [p.widthM, p.heightM, topZ], [0, p.heightM, topZ]], fill: matColor });
      if (faceVisible(0, -1)) slabFaces.push({ pts: [[0, 0, zBot], [p.widthM, 0, zBot], [p.widthM, 0, topZ], [0, 0, topZ]], fill: matColor });
      for (const face of slabFaces) {
        ctx.beginPath();
        const [a, b, c, dd] = face.pts.map(([wx, wy, wz]) => proj(wx, wy, wz));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(dd[0], dd[1]);
        ctx.closePath();
        ctx.fillStyle = face.fill;
        ctx.globalAlpha = slabSideAlpha;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // karpet heatmap (transform affine per lantai)
      const carpet = carpetCanvas(f, p, s.mode, s.bandFilter, p.deadZoneDbm);
      if (carpet) {
        const cols = carpet.width;
        const rows = carpet.height;
        const pxmX = p.widthM / cols;
        const pxmY = p.heightM / rows;
        const a = (u * cosR - u * sinR) * pxmX;
        const b = (v * cosR + v * sinR) * pxmX;
        const c = (-u * sinR - u * cosR) * pxmY;
        const dd = (-v * sinR + v * cosR) * pxmY;
        ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * dd, dpr * cx, dpr * (cy - topZ * uz));
        ctx.globalAlpha = 0.65;
        ctx.drawImage(carpet, 0, 0);
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // dinding (ekstrusi vertikal dari lantai)
      const wallTop = base + Math.min(1.6, f.heightM * 0.55);
      for (const w of s.walls) {
        if (w.floorId !== f.id) continue;
        ctx.beginPath();
        const a = proj(w.x1, w.y1, base);
        const b = proj(w.x2, w.y2, base);
        const c = proj(w.x2, w.y2, wallTop);
        const dd = proj(w.x1, w.y1, wallTop);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(dd[0], dd[1]);
        ctx.closePath();
        ctx.fillStyle = MATERIAL_DRAW[w.material];
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(15,23,42,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // AP
      for (const ap of s.aps) {
        if (ap.floorId !== f.id) continue;
        const [px, py] = proj(ap.posX, ap.posY, base + ap.heightM);
        ctx.globalAlpha = ap.enabled ? 1 : 0.3;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2;
        ctx.stroke();
        const dots = [...new Set(ap.radios.map((r) => r.band))].filter((b) => ap.radios.some((r) => r.band === b && r.enabled));
        if (dots.length > 0) {
          const step = (Math.PI * 2) / dots.length;
          dots.forEach((b, i) => {
            const ang = -Math.PI / 2 + i * step;
            ctx.beginPath();
            ctx.arc(px + Math.cos(ang) * 5, py + Math.sin(ang) * 5, 2.6, 0, Math.PI * 2);
            ctx.fillStyle = BAND_COLOR[b];
            ctx.fill();
          });
        }
        ctx.fillStyle = "#0f172a";
        ctx.font = "10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(ap.name, px, py - 13);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }

      // label lantai
      const [lx, ly] = proj(p.widthM / 2, p.heightM / 2, base + 0.1);
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.strokeText(`${f.name} · ${FLOOR_MATERIAL_LOSS[f.material]} dB`, lx, ly - 4);
      ctx.fillStyle = "#334155";
      ctx.fillText(`${f.name} · ${FLOOR_MATERIAL_LOSS[f.material]} dB`, lx, ly - 4);
      ctx.textAlign = "left";
    }

    // marker simulasi user di 3D
    if (s.pointInfo && s.pointInfo.info.floor) {
      const [mx, my] = proj(s.pointInfo.x, s.pointInfo.y, floorBaseZ(floors, s.pointInfo.info.floor) + 1.5);
      ctx.beginPath();
      ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🧍", mx, my + 4);
      ctx.textAlign = "left";
    }
  }

  /* ---------- interaksi ---------- */
  function canvasPos(e: React.MouseEvent): [number, number] {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onMouseDown(e: React.MouseEvent) {
    const [sx, sy] = canvasPos(e);
    const s = stateRef.current;
    if (s.view3d) {
      // 3D: seret = geser (pan) di semua tool; klik tanpa geser (status/select) = info titik
      dragRef.current = { kind: "iso", sx, sy, startX: s.iso.ox, startY: s.iso.oy, toolAtStart: s.tool };
      return;
    }
    if (e.button === 1) {
      dragRef.current = { kind: "pan", sx, sy, startX: s.view.x, startY: s.view.y };
      return;
    }
    if (s.tool === "select") {
      const hit = hitTest(sx, sy);
      if (hit.ap) {
        setSelectedApId(hit.ap.id);
        setSelectedWallId(null);
        dragRef.current = { kind: "ap", id: hit.ap.id, sx, sy, startX: hit.ap.posX, startY: hit.ap.posY, startSnap: { floors: s.floors, walls: s.walls, aps: s.aps } };
      } else if (hit.wall) {
        setSelectedWallId(hit.wall.id);
        setSelectedApId(null);
        dragRef.current = { kind: "wall", id: hit.wall.id, sx, sy, startX: hit.wall.x1, startY: hit.wall.y1, startX2: hit.wall.x2, startY2: hit.wall.y2, startSnap: { floors: s.floors, walls: s.walls, aps: s.aps } };
      } else {
        setSelectedApId(null);
        setSelectedWallId(null);
        dragRef.current = { kind: "pan", sx, sy, startX: s.view.x, startY: s.view.y };
      }
      return;
    }
    if (s.tool === "wall") {
      const [wx, wy] = toWorld(sx, sy);
      wallStartRef.current = { x: wx, y: wy };
      wallFinalizedRef.current = false;
      setDraftWall({ x1: wx, y1: wy, x2: wx, y2: wy });
      return;
    }
    if (s.tool === "ap") {
      const [wx, wy] = toWorld(sx, sy);
      createAp(wx, wy);
      return;
    }
    if (s.tool === "measure") {
      const [wx, wy] = toWorld(sx, sy);
      measureStartRef.current = { x: wx, y: wy };
      setMeasure({ x1: wx, y1: wy, x2: wx, y2: wy });
      dragRef.current = { kind: "measure", sx, sy, startX: wx, startY: wy };
      return;
    }
    if (s.tool === "status") {
      const [wx, wy] = toWorld(sx, sy);
      if (!s.project || !s.activeFloorId) return;
      const targetFloor = s.floors.find((f) => f.id === s.activeFloorId) ?? s.floors[0];
      const x = Math.min(Math.max(wx, 0), s.project.widthM);
      const y = Math.min(Math.max(wy, 0), s.project.heightM);
      const onlyBand = s.bandFilter === "ALL" ? null : s.bandFilter;
      setPointInfo({ x, y, info: evaluatePoint(s.project, s.floors, s.aps, s.walls, x, y, targetFloor, onlyBand) });
      return;
    }
    if (s.tool === "delete") {
      const hit = hitTest(sx, sy);
      if (hit.ap) removeAp(hit.ap.id);
      else if (hit.wall) removeWall(hit.wall.id);
      return;
    }
  }

  /** Klik di 3D: tentukan lantai (world z = dasar lantai) → info titik. */
  function pick3dPoint(sx: number, sy: number) {
    const s = stateRef.current;
    if (!s.project || s.floors.length === 0) return;
    const rot = (s.iso.rot % 4) * (Math.PI / 2);
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const totalH = s.floors.reduce((a, f) => a + f.heightM, 0);
    const cw = canvasRef.current?.clientWidth ?? 800;
    const ch = canvasRef.current?.clientHeight ?? 500;
    const unit = Math.min(cw / ((s.project.widthM + s.project.heightM) * 1.15), ch / ((s.project.widthM + s.project.heightM) * 0.75 + totalH * 0.95)) * s.iso.zoom;
    const u = unit * 0.866;
    const v = unit * 0.5;
    const uz = unit * 0.85;
    const cx = cw / 2 + s.iso.ox;
    const cy = ch / 2 + s.iso.oy;
    const floors = [...s.floors].sort((a, b) => b.level - a.level); // atas dulu
    for (const f of floors) {
      const z = floorBaseZ(s.floors, f);
      const rx = 0.5 * ((sx - cx) / u + (sy - cy + z * uz) / v);
      const ry = 0.5 * (-(sx - cx) / u + (sy - cy + z * uz) / v);
      const x = rx * cosR + ry * sinR;
      const y = -rx * sinR + ry * cosR;
      if (x >= -0.01 && x <= s.project.widthM + 0.01 && y >= -0.01 && y <= s.project.heightM + 0.01) {
        const onlyBand = s.bandFilter === "ALL" ? null : s.bandFilter;
        setPointInfo({ x: Math.min(Math.max(x, 0), s.project.widthM), y: Math.min(Math.max(y, 0), s.project.heightM), info: evaluatePoint(s.project, s.floors, s.aps, s.walls, x, y, f, onlyBand) });
        return;
      }
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const [sx, sy] = canvasPos(e);
    mousePosRef.current = { x: sx, y: sy };
    const drag = dragRef.current;
    const s = stateRef.current;
    if (!drag) {
      if (s.view3d) return;
      if (s.tool === "wall" && wallStartRef.current) {
        const [wx, wy] = toWorld(sx, sy);
        setDraftWall({ ...(s.draftWall ?? { x1: wallStartRef.current.x, y1: wallStartRef.current.y }), x2: wx, y2: wy });
      }
      if (s.tool === "measure" && measureStartRef.current) {
        const [wx, wy] = toWorld(sx, sy);
        setMeasure({ ...(s.measure ?? { x1: measureStartRef.current.x, y1: measureStartRef.current.y }), x2: wx, y2: wy });
      }
      return;
    }
    if (drag.kind === "pan") {
      setView({ ...s.view, x: drag.startX + (sx - drag.sx), y: drag.startY + (sy - drag.sy) });
      return;
    }
    if (drag.kind === "iso") {
      setIso((i) => ({ ...i, ox: drag.startX + (sx - drag.sx), oy: drag.startY + (sy - drag.sy) }));
      return;
    }
    if (drag.kind === "measure" && measureStartRef.current) {
      const [wx, wy] = toWorld(sx, sy);
      setMeasure({ x1: measureStartRef.current.x, y1: measureStartRef.current.y, x2: wx, y2: wy });
      return;
    }
    if (drag.kind === "ap" && drag.id) {
      const [wx, wy] = toWorld(sx, sy);
      const x = Math.min(Math.max(wx, 0), s.project!.widthM);
      const y = Math.min(Math.max(wy, 0), s.project!.heightM);
      setAps((list) => list.map((a) => (a.id === drag.id ? { ...a, posX: x, posY: y } : a)));
      return;
    }
    if (drag.kind === "wall" && drag.id && drag.startX2 !== undefined && drag.startY2 !== undefined) {
      const dx = (sx - drag.sx) / (s.project!.scalePxPerM * s.view.scale);
      const dy = (sy - drag.sy) / (s.project!.scalePxPerM * s.view.scale);
      setWalls((list) => list.map((w) => (w.id === drag.id ? { ...w, x1: drag.startX! + dx, y1: drag.startY! + dy, x2: drag.startX2! + dx, y2: drag.startY2! + dy } : w)));
      return;
    }
  }

  function onMouseUp() {
    const drag = dragRef.current;
    const s = stateRef.current;
    dragRef.current = null;
    finalizeWallRef.current();
    if (drag?.kind === "iso") {
      // klik tanpa geser di 3D (tool status/select) → info titik
      const moved = Math.abs(mousePosRef.current.x - drag.sx) + Math.abs(mousePosRef.current.y - drag.sy);
      if (moved < 5 && (drag.toolAtStart === "status" || drag.toolAtStart === "select")) {
        pick3dPoint(drag.sx, drag.sy);
      }
    }
    if (drag?.kind === "measure") {
      measureStartRef.current = null;
    }
    if (drag?.kind === "ap" && drag.id) {
      const ap = s.aps.find((a) => a.id === drag.id);
      if (ap) {
        const changed = Math.hypot(ap.posX - drag.startX, ap.posY - drag.startY) > 0.01;
        if (changed) {
          if (drag.startSnap) historyRef.current.push(drag.startSnap);
          patchApRef.current.pending = { ...patchApRef.current.pending, posX: ap.posX, posY: ap.posY };
          if (patchApRef.current.timer) window.clearTimeout(patchApRef.current.timer);
          patchApRef.current.timer = window.setTimeout(async () => {
            const pending = patchApRef.current.pending;
            patchApRef.current.pending = {};
            await fetch(`/api/wifi/projects/${id}/access-points/${drag.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(pending),
            });
          }, 400);
        }
      }
    }
    if (drag?.kind === "wall" && drag.id) {
      const w = s.walls.find((x) => x.id === drag.id);
      if (w) {
        const changed = Math.hypot(w.x1 - drag.startX, w.y1 - drag.startY) > 0.01;
        if (changed) {
          if (drag.startSnap) historyRef.current.push(drag.startSnap);
          fetch(`/api/wifi/projects/${id}/walls/${drag.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }),
          });
        }
      }
    }
  }

  function onWheel(e: React.WheelEvent) {
    const s = stateRef.current;
    if (!s.project) return;
    if (s.view3d) {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setIso((i) => ({ ...i, zoom: Math.min(6, Math.max(0.2, i.zoom * factor)) }));
      return;
    }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const k = s.project.scalePxPerM * s.view.scale;
    const wx = (sx - s.view.x) / k;
    const wy = (sy - s.view.y) / k;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const ns = Math.min(8, Math.max(0.2, s.view.scale * factor));
    const nk = s.project.scalePxPerM * ns;
    setView({ x: sx - wx * nk, y: sy - wy * nk, scale: ns });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const s = stateRef.current;
    if (e.key === "Escape") {
      setDraftWall(null);
      setMeasure(null);
      setPointInfo(null);
      setSelectedApId(null);
      setSelectedWallId(null);
      setFloorPanelId(null);
      if (s.view3d) setView3d(false);
      else setTool("select");
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (s.selectedApId) removeAp(s.selectedApId);
      else if (s.selectedWallId) removeWall(s.selectedWallId);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
    if (s.view3d) {
      const STEP = 28;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIso((i) => ({ ...i, ox: i.ox + STEP }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIso((i) => ({ ...i, ox: i.ox - STEP }));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIso((i) => ({ ...i, oy: i.oy + STEP }));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIso((i) => ({ ...i, oy: i.oy - STEP }));
      }
    }
  }

  /* ---------- export ---------- */
  function exportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${project?.name ?? "wifi"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function exportJson() {
    const payload = {
      project: { widthM: project?.widthM, heightM: project?.heightM, pathLossExponent: project?.pathLossExponent, deadZoneDbm: project?.deadZoneDbm },
      floors: floors.map((f) => ({ name: f.name, level: f.level, heightM: f.heightM, material: f.material })),
      walls: walls.map((w) => ({ floorIndex: floors.findIndex((f) => f.id === w.floorId), x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, material: w.material })),
      accessPoints: aps.map((a) => ({
        floorIndex: floors.findIndex((f) => f.id === a.floorId),
        name: a.name,
        ssid: a.ssid,
        heightM: a.heightM,
        posX: a.posX,
        posY: a.posY,
        enabled: a.enabled,
        radios: a.radios.map((r) => ({
          band: r.band,
          channel: r.channel,
          channelWidth: r.channelWidth,
          txPowerDbm: r.txPowerDbm,
          antennaGainDbi: r.antennaGainDbi,
          antennaType: r.antennaType,
          azimuthDeg: r.azimuthDeg,
          enabled: r.enabled,
        })),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${project?.name ?? "wifi"}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    try {
      const text = await file.text();
      const plan = JSON.parse(text);
      const payload = {
        widthM: plan.project?.widthM,
        heightM: plan.project?.heightM,
        pathLossExponent: plan.project?.pathLossExponent,
        deadZoneDbm: plan.project?.deadZoneDbm,
        floors: plan.floors ?? [],
        walls: plan.walls ?? [],
        accessPoints: plan.accessPoints ?? [],
      };
      const res = await fetch(`/api/wifi/projects/${id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg({ text: d.message ?? t("wif.importErr"), ok: false });
        return;
      }
      setMsg({ text: t("wif.imported"), ok: true });
      load();
    } catch {
      setMsg({ text: t("wif.importErr"), ok: false });
    }
  }

  async function uploadFloorplan(file: File, floorId?: string) {
    try {
      const dataUrl = await downscaleImage(file, 1600);
      setSaving(true);
      const fid = floorId ?? activeFloor?.id;
      if (!fid) return;
      const res = await fetch(`/api/wifi/projects/${id}/floors/${fid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floorplanData: dataUrl }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
      else {
        setMsg({ text: t("wif.floorplanSaved"), ok: true });
        setFloors((list) => list.map((f) => (f.id === fid ? { ...f, floorplanData: dataUrl } : f)));
      }
    } catch {
      setMsg({ text: t("wif.saveErr"), ok: false });
    } finally {
      setSaving(false);
    }
  }

  /* ---------- UI ---------- */
  if (loading) {
    return <div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-slate-400">{t("wif.loading")}</div>;
  }
  if (err || !project) {
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-slate-500">
        <p>{err ?? t("wif.notFound")}</p>
        <button onClick={() => router.push("/wifi/projects")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">
          {t("wif.back")}
        </button>
      </div>
    );
  }

  const coChannelWarn = (ap: WifiApDto) =>
    aps.some(
      (o) =>
        o.id !== ap.id &&
        o.enabled &&
        o.radios.some((r) => r.enabled && ap.radios.some((r2) => r2.enabled && r.band === r2.band && r.channel === r2.channel)),
    );

  return (
    <div
      className="flex h-[calc(100vh-6rem)] flex-col gap-2"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <button onClick={() => router.push("/wifi/projects")} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title={t("wif.back")}>
          ←
        </button>
        <span className="max-w-[180px] truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{project.name}</span>
        {saving && <span className="text-[11px] text-slate-400">{t("wif.saving")}</span>}

        {/* tab lantai */}
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60">
          {floors.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveFloorId(f.id);
                setPointInfo(null);
              }}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                activeFloor?.id === f.id ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {f.name}
            </button>
          ))}
          {floors.length < 5 && (
            <button onClick={addFloor} title={t("wif.addFloor")} className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40">
              + {t("wif.addFloor")}
            </button>
          )}
          <button
            onClick={() => activeFloor && setFloorPanelId((p) => (p === activeFloor.id ? null : activeFloor.id))}
            title={t("wif.floorSettings")}
            className={`rounded-lg px-2 py-1 text-xs ${floorPanelId ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"}`}
          >
            ⚙
          </button>
        </div>

        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <div className="flex items-center gap-1">
          {TOOLS.map((tl) => (
            <button
              key={tl.id}
              onClick={() => {
                setTool(tl.id);
                setDraftWall(null);
                setMeasure(null);
                setPointInfo(null);
              }}
              title={t(`wif.tool.${tl.id}`)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition ${
                tool === tl.id ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {tl.icon}
            </button>
          ))}
        </div>
        {tool === "wall" && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
            {MATERIALS.map((m) => (
              <button
                key={m.id}
                onClick={() => setWallMaterial(m.id)}
                title={t(`wif.material.${m.id}`)}
                className={`h-8 rounded-lg px-2 text-[11px] font-medium transition ${
                  wallMaterial === m.id ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {MATERIAL_LOSS[m.id]} dB
              </button>
            ))}
          </>
        )}
        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <button onClick={undo} title={t("wif.undo")} className="h-9 rounded-lg px-2.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          ↩ {t("wif.undo")}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {!view3d && floors.length > 1 && (
            <label
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
              title={t("wif.otherApOpacityHint")}
            >
              {t("wif.otherApOpacity")}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={otherApOpacity}
                onChange={(e) => setOtherApOpacity(Number(e.target.value))}
                className="w-20 accent-indigo-600"
              />
              <span className="w-9 text-right tabular-nums">{otherApOpacity}%</span>
            </label>
          )}
          {view3d && (
            <label
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
              title={t("wif.floorOpacityHint")}
            >
              {t("wif.floorOpacity")}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={isoOpacity}
                onChange={(e) => setIsoOpacity(Number(e.target.value))}
                className="w-20 accent-indigo-600"
              />
              <span className="w-9 text-right tabular-nums">{isoOpacity}%</span>
            </label>
          )}
          {view3d && (
            <>
              <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" title={t("wif.pan3d")}>
                <button onClick={() => setIso((i) => ({ ...i, ox: i.ox + 32 }))} className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">◀</button>
                <div className="flex flex-col">
                  <button onClick={() => setIso((i) => ({ ...i, oy: i.oy + 32 }))} className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">▲</button>
                  <button onClick={() => setIso((i) => ({ ...i, oy: i.oy - 32 }))} className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">▼</button>
                </div>
                <button onClick={() => setIso((i) => ({ ...i, ox: i.ox - 32 }))} className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">▶</button>
              </div>
              <button onClick={() => setIso({ rot: 0, zoom: 1, ox: 0, oy: 0 })} title={t("wif.reset3d")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                ⟲
              </button>
            </>
          )}
          {view3d && (
            <button onClick={() => setIso((i) => ({ ...i, rot: (i.rot + 1) % 4 }))} title={t("wif.rotate3d")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              ⟳ {t("wif.rotate3d")}
            </button>
          )}
          <button
            onClick={() => {
              setView3d(!view3d);
              setPointInfo(null);
            }}
            title={t("wif.view3d")}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
              view3d ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {view3d ? t("wif.view2d") : "🧊 " + t("wif.view3d")}
          </button>
          {!view3d && (
            <label className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              🖼 {t("wif.floorplan")}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFloorplan(e.target.files[0], activeFloor?.id)} />
            </label>
          )}
          <label className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            ⬆ {t("wif.import")}
            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </label>
          <button onClick={exportJson} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            ⬇ JSON
          </button>
          <button onClick={exportPng} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900">
            ⬇ PNG
          </button>
        </div>
      </div>

      {/* bar status */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {(
            [
              { id: "signal", label: t("wif.mode.signal") },
              { id: "sinr", label: t("wif.mode.sinr") },
              { id: "dead", label: t("wif.mode.dead") },
              { id: "coverage", label: t("wif.mode.coverage") },
            ] as { id: Mode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === m.id ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900" title={t("wif.band")}>
          {(
            [
              { id: "ALL", label: t("wif.bandAll") },
              { id: "BAND_2_4", label: "2.4 GHz" },
              { id: "BAND_5", label: "5 GHz" },
              { id: "BAND_6", label: "6 GHz" },
            ] as { id: "ALL" | WifiBand; label: string }[]
          ).map((b) => (
            <button
              key={b.id}
              onClick={() => setBandFilter(b.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${bandFilter === b.id ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="text-slate-500 dark:text-slate-400">
            {t("wif.statCoverage")}{activeFloor ? ` (${activeFloor.name})` : ""}: <b className="text-emerald-600">{sim ? sim.signalCoveragePct.toFixed(1) : "0"}%</b>
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {t("wif.statDead")}: <b className="text-red-500">{sim ? sim.deadZonePct.toFixed(1) : "100"}%</b>
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {t("wif.statAp")}{bandFilter !== "ALL" ? ` (${bandLabel(bandFilter)})` : ""}: <b className="text-slate-800 dark:text-slate-100">{sim?.totalEnabled ?? 0}/{aps.length}</b>
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            {t("wif.threshold")}
            <input
              type="number"
              min={-100}
              max={-50}
              value={project.deadZoneDbm}
              onChange={(e) => {
                const v = Number(e.target.value);
                setProject((p) => (p ? { ...p, deadZoneDbm: v } : p));
                scheduleSim();
                fetch(`/api/wifi/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deadZoneDbm: v }) });
              }}
              className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <span>dBm</span>
          </label>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* canvas */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-crosshair"
            style={{ touchAction: "none" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => {
              if (dragRef.current?.kind === "pan") dragRef.current = null;
            }}
            onWheel={onWheel}
          />
          <div className="pointer-events-none absolute left-3 top-2 rounded-lg bg-slate-900/70 px-2 py-1 text-[10px] text-white">
            {view3d
              ? `${t("wif.hint3d")}`
              : `${project.widthM}×${project.heightM} m · n=${project.pathLossExponent} · ${t("wif.disclaimer")}`}
          </div>
          {/* legenda mode aktif */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[10px] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300">
            {mode === "signal" && (
              <>
                <div className="h-2 w-40 rounded bg-gradient-to-r from-red-500 via-yellow-400 to-green-500" />
                <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                  <span>-95 dBm</span>
                  <span>{project.deadZoneDbm} dBm</span>
                  <span>-50 dBm</span>
                </div>
                <p className="mt-1">{t("wif.legendSignal")}</p>
              </>
            )}
            {mode === "sinr" && (
              <>
                <div className="h-2 w-40 rounded bg-gradient-to-r from-red-500 via-yellow-400 to-green-500" />
                <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                  <span>0 dB</span>
                  <span>30 dB</span>
                </div>
                <p className="mt-1">{t("wif.legendSinr")}</p>
              </>
            )}
            {mode === "dead" && (
              <>
                <span className="mr-1.5 inline-block h-3 w-3 rounded-sm bg-red-500/60 align-middle" />
                {t("wif.legendDead")} (&lt; {project.deadZoneDbm} dBm)
              </>
            )}
            {mode === "coverage" && (
              <>
                <span className="mr-1.5 inline-block h-3 w-3 rounded-sm bg-green-500/60 align-middle" />
                {t("wif.legendCovered")}
                <span className="mx-1.5 ml-3 inline-block h-3 w-3 rounded-sm bg-red-500/50 align-middle" />
                {t("wif.legendDead")} (&lt; {project.deadZoneDbm} dBm)
              </>
            )}
          </div>
          {msg && (
            <div
              className={`absolute right-3 top-2 max-w-xs rounded-lg border px-3 py-2 text-xs shadow-sm ${
                msg.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/70 dark:text-red-300"
              }`}
            >
              {msg.text}
              <button onClick={() => setMsg(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
            </div>
          )}
          {/* kartu simulasi user (tool status) */}
          {pointInfo && (
            <div className="pointer-events-none absolute bottom-3 right-3 w-72 space-y-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 text-[11px] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                🧍 {t("wif.statusTitle")} · {pointInfo.info.floor?.name ?? ""} ({pointInfo.x.toFixed(1)}, {pointInfo.y.toFixed(1)}) m
              </p>
              {pointInfo.info.bestAp && pointInfo.info.bestRssi !== null && pointInfo.info.sinrDb !== null ? (
                <>
                  <p className="flex items-center gap-1.5">
                    {t("wif.statusSignal")}: <b>{pointInfo.info.bestRssi.toFixed(1)} dBm</b>
                    <SignalBadge rssi={pointInfo.info.bestRssi} dead={project.deadZoneDbm} labelDead={t("wif.statusDead")} labelGood={t("wif.statusGood")} labelOk={t("wif.statusOk")} />
                  </p>
                  <p className="text-slate-400">
                    {t("wif.statusBestAp")}: {pointInfo.info.bestAp.name} · {pointInfo.info.bestRadio ? `ch${pointInfo.info.bestRadio.channel} (${bandLabel(pointInfo.info.bestRadio.band)} GHz)` : ""}
                  </p>
                  <p className="flex items-center gap-1.5">
                    {t("wif.statusSinr")}: <b>{pointInfo.info.sinrDb.toFixed(1)} dB</b>
                    <SinrBadge sinr={pointInfo.info.sinrDb} labelGood={t("wif.statusGood")} labelOk={t("wif.statusOk")} labelBad={t("wif.statusInterfered")} />
                  </p>
                  <p>
                    {t("wif.statusCoverage")}:{" "}
                    <b className={pointInfo.info.coverageOk ? "text-emerald-600" : "text-red-500"}>
                      {pointInfo.info.coverageOk ? `✓ ${t("wif.statusCovered")}` : `✗ ${t("wif.statusNotCovered")}`}
                    </b>
                  </p>
                  <p>
                    {t("wif.statusDead")}:{" "}
                    <b className={pointInfo.info.isDead ? "text-red-500" : "text-emerald-600"}>{pointInfo.info.isDead ? t("wif.yes") : t("wif.no")}</b>
                  </p>
                  <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
                    <p className="font-medium">{t("wif.statusInterferers")}:</p>
                    {pointInfo.info.interferers.length === 0 ? (
                      <p className="mt-0.5 text-emerald-600">{t("wif.statusNoInterf")}</p>
                    ) : (
                      <ul className="mt-0.5 space-y-0.5">
                        {pointInfo.info.interferers.map((it) => (
                          <li key={it.radio.id}>
                            {it.ap.name} · ch{it.radio.channel} ({bandLabel(it.radio.band)} GHz) · {it.rssi.toFixed(1)} dBm ·{" "}
                            {it.factor === 1 ? t("wif.statusCoChannel") : `${t("wif.statusAdjacent")} (${it.factor})`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-slate-400">{t("wif.statusNoAp")}</p>
              )}
            </div>
          )}
        </div>

        {/* panel samping */}
        {showPanel && (
          <aside className="w-72 shrink-0 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {floorPanelId ? (
              (() => {
                const fp = floors.find((f) => f.id === floorPanelId);
                if (!fp) return null;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">⚙ {t("wif.floorSettings")}</h3>
                      <button onClick={() => setFloorPanelId(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
                    </div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {t("wif.floorName")}
                      <input
                        value={fp.name}
                        onChange={(e) => updateFloorLocal(fp.id, { name: e.target.value })}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {t("wif.floorHeight")}: <b>{fp.heightM} m</b>
                      <input type="range" min={1} max={6} step={0.1} value={fp.heightM} onChange={(e) => updateFloorLocal(fp.id, { heightM: Number(e.target.value) })} className="mt-1 w-full accent-indigo-600" />
                    </label>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {t("wif.floorMaterial")}
                      <select
                        value={fp.material}
                        onChange={(e) => updateFloorLocal(fp.id, { material: e.target.value as WifiFloorMaterial })}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {(["CONCRETE", "WOOD", "GYPSUM"] as WifiFloorMaterial[]).map((m) => (
                          <option key={m} value={m}>
                            {t(`wif.floorMat.${m}`)} ({FLOOR_MATERIAL_LOSS[m]} dB)
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{t("wif.floorLossHint")}</p>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      🖼 {t("wif.floorplan")}
                      <div className="mt-1 flex gap-1.5">
                        <label className="flex-1 cursor-pointer rounded-lg border border-slate-200 px-2 py-1.5 text-center text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                          {t("wif.upload")}
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFloorplan(e.target.files[0], fp.id)} />
                        </label>
                        {fp.floorplanData && (
                          <button
                            onClick={() => updateFloorLocal(fp.id, { floorplanData: null })}
                            className="rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
                          >
                            {t("wif.remove")}
                          </button>
                        )}
                      </div>
                    </label>
                    {floors.length > 1 && (
                      <button onClick={() => deleteFloor(fp.id)} className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50">
                        {t("wif.deleteFloor")}
                      </button>
                    )}
                  </>
                );
              })()
            ) : selectedAp ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("wif.apPanel")}</h3>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <input type="checkbox" checked={selectedAp.enabled} onChange={(e) => updateApLocal(selectedAp.id, { enabled: e.target.checked })} className="h-3 w-3 accent-emerald-600" />
                    {t("wif.enabled")}
                  </label>
                </div>

                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t("wif.apName")}
                  <input value={selectedAp.name} onChange={(e) => updateApLocal(selectedAp.id, { name: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </label>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  SSID
                  <input value={selectedAp.ssid ?? ""} onChange={(e) => updateApLocal(selectedAp.id, { ssid: e.target.value || null })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                </label>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t("wif.floor")}
                  <select
                    value={selectedAp.floorId}
                    onChange={(e) => updateApLocal(selectedAp.id, { floorId: e.target.value })}
                    className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("wif.preset")}</p>
                  <select
                    value=""
                    onChange={(e) => {
                      const p = presets.find((x) => x.id === e.target.value);
                      if (p) applyPreset(selectedAp.id, p);
                    }}
                    className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">{t("wif.presetSelect")}</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.brand} {p.model} · {bandLabel(p.band)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("wif.radios")}</p>
                  <div className="mt-1 space-y-2">
                    {selectedAp.radios.map((radio) => (
                      <div key={radio.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_COLOR[radio.band] }} />
                            {bandLabel(radio.band)} GHz
                          </span>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                              <input type="checkbox" checked={radio.enabled} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { enabled: e.target.checked })} className="h-3 w-3 accent-emerald-600" />
                              {t("wif.enabled")}
                            </label>
                            <button onClick={() => removeRadio(selectedAp.id, radio.id)} title={t("wif.deleteRadio")} className="text-red-500 hover:text-red-400">
                              ✕
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {t("wif.channel")}
                            <select value={radio.channel} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { channel: Number(e.target.value) })} className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 text-xs outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                              {CHANNELS_BY_BAND[radio.band].map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {t("wif.chWidth")}
                            <select value={radio.channelWidth} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { channelWidth: Number(e.target.value) })} className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 text-xs outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                              {CHANNEL_WIDTHS.map((w) => (
                                <option key={w} value={w}>
                                  {w} MHz
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="col-span-2 block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {t("wif.antenna")}
                            <select value={radio.antennaType} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { antennaType: e.target.value as WifiAntennaType })} className="mt-0.5 w-full rounded-md border border-slate-300 px-1.5 py-1 text-xs outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                              <option value="OMNIDIRECTIONAL">{t("wif.antOmni")}</option>
                              <option value="PATCH">{t("wif.antPatch")}</option>
                              <option value="PANEL">{t("wif.antPanel")}</option>
                            </select>
                          </label>
                        </div>
                        <label className="mt-1.5 block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          {t("wif.txPower")}: <b>{radio.txPowerDbm} dBm</b>
                          <input type="range" min={0} max={30} step={1} value={radio.txPowerDbm} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { txPowerDbm: Number(e.target.value) })} className="mt-0.5 w-full accent-indigo-600" />
                        </label>
                        <label className="mt-1 block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          {t("wif.gain")}: <b>{radio.antennaGainDbi} dBi</b>
                          <input type="range" min={0} max={20} step={0.5} value={radio.antennaGainDbi} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { antennaGainDbi: Number(e.target.value) })} className="mt-0.5 w-full accent-indigo-600" />
                        </label>
                        {radio.antennaType !== "OMNIDIRECTIONAL" && (
                          <label className="mt-1 block text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            {t("wif.azimuth")}: <b>{radio.azimuthDeg ?? 0}°</b>
                            <input type="range" min={0} max={360} step={5} value={radio.azimuthDeg ?? 0} onChange={(e) => updateRadioLocal(selectedAp.id, radio.id, { azimuthDeg: Number(e.target.value) })} className="mt-0.5 w-full accent-indigo-600" />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const missing = (["BAND_2_4", "BAND_5", "BAND_6"] as WifiBand[]).filter((b) => !selectedAp.radios.some((r) => r.band === b));
                    if (missing.length === 0) return null;
                    return (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">{t("wif.addRadio")}</span>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) addRadio(selectedAp.id, e.target.value as WifiBand);
                            e.target.value = "";
                          }}
                          className="rounded-md border border-slate-300 px-1.5 py-1 text-xs outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <option value="">—</option>
                          {missing.map((b) => (
                            <option key={b} value={b}>
                              {bandLabel(b)} GHz
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}
                </div>

                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t("wif.height")}: <b>{selectedAp.heightM} m</b>
                  <input type="range" min={0.5} max={10} step={0.1} value={selectedAp.heightM} onChange={(e) => updateApLocal(selectedAp.id, { heightM: Number(e.target.value) })} className="mt-1 w-full accent-indigo-600" />
                </label>

                {coChannelWarn(selectedAp) && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">⚠️ {t("wif.coChannelWarn")}</p>
                )}

                <button onClick={() => removeAp(selectedAp.id)} className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50">
                  {t("wif.deleteAp")}
                </button>
              </>
            ) : selectedWallId ? (
              <>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("wif.wallPanel")}</h3>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t("wif.material")}
                  <select
                    value={walls.find((w) => w.id === selectedWallId)?.material ?? "DRYWALL"}
                    onChange={(e) => {
                      const mat = e.target.value as WallMaterialKey;
                      setWalls((list) => list.map((w) => (w.id === selectedWallId ? { ...w, material: mat } : w)));
                      fetch(`/api/wifi/projects/${id}/walls/${selectedWallId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ material: mat }),
                      });
                    }}
                    className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {MATERIALS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {t(`wif.material.${m.id}`)} ({MATERIAL_LOSS[m.id]} dB)
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={() => removeWall(selectedWallId)} className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50">
                  {t("wif.deleteWall")}
                </button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("wif.apList")}</h3>
                {aps.length === 0 ? (
                  <p className="text-xs text-slate-400">{t("wif.noAp")}</p>
                ) : (
                  <div className="space-y-1">
                    {aps.map((ap) => (
                      <button
                        key={ap.id}
                        onClick={() => {
                          setSelectedApId(ap.id);
                          setSelectedWallId(null);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="flex gap-0.5">
                          {ap.radios.map((r) => (
                            <span key={r.id} className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_COLOR[r.band], opacity: r.enabled ? 1 : 0.3 }} />
                          ))}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{ap.name}</span>
                        <span className="text-[10px] text-slate-400">
                          {floors.find((f) => f.id === ap.floorId)?.name ?? "?"} · {ap.radios.map((r) => `${bandLabel(r.band)}:${r.channel}`).join(" ")}
                        </span>
                        {coChannelWarn(ap) && <span className="text-[10px]">⚠️</span>}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("wif.legend")}</p>
                  <div className="mt-1.5 flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    <span>🟢 2.4 GHz · 🔵 5 GHz · 🟣 6 GHz</span>
                    <span>🧱 {t("wif.legendWall")}</span>
                    <span>📐 {t("wif.legendMeasure")}</span>
                    <span>↩ {t("wif.legendUndo")}</span>
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/* ---------- util ---------- */
function SignalBadge({ rssi, dead, labelDead, labelGood, labelOk }: { rssi: number; dead: number; labelDead: string; labelGood: string; labelOk: string }) {
  const cls =
    rssi >= -60
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
      : rssi >= dead
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
        : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400";
  const label = rssi >= -60 ? labelGood : rssi >= dead ? labelOk : labelDead;
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${cls}`}>{label}</span>;
}

function SinrBadge({ sinr, labelGood, labelOk, labelBad }: { sinr: number; labelGood: string; labelOk: string; labelBad: string }) {
  const cls =
    sinr >= 25
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
      : sinr >= 15
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
        : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400";
  const label = sinr >= 25 ? labelGood : sinr >= 15 ? labelOk : labelBad;
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${cls}`}>{label}</span>;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function downscaleImage(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load error"));
    };
    img.src = url;
  });
}
