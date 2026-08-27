"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import {
  computeGrid,
  CHANNELS_BY_BAND,
  CHANNEL_WIDTHS,
  MATERIAL_LOSS,
  bandLabel,
  rssiColor,
  sinrColor,
  type WifiWallDto,
  type WifiApDto,
  type WifiProjectDto,
  type WifiBand,
  type WifiAntennaType,
  type WifiWallMaterial,
  type SimResult,
} from "@/lib/wifi-engine";

type Tool = "select" | "wall" | "ap" | "measure" | "delete";
type Mode = "signal" | "sinr" | "dead" | "coverage";
type WallMaterialKey = "DRYWALL" | "WOOD" | "GLASS" | "BRICK" | "CONCRETE";

type Preset = { id: string; brand: string; model: string; band: WifiBand; txPowerDbm: number; antennaGainDbi: number; antennaType: WifiAntennaType };

const TOOLS: { id: Tool; icon: string }[] = [
  { id: "select", icon: "🖱️" },
  { id: "wall", icon: "🧱" },
  { id: "ap", icon: "📶" },
  { id: "measure", icon: "📐" },
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
  const [walls, setWalls] = useState<WifiWallDto[]>([]);
  const [aps, setAps] = useState<WifiApDto[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [wallMaterial, setWallMaterial] = useState<WallMaterialKey>("DRYWALL");
  const [mode, setMode] = useState<Mode>("signal");
  const [selectedApId, setSelectedApId] = useState<string | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);

  const [view, setView] = useState({ x: 40, y: 20, scale: 1 });
  const [measure, setMeasure] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [draftWall, setDraftWall] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showPanel, setShowPanel] = useState(true);

  // refs agar draw loop & event handler tidak stale-closure
  const stateRef = useRef({ project, walls, aps, view, tool, mode, selectedApId, selectedWallId, measure, draftWall, wallMaterial, sim });
  stateRef.current = { project, walls, aps, view, tool, mode, selectedApId, selectedWallId, measure, draftWall, wallMaterial, sim };

  const dragRef = useRef<{ kind: "pan" | "ap" | "wall" | "measure"; id?: string; sx: number; sy: number; startX: number; startY: number; startX2?: number; startY2?: number; startSnap?: { walls: WifiWallDto[]; aps: WifiApDto[] } } | null>(null);
  const wallStartRef = useRef<{ x: number; y: number } | null>(null);
  const measureStartRef = useRef<{ x: number; y: number } | null>(null);
  const floorplanImgRef = useRef<HTMLImageElement | null>(null);
  const historyRef = useRef<{ walls: WifiWallDto[]; aps: WifiApDto[] }[]>([]);

  useEffect(() => {
    if (project?.floorplanData) {
      const img = new Image();
      img.src = project.floorplanData;
      img.onload = () => {
        floorplanImgRef.current = img;
      };
    } else {
      floorplanImgRef.current = null;
    }
  }, [project?.floorplanData]);

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
    const p = stateRef.current.project;
    const w = stateRef.current.walls;
    const a = stateRef.current.aps;
    if (!p) return;
    const cellWorld = Math.max(0.25, Math.max(p.widthM, p.heightM) / 180);
    const cols = Math.max(4, Math.ceil(p.widthM / cellWorld));
    const rows = Math.max(4, Math.ceil(p.heightM / cellWorld));
    setSim(computeGrid(p, a, w, cols, rows));
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
      setWalls(d.data.walls ?? []);
      setAps(d.data.accessPoints ?? []);
      setView({ x: 40, y: 20, scale: 1 });
      setSim(null);
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
    if (project) scheduleSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.widthM, project?.heightM, project?.pathLossExponent, project?.deadZoneDbm, walls, aps]);

  /* ---------- hit-test ---------- */
  function hitTest(sx: number, sy: number): { ap?: WifiApDto; wall?: WifiWallDto } {
    const s = stateRef.current;
    for (let i = s.aps.length - 1; i >= 0; i--) {
      const ap = s.aps[i];
      const [px, py] = toScreen(ap.posX, ap.posY);
      if (Math.hypot(px - sx, py - sy) <= 14) return { ap };
    }
    for (let i = s.walls.length - 1; i >= 0; i--) {
      const w = s.walls[i];
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
    historyRef.current.push({ walls: s.walls, aps: s.aps });
    if (historyRef.current.length > 40) historyRef.current.shift();
  }

  async function undo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    const payload = {
      widthM: stateRef.current.project?.widthM,
      heightM: stateRef.current.project?.heightM,
      walls: prev.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, material: w.material })),
      accessPoints: prev.aps.map((a) => ({
        name: a.name,
        ssid: a.ssid,
        band: a.band,
        channel: a.channel,
        channelWidth: a.channelWidth,
        txPowerDbm: a.txPowerDbm,
        antennaGainDbi: a.antennaGainDbi,
        antennaType: a.antennaType,
        azimuthDeg: a.azimuthDeg,
        heightM: a.heightM,
        posX: a.posX,
        posY: a.posY,
        enabled: a.enabled,
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
      body: JSON.stringify({ x1, y1, x2, y2, material }),
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
      body: JSON.stringify({ name: "AP", posX: x, posY: y }),
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

  async function applyPreset(apId: string, preset: Preset) {
    updateApLocal(apId, {
      band: preset.band,
      txPowerDbm: preset.txPowerDbm,
      antennaGainDbi: preset.antennaGainDbi,
      antennaType: preset.antennaType,
      channel: CHANNELS_BY_BAND[preset.band][0],
    });
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
    if (s.sim && s.project && s.aps.some((a) => a.enabled)) {
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
          if (s.mode === "signal") col = rssiColor(r, p.deadZoneDbm);
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
      const [px, py] = toScreen(ap.posX, ap.posY);
      const isSel = ap.id === s.selectedApId;
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fillStyle = BAND_COLOR[ap.band];
      ctx.fill();
      ctx.strokeStyle = isSel ? "#f59e0b" : "#fff";
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.stroke();
      if (ap.antennaType !== "OMNIDIRECTIONAL") {
        const az = ((ap.azimuthDeg ?? 0) * Math.PI) / 180;
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
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = "#0f172a";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ap.name, px, py - 16);
      ctx.fillStyle = "rgba(15,23,42,0.7)";
      ctx.fillText(`ch${ap.channel}`, px, py + 22);
      ctx.textAlign = "left";
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
  }

  /* ---------- interaksi ---------- */
  function canvasPos(e: React.MouseEvent): [number, number] {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onMouseDown(e: React.MouseEvent) {
    const [sx, sy] = canvasPos(e);
    const s = stateRef.current;
    if (e.button === 1) {
      dragRef.current = { kind: "pan", sx, sy, startX: s.view.x, startY: s.view.y };
      return;
    }
    if (s.tool === "select") {
      const hit = hitTest(sx, sy);
      if (hit.ap) {
        setSelectedApId(hit.ap.id);
        setSelectedWallId(null);
        dragRef.current = { kind: "ap", id: hit.ap.id, sx, sy, startX: hit.ap.posX, startY: hit.ap.posY, startSnap: { walls: s.walls, aps: s.aps } };
      } else if (hit.wall) {
        setSelectedWallId(hit.wall.id);
        setSelectedApId(null);
        dragRef.current = { kind: "wall", id: hit.wall.id, sx, sy, startX: hit.wall.x1, startY: hit.wall.y1, startX2: hit.wall.x2, startY2: hit.wall.y2, startSnap: { walls: s.walls, aps: s.aps } };
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
    if (s.tool === "delete") {
      const hit = hitTest(sx, sy);
      if (hit.ap) removeAp(hit.ap.id);
      else if (hit.wall) removeWall(hit.wall.id);
      return;
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const [sx, sy] = canvasPos(e);
    const drag = dragRef.current;
    const s = stateRef.current;
    if (!drag) {
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
    if (drag?.kind === "wall" && s.draftWall) {
      const d = s.draftWall;
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.2) createWall(d.x1, d.y1, d.x2, d.y2, s.wallMaterial);
      setDraftWall(null);
      wallStartRef.current = null;
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
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const s = stateRef.current;
    if (!s.project) return;
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
      setSelectedApId(null);
      setSelectedWallId(null);
      setTool("select");
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (s.selectedApId) removeAp(s.selectedApId);
      else if (s.selectedWallId) removeWall(s.selectedWallId);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
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
    const payload = { project: { widthM: project?.widthM, heightM: project?.heightM, pathLossExponent: project?.pathLossExponent, deadZoneDbm: project?.deadZoneDbm }, walls, accessPoints: aps };
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

  async function uploadFloorplan(file: File) {
    try {
      const dataUrl = await downscaleImage(file, 1600);
      setSaving(true);
      const res = await fetch(`/api/wifi/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floorplanData: dataUrl }),
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) setMsg({ text: d.message ?? t("wif.saveErr"), ok: false });
      else {
        setMsg({ text: t("wif.floorplanSaved"), ok: true });
        setProject((p) => (p ? { ...p, floorplanData: dataUrl } : p));
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
    aps.some((o) => o.id !== ap.id && o.enabled && o.band === ap.band && o.channel === ap.channel);

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
        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <div className="flex items-center gap-1">
          {TOOLS.map((tl) => (
            <button
              key={tl.id}
              onClick={() => {
                setTool(tl.id);
                setDraftWall(null);
                setMeasure(null);
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
          <label className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            🖼 {t("wif.floorplan")}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFloorplan(e.target.files[0])} />
          </label>
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
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="text-slate-500 dark:text-slate-400">
            {t("wif.statCoverage")}: <b className="text-emerald-600">{sim ? sim.signalCoveragePct.toFixed(1) : "0"}%</b>
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {t("wif.statDead")}: <b className="text-red-500">{sim ? sim.deadZonePct.toFixed(1) : "100"}%</b>
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {t("wif.statAp")}: <b className="text-slate-800 dark:text-slate-100">{sim?.totalEnabled ?? 0}/{aps.length}</b>
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
            {project.widthM}×{project.heightM} m · n={project.pathLossExponent} · {t("wif.disclaimer")}
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
        </div>

        {/* panel samping */}
        {showPanel && (
          <aside className="w-72 shrink-0 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {selectedAp ? (
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

                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {t("wif.band")}
                    <select value={selectedAp.band} onChange={(e) => updateApLocal(selectedAp.id, { band: e.target.value as WifiBand, channel: CHANNELS_BY_BAND[e.target.value as WifiBand][0] })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="BAND_2_4">2.4 GHz</option>
                      <option value="BAND_5">5 GHz</option>
                      <option value="BAND_6">6 GHz</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {t("wif.channel")}
                    <select value={selectedAp.channel} onChange={(e) => updateApLocal(selectedAp.id, { channel: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      {CHANNELS_BY_BAND[selectedAp.band].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {t("wif.chWidth")}
                    <select value={selectedAp.channelWidth} onChange={(e) => updateApLocal(selectedAp.id, { channelWidth: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      {CHANNEL_WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {w} MHz
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {t("wif.antenna")}
                    <select value={selectedAp.antennaType} onChange={(e) => updateApLocal(selectedAp.id, { antennaType: e.target.value as WifiAntennaType })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <option value="OMNIDIRECTIONAL">{t("wif.antOmni")}</option>
                      <option value="PATCH">{t("wif.antPatch")}</option>
                      <option value="PANEL">{t("wif.antPanel")}</option>
                    </select>
                  </label>
                </div>

                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t("wif.txPower")}: <b>{selectedAp.txPowerDbm} dBm</b>
                  <input type="range" min={0} max={30} step={1} value={selectedAp.txPowerDbm} onChange={(e) => updateApLocal(selectedAp.id, { txPowerDbm: Number(e.target.value) })} className="mt-1 w-full accent-indigo-600" />
                </label>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t("wif.gain")}: <b>{selectedAp.antennaGainDbi} dBi</b>
                  <input type="range" min={0} max={20} step={0.5} value={selectedAp.antennaGainDbi} onChange={(e) => updateApLocal(selectedAp.id, { antennaGainDbi: Number(e.target.value) })} className="mt-1 w-full accent-indigo-600" />
                </label>
                {selectedAp.antennaType !== "OMNIDIRECTIONAL" && (
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {t("wif.azimuth")}: <b>{selectedAp.azimuthDeg ?? 0}°</b>
                    <input type="range" min={0} max={360} step={5} value={selectedAp.azimuthDeg ?? 0} onChange={(e) => updateApLocal(selectedAp.id, { azimuthDeg: Number(e.target.value) })} className="mt-1 w-full accent-indigo-600" />
                  </label>
                )}
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
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_COLOR[ap.band] }} />
                        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{ap.name}</span>
                        <span className="text-[10px] text-slate-400">ch{ap.channel}</span>
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
