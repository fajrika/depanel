// Reusable PDF report renderer (server-side, pure JS via pdf-lib).
// Features build a list of `ReportBlock`s; `renderReportPdf` lays them out on
// A4 pages with header/footer. The combined "Laporan" menu can concatenate the
// blocks of several features and render them as one document.
// Worker-safe: no "server-only", no Next.js imports, no filesystem access.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export type ReportState = "up" | "down" | "partial" | "none";

export type ReportBlock =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; text: string; muted?: boolean; bold?: boolean; size?: number }
  | { type: "kv"; rows: [string, string | number | null | undefined][] }
  | {
      type: "table";
      columns: { label: string; width?: number; align?: "left" | "right" | "center" }[];
      rows: (string | number | null | undefined)[][];
      /** Optional per-row tint, e.g. highlight failed rows. */
      rowStates?: (ReportState | null | undefined)[];
    }
  | { type: "statusStrip"; items: { label?: string; state: ReportState }[]; caption?: string }
  | { type: "code"; text: string; maxLines?: number }
  | {
      type: "chart";
      chart: "line" | "bar";
      title?: string;
      /** Label sumbu X (satu per titik/kelompok batang). */
      labels: string[];
      /** Warna dalam hex (#rrggbb) — dipakai sama oleh preview HTML & PDF. */
      series: ChartSeries[];
      /** Satuan nilai, mis. "Mbps" / "ms" (ditampilkan di sumbu Y). */
      unit?: string;
      /** Tinggi area plot dalam pt (default 130). */
      height?: number;
      caption?: string;
      /** Sumbu Y mulai dari 0 (default true). */
      zeroBased?: boolean;
    }
  | { type: "stats"; items: StatItem[] }
  | { type: "spacer"; size?: number }
  | { type: "pageBreak" };

export type ChartSeries = { name: string; color: string; values: (number | null)[] };
export type StatItem = { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "neutral" };

export interface ReportSpec {
  title: string;
  subtitle?: string;
  /** Used for the "Dibuat" timestamp in the header. Default Asia/Jakarta. */
  timezone?: string;
  generatedAt?: Date;
  /** Small text shown at the left of every footer. Default "Depanel". */
  footer?: string;
  blocks: ReportBlock[];
}

// ── layout constants (A4 portrait, points) ──────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
/** Blok setinggi ini atau kurang diusahakan tidak terbelah antarhalaman. */
const KEEP_TOGETHER_MAX = CONTENT_H * 0.45;
/** Batas baris per sel tabel (baris yang lebih panjang diberi "..."). */
const TABLE_MAX_CELL_LINES = 40;
const STATS_PER_ROW = 4;
const STAT_TILE_H = 44;

const C = {
  text: rgb(0.11, 0.13, 0.17),
  muted: rgb(0.42, 0.45, 0.5),
  line: rgb(0.85, 0.87, 0.9),
  headBg: rgb(0.94, 0.95, 0.97),
  codeBg: rgb(0.96, 0.96, 0.97),
  accent: rgb(0.15, 0.39, 0.92),
  up: rgb(0.13, 0.7, 0.4),
  down: rgb(0.88, 0.25, 0.25),
  partial: rgb(0.95, 0.65, 0.15),
  none: rgb(0.82, 0.84, 0.87),
  downTint: rgb(0.99, 0.93, 0.93),
  partialTint: rgb(1, 0.97, 0.9),
};

const STATE_COLOR: Record<ReportState, RGB> = { up: C.up, down: C.down, partial: C.partial, none: C.none };

/**
 * Standard PDF fonts only cover WinAnsi (Latin-1-ish). Replace common
 * typographic characters and drop anything else (emoji, CJK, box drawing)
 * so pdf-lib never throws on encode.
 */
export function sanitizePdfText(input: unknown): string {
  const s = input === null || input === undefined ? "" : String(input);
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•●▪]/g, "-")
    .replace(/[→⇒]/g, "->")
    .replace(/[←⇐]/g, "<-")
    .replace(/✓|✔/g, "v")
    .replace(/✗|✘/g, "x")
    .replace(/[   ]/g, " ")
    .replace(/[─-╿]/g, (ch) => ("│┃║".includes(ch) ? "|" : "─━═".includes(ch) ? "-" : "+"))
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") // ANSI escape codes
    .replace(/[^\n\x20-\x7E¡-ÿ€]/g, "");
}

/** "#rrggbb" → RGB pdf-lib (fallback biru aksen). */
function hexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return C.accent;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Langkah grid "bagus" (1, 2, 2.5, 5 × 10^n). */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${Math.round(v / 100) / 10}k`;
  if (a >= 10 || v === 0) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

class Writer {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  page!: PDFPage;
  y = 0;
  spec: ReportSpec;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, mono: PDFFont, spec: ReportSpec) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.mono = mono;
    this.spec = spec;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_TOP;
  }

  /** true bila kursor masih di awal halaman (belum ada isi). */
  atTop(): boolean {
    return this.y >= PAGE_H - MARGIN_TOP - 0.5;
  }

  /** Sisa ruang vertikal di halaman ini. */
  room(): number {
    return this.y - MARGIN_BOTTOM;
  }

  /** Pindah halaman bila `h` tidak muat (tidak membuat halaman kosong bila sudah di awal). */
  ensure(h: number) {
    if (this.y - h < MARGIN_BOTTOM && !this.atTop()) this.newPage();
  }

  /* ---------- pengukuran (tanpa menggambar) untuk keputusan pindah halaman ---------- */

  headingHeight(text: string, level: 1 | 2 | 3): number {
    const size = level === 1 ? 15 : level === 2 ? 12.5 : 11;
    const gap = level === 1 ? 14 : 10;
    return gap + this.wrap(text, this.bold, size, CONTENT_W).length * size * 1.35 + (level === 1 ? 4 : 0) + 3;
  }

  kvRowHeights(rows: [string, string | number | null | undefined][]): { labelW: number; heights: number[] } {
    const size = 9.5;
    const labelW = Math.min(
      170,
      Math.max(...rows.map(([k]) => this.bold.widthOfTextAtSize(sanitizePdfText(k), size)), 40) + 12,
    );
    const lh = size * 1.35;
    const heights = rows.map(([, v]) => this.wrap(v === null || v === undefined || v === "" ? "-" : String(v), this.font, size, CONTENT_W - labelW).length * lh);
    return { labelW, heights };
  }

  tableLayout(b: Extract<ReportBlock, { type: "table" }>) {
    const size = 8.5;
    const pad = 4;
    const lh = size * 1.3;
    const totalWeight = b.columns.reduce((a, c) => a + (c.width ?? 1), 0) || 1;
    const widths = b.columns.map((c) => ((c.width ?? 1) / totalWeight) * CONTENT_W);
    const rowH = (cells: string[], font: PDFFont) =>
      Math.max(...cells.map((c, i) => Math.min(TABLE_MAX_CELL_LINES, this.wrap(c, font, size, widths[i] - pad * 2).length)), 1) * lh + pad * 2;
    return { size, pad, lh, widths, rowH };
  }

  chartHeight(b: Extract<ReportBlock, { type: "chart" }>): number {
    const plot = b.height ?? 130;
    const captionH = b.caption ? this.wrap(b.caption, this.font, 7.5, CONTENT_W).length * 7.5 * 1.35 + 2 : 0;
    return 18 + plot + 16 + captionH + 10;
  }

  statsHeight(b: Extract<ReportBlock, { type: "stats" }>): number {
    const rows = Math.ceil(b.items.length / STATS_PER_ROW);
    return rows * (STAT_TILE_H + 6) + 4;
  }

  /**
   * Tinggi blok: `full` = seluruh blok, `min` = potongan terkecil yang masih
   * bermakna bila blok harus terbelah (mis. header tabel + baris pertama).
   */
  measure(b: ReportBlock): { full: number; min: number } {
    switch (b.type) {
      case "heading": {
        const h = this.headingHeight(b.text, b.level ?? 1);
        return { full: h, min: h };
      }
      case "text": {
        const size = b.size ?? 9.5;
        const n = this.wrap(b.text, b.bold ? this.bold : this.font, size, CONTENT_W).length;
        return { full: n * size * 1.35 + 3, min: Math.min(n, 2) * size * 1.35 };
      }
      case "kv": {
        const { heights } = this.kvRowHeights(b.rows);
        const full = heights.reduce((a, x) => a + x, 0) + 4;
        return { full, min: (heights[0] ?? 0) + (heights[1] ?? 0) };
      }
      case "table": {
        const L = this.tableLayout(b);
        const head = L.rowH(b.columns.map((c) => c.label), this.bold);
        const rows = b.rows.map((r) => L.rowH(b.columns.map((_, i) => (r[i] === null || r[i] === undefined ? "-" : String(r[i]))), this.font));
        const full = head + (rows.length ? rows.reduce((a, x) => a + x, 0) : L.lh + L.pad * 2) + 8;
        return { full, min: head + (rows[0] ?? L.lh + L.pad * 2) + (rows[1] ?? 0) };
      }
      case "statusStrip": {
        const h = 16 + (b.items.some((i) => i.label) ? 12 : 0) + (b.caption ? 14 : 0) + 6;
        return { full: h, min: h };
      }
      case "code": {
        const lh = 7.5 * 1.3;
        const lines = Math.min(b.maxLines ?? 200, sanitizePdfText(b.text).split("\n").length);
        return { full: lines * lh + 16, min: Math.min(lines, 4) * lh + 10 };
      }
      case "chart": {
        const h = this.chartHeight(b);
        return { full: h, min: h };
      }
      case "stats": {
        const h = this.statsHeight(b);
        return { full: h, min: Math.min(h, STAT_TILE_H + 10) };
      }
      case "spacer":
        return { full: b.size ?? 10, min: 0 };
      case "pageBreak":
        return { full: 0, min: 0 };
    }
  }

  /** Wrap text to lines that fit `width` (word wrap, breaking long words). */
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of sanitizePdfText(text).split("\n")) {
      if (!para) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const cand = line + word;
        if (font.widthOfTextAtSize(cand, size) <= width) {
          line = cand;
          continue;
        }
        if (line.trim()) out.push(line.trimEnd());
        line = word.trimStart();
        // break words longer than the width
        while (line && font.widthOfTextAtSize(line, size) > width) {
          let n = line.length;
          while (n > 1 && font.widthOfTextAtSize(line.slice(0, n), size) > width) n--;
          out.push(line.slice(0, n));
          line = line.slice(n);
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  drawLines(lines: string[], font: PDFFont, size: number, color: RGB, x = MARGIN_X) {
    const lh = size * 1.35;
    for (const l of lines) {
      this.ensure(lh);
      this.page.drawText(l, { x, y: this.y - size, size, font, color });
      this.y -= lh;
    }
  }

  heading(text: string, level: 1 | 2 | 3) {
    const size = level === 1 ? 15 : level === 2 ? 12.5 : 11;
    const gap = level === 1 ? 14 : 10;
    this.ensure(gap + size * 1.35 * 2 + 20); // jaga-jaga; keep-with-next diatur di renderReportPdf
    if (!this.atTop()) this.y -= gap;
    this.drawLines(this.wrap(text, this.bold, size, CONTENT_W), this.bold, size, level === 1 ? C.accent : C.text);
    if (level === 1) {
      this.page.drawLine({ start: { x: MARGIN_X, y: this.y + 2 }, end: { x: PAGE_W - MARGIN_X, y: this.y + 2 }, thickness: 0.8, color: C.line });
      this.y -= 4;
    }
    this.y -= 3;
  }

  text(b: Extract<ReportBlock, { type: "text" }>) {
    const size = b.size ?? 9.5;
    const font = b.bold ? this.bold : this.font;
    this.drawLines(this.wrap(b.text, font, size, CONTENT_W), font, size, b.muted ? C.muted : C.text);
    this.y -= 3;
  }

  kv(rows: [string, string | number | null | undefined][]) {
    const size = 9.5;
    const { labelW, heights } = this.kvRowHeights(rows);
    for (const [ri, [k, v]] of rows.entries()) {
      const lines = this.wrap(v === null || v === undefined || v === "" ? "-" : String(v), this.font, size, CONTENT_W - labelW);
      // satu baris kv (label + seluruh nilainya) tidak dipisah antarhalaman bila muat
      this.ensure(Math.min(heights[ri], CONTENT_H));
      const y0 = this.y;
      this.page.drawText(sanitizePdfText(k), { x: MARGIN_X, y: y0 - size, size, font: this.bold, color: C.muted });
      this.drawLines(lines, this.font, size, C.text, MARGIN_X + labelW);
    }
    this.y -= 4;
  }

  table(b: Extract<ReportBlock, { type: "table" }>) {
    const { size, pad, lh, widths } = this.tableLayout(b);

    const drawRow = (cells: string[], font: PDFFont, bg: RGB | null, color: RGB) => {
      const wrapped = cells.map((c, i) => {
        const w = this.wrap(c, font, size, widths[i] - pad * 2);
        if (w.length <= TABLE_MAX_CELL_LINES) return w;
        const cut = w.slice(0, TABLE_MAX_CELL_LINES);
        cut[cut.length - 1] = `${cut[cut.length - 1].slice(0, Math.max(0, cut[cut.length - 1].length - 3))}...`;
        return cut;
      });
      const h = Math.max(...wrapped.map((w) => w.length), 1) * lh + pad * 2;
      return { wrapped, h, bg, font, color };
    };
    const paint = (r: ReturnType<typeof drawRow>) => {
      if (r.bg) this.page.drawRectangle({ x: MARGIN_X, y: this.y - r.h, width: CONTENT_W, height: r.h, color: r.bg });
      let x = MARGIN_X;
      r.wrapped.forEach((lines, i) => {
        const align = b.columns[i]?.align ?? "left";
        lines.forEach((l, li) => {
          const tw = r.font.widthOfTextAtSize(l, size);
          const tx = align === "right" ? x + widths[i] - pad - tw : align === "center" ? x + (widths[i] - tw) / 2 : x + pad;
          this.page.drawText(l, { x: tx, y: this.y - pad - size - li * lh + 1, size, font: r.font, color: r.color });
        });
        x += widths[i];
      });
      this.y -= r.h;
      this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: PAGE_W - MARGIN_X, y: this.y }, thickness: 0.5, color: C.line });
    };

    const header = drawRow(b.columns.map((c) => c.label), this.bold, C.headBg, C.text);
    const rows = b.rows.map((row, ri) => {
      const st = b.rowStates?.[ri];
      const bg = st === "down" ? C.downTint : st === "partial" ? C.partialTint : null;
      return drawRow(b.columns.map((_, i) => (row[i] === null || row[i] === undefined ? "-" : String(row[i]))), this.font, bg, C.text);
    });
    // header tidak boleh sendirian di dasar halaman: minimal header + baris pertama
    this.ensure(header.h + (rows[0]?.h ?? lh + pad * 2));
    paint(header);
    if (!rows.length) {
      paint(drawRow([sanitizePdfText("Tidak ada data")].concat(b.columns.slice(1).map(() => "")), this.font, null, C.muted));
    }
    rows.forEach((r) => {
      if (this.y - r.h < MARGIN_BOTTOM) {
        this.newPage();
        paint(header); // ulangi header di halaman baru
      }
      paint(r);
    });
    this.y -= 8;
  }

  statusStrip(b: Extract<ReportBlock, { type: "statusStrip" }>) {
    const n = b.items.length;
    if (!n) return;
    const gap = n > 60 ? 0.6 : 1.5;
    const w = Math.max(1, (CONTENT_W - gap * (n - 1)) / n);
    const h = 16;
    const labelSize = 6.5;
    const hasLabels = b.items.some((i) => i.label);
    this.ensure(h + (hasLabels ? 12 : 0) + (b.caption ? 14 : 0) + 6);
    b.items.forEach((it, i) => {
      const x = MARGIN_X + i * (w + gap);
      this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: STATE_COLOR[it.state] });
    });
    this.y -= h;
    if (hasLabels) {
      // draw first, middle and last labels to avoid overlap
      const idx = Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]));
      for (const i of idx) {
        const label = sanitizePdfText(b.items[i]?.label ?? "");
        if (!label) continue;
        const tw = this.font.widthOfTextAtSize(label, labelSize);
        let x = MARGIN_X + i * (w + gap) + w / 2 - tw / 2;
        x = Math.min(Math.max(x, MARGIN_X), PAGE_W - MARGIN_X - tw);
        this.page.drawText(label, { x, y: this.y - labelSize - 3, size: labelSize, font: this.font, color: C.muted });
      }
      this.y -= labelSize + 5;
    }
    if (b.caption) {
      this.y -= 2;
      this.drawLines(this.wrap(b.caption, this.font, 8, CONTENT_W), this.font, 8, C.muted);
    }
    this.y -= 6;
  }

  chart(b: Extract<ReportBlock, { type: "chart" }>) {
    const total = this.chartHeight(b);
    this.ensure(total);
    const plotH = b.height ?? 130;
    const top = this.y;
    const n = b.labels.length;
    const series = b.series.filter((s) => s.values.some((v) => v != null && Number.isFinite(v)));

    // judul + legenda
    const titleSize = 9.5;
    if (b.title) this.page.drawText(sanitizePdfText(b.title), { x: MARGIN_X, y: top - titleSize, size: titleSize, font: this.bold, color: C.text });
    let lx = PAGE_W - MARGIN_X;
    for (const s of [...series].reverse()) {
      const name = sanitizePdfText(s.name);
      const tw = this.font.widthOfTextAtSize(name, 7.5);
      lx -= tw;
      this.page.drawText(name, { x: lx, y: top - 8.5, size: 7.5, font: this.font, color: C.muted });
      lx -= 11;
      this.page.drawRectangle({ x: lx, y: top - 8.5, width: 8, height: 6, color: hexColor(s.color) });
      lx -= 8;
    }

    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
    const axisW = 40;
    const px = MARGIN_X + axisW;
    const pw = CONTENT_W - axisW;
    const py = top - 18 - plotH; // dasar area plot
    this.page.drawRectangle({ x: px, y: py, width: pw, height: plotH, color: rgb(0.985, 0.988, 0.992) });

    if (!all.length || !n) {
      const msg = "Tidak ada data";
      this.page.drawText(msg, { x: px + pw / 2 - this.font.widthOfTextAtSize(msg, 8.5) / 2, y: py + plotH / 2 - 3, size: 8.5, font: this.font, color: C.muted });
    } else {
      const zero = b.zeroBased !== false;
      let lo = zero ? Math.min(0, ...all) : Math.min(...all);
      let hi = Math.max(...all);
      if (hi === lo) {
        hi = hi + (Math.abs(hi) || 1);
        if (!zero) lo = lo - 1;
      }
      const step = niceStep((hi - lo) / 4);
      hi = Math.ceil(hi / step) * step;
      lo = zero ? Math.min(0, Math.floor(lo / step) * step) : Math.floor(lo / step) * step;
      const yOf = (v: number) => py + ((v - lo) / (hi - lo)) * plotH;

      // grid + label sumbu Y
      for (let v = lo; v <= hi + step / 2; v += step) {
        const y = yOf(v);
        this.page.drawLine({ start: { x: px, y }, end: { x: px + pw, y }, thickness: 0.4, color: C.line });
        const label = fmtAxis(v);
        this.page.drawText(label, { x: px - 4 - this.font.widthOfTextAtSize(label, 6.5), y: y - 2.2, size: 6.5, font: this.font, color: C.muted });
      }
      if (b.unit) {
        const u = sanitizePdfText(b.unit);
        this.page.drawText(u, { x: MARGIN_X, y: py + plotH + 3, size: 6.5, font: this.font, color: C.muted });
      }

      if (b.chart === "bar") {
        const gw = pw / n;
        const k = series.length;
        const bw = Math.max(0.6, Math.min(18, (gw * 0.78) / k));
        series.forEach((s, si) => {
          const col = hexColor(s.color);
          s.values.forEach((v, i) => {
            if (v == null || !Number.isFinite(v)) return;
            const x = px + i * gw + (gw - bw * k) / 2 + si * bw;
            const y0 = yOf(Math.max(lo, 0));
            const y1 = yOf(v);
            this.page.drawRectangle({ x, y: Math.min(y0, y1), width: bw * 0.92, height: Math.max(0.4, Math.abs(y1 - y0)), color: col });
          });
        });
      } else {
        const xOf = (i: number) => (n === 1 ? px + pw / 2 : px + 4 + (i / (n - 1)) * (pw - 8));
        for (const s of series) {
          const col = hexColor(s.color);
          let prev: { x: number; y: number } | null = null;
          s.values.forEach((v, i) => {
            if (v == null || !Number.isFinite(v)) {
              prev = null; // celah data: putus garis
              return;
            }
            const pt = { x: xOf(i), y: yOf(v) };
            if (prev) this.page.drawLine({ start: prev, end: pt, thickness: 1.2, color: col });
            if (n <= 45) this.page.drawCircle({ x: pt.x, y: pt.y, size: 1.5, color: col });
            prev = pt;
          });
        }
      }
    }

    // label sumbu X (maks ~10, tanpa tumpang tindih)
    if (n) {
      const maxLabels = Math.max(2, Math.floor(pw / 52));
      const every = Math.max(1, Math.ceil(n / maxLabels));
      const gw = pw / n;
      let lastRight = -Infinity;
      for (let i = 0; i < n; i += every) {
        const label = sanitizePdfText(b.labels[i] ?? "");
        if (!label) continue;
        const tw = this.font.widthOfTextAtSize(label, 6.5);
        const cx = b.chart === "bar" ? px + i * gw + gw / 2 : n === 1 ? px + pw / 2 : px + 4 + (i / (n - 1)) * (pw - 8);
        let x = cx - tw / 2;
        x = Math.min(Math.max(x, px), px + pw - tw);
        if (x < lastRight + 4) continue;
        this.page.drawText(label, { x, y: py - 10, size: 6.5, font: this.font, color: C.muted });
        lastRight = x + tw;
      }
    }
    this.y = py - 16;
    if (b.caption) this.drawLines(this.wrap(b.caption, this.font, 7.5, CONTENT_W), this.font, 7.5, C.muted);
    this.y -= 10;
  }

  stats(b: Extract<ReportBlock, { type: "stats" }>) {
    if (!b.items.length) return;
    const gap = 6;
    const perRow = Math.min(STATS_PER_ROW, b.items.length);
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
    for (let r = 0; r < b.items.length; r += perRow) {
      this.ensure(STAT_TILE_H + gap);
      b.items.slice(r, r + perRow).forEach((it, i) => {
        const x = MARGIN_X + i * (w + gap);
        const yTop = this.y;
        this.page.drawRectangle({ x, y: yTop - STAT_TILE_H, width: w, height: STAT_TILE_H, color: C.headBg });
        const tone = it.tone === "good" ? C.up : it.tone === "bad" ? C.down : it.tone === "warn" ? C.partial : C.accent;
        this.page.drawRectangle({ x, y: yTop - STAT_TILE_H, width: 2.5, height: STAT_TILE_H, color: tone });
        const fit = (t: string, f: PDFFont, sz: number) => {
          let v = sanitizePdfText(t);
          while (v.length > 3 && f.widthOfTextAtSize(v, sz) > w - 14) v = v.slice(0, -4) + "...";
          return v;
        };
        this.page.drawText(fit(it.label, this.font, 7.5), { x: x + 8, y: yTop - 12, size: 7.5, font: this.font, color: C.muted });
        this.page.drawText(fit(it.value, this.bold, 13), { x: x + 8, y: yTop - 28, size: 13, font: this.bold, color: C.text });
        if (it.sub) this.page.drawText(fit(it.sub, this.font, 6.8), { x: x + 8, y: yTop - 39, size: 6.8, font: this.font, color: C.muted });
      });
      this.y -= STAT_TILE_H + gap;
    }
    this.y -= 4;
  }

  code(b: Extract<ReportBlock, { type: "code" }>) {
    const size = 7.5;
    const lh = size * 1.3;
    const pad = 5;
    const charW = this.mono.widthOfTextAtSize("M", size);
    const perLine = Math.max(10, Math.floor((CONTENT_W - pad * 2) / charW));
    const lines: string[] = [];
    for (const raw of sanitizePdfText(b.text).split("\n")) {
      if (!raw) lines.push("");
      for (let i = 0; i < raw.length; i += perLine) lines.push(raw.slice(i, i + perLine));
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const max = b.maxLines ?? 200;
    if (lines.length > max) {
      const cut = lines.length - max;
      lines.splice(max);
      lines.push(`... (${cut} baris lagi dipotong)`);
    }
    if (!lines.length) lines.push("(kosong)");

    let i = 0;
    while (i < lines.length) {
      this.ensure(lh + pad * 2);
      const fit = Math.max(1, Math.floor((this.y - MARGIN_BOTTOM - pad * 2) / lh));
      const chunk = lines.slice(i, i + fit);
      const h = chunk.length * lh + pad * 2;
      this.page.drawRectangle({ x: MARGIN_X, y: this.y - h, width: CONTENT_W, height: h, color: C.codeBg, borderColor: C.line, borderWidth: 0.5 });
      chunk.forEach((l, li) => {
        this.page.drawText(l, { x: MARGIN_X + pad, y: this.y - pad - size - li * lh + 1, size, font: this.mono, color: C.text });
      });
      this.y -= h;
      i += chunk.length;
      if (i < lines.length) this.newPage();
    }
    this.y -= 6;
  }
}

/** Format a date in a timezone as "dd/mm/yyyy HH:MM" (id-ID). */
export function formatPdfDate(d: Date | string | null | undefined, timezone = "Asia/Jakarta", withSeconds = false): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}

/**
 * Ruang minimum yang harus tersedia sebelum blok mulai digambar. Blok kecil
 * (dan kv/grafik/statistik yang muat satu halaman) dipindah utuh; blok besar
 * cukup potongan pertamanya (mis. header tabel + 2 baris) agar tidak "yatim".
 */
function placeNeed(w: Writer, b: ReportBlock): number {
  const m = w.measure(b);
  const whole = m.full <= KEEP_TOGETHER_MAX || b.type === "chart" || b.type === "stats" || b.type === "kv" || b.type === "statusStrip";
  return whole && m.full <= CONTENT_H ? m.full : m.min;
}

/** Render a report spec to PDF bytes. */
export async function renderReportPdf(spec: ReportSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const tz = spec.timezone || "Asia/Jakarta";
  const generatedAt = spec.generatedAt ?? new Date();
  doc.setTitle(sanitizePdfText(spec.title));
  doc.setProducer("Depanel");
  doc.setCreator("Depanel");
  doc.setCreationDate(generatedAt);

  const [font, bold, mono] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Courier),
  ]);
  const w = new Writer(doc, font, bold, mono, spec);
  w.newPage();

  // title block
  w.drawLines(w.wrap(spec.title, bold, 18, CONTENT_W), bold, 18, C.text);
  if (spec.subtitle) w.drawLines(w.wrap(spec.subtitle, font, 10, CONTENT_W), font, 10, C.muted);
  w.drawLines([`Dibuat: ${formatPdfDate(generatedAt, tz)} (${tz})`], font, 8.5, C.muted);
  w.y -= 4;
  w.page.drawLine({ start: { x: MARGIN_X, y: w.y }, end: { x: PAGE_W - MARGIN_X, y: w.y }, thickness: 1.2, color: C.accent });
  w.y -= 6;

  const blocks = spec.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // ── keputusan pindah halaman sebelum menggambar ──
    if (b.type === "heading") {
      // heading tidak boleh tertinggal sendirian di dasar halaman: bawa bersama
      // heading berikutnya (bila bertingkat) dan potongan pertama blok isinya.
      let need = w.measure(b).full;
      for (let j = i + 1; j < blocks.length; j++) {
        const nb = blocks[j];
        if (nb.type === "spacer" || nb.type === "pageBreak") break;
        if (nb.type === "heading") {
          need += w.measure(nb).full;
          continue;
        }
        need += placeNeed(w, nb);
        break;
      }
      if (need <= CONTENT_H) w.ensure(need);
    } else if (b.type !== "spacer" && b.type !== "pageBreak") {
      w.ensure(placeNeed(w, b));
    }

    switch (b.type) {
      case "heading":
        w.heading(b.text, b.level ?? 1);
        break;
      case "text":
        w.text(b);
        break;
      case "kv":
        w.kv(b.rows);
        break;
      case "table":
        w.table(b);
        break;
      case "statusStrip":
        w.statusStrip(b);
        break;
      case "code":
        w.code(b);
        break;
      case "chart":
        w.chart(b);
        break;
      case "stats":
        w.stats(b);
        break;
      case "spacer":
        // spacer di awal halaman tidak perlu (hindari celah kosong di atas)
        if (!w.atTop()) w.y -= b.size ?? 10;
        if (w.y < MARGIN_BOTTOM) w.newPage();
        break;
      case "pageBreak":
        if (!w.atTop()) w.newPage();
        break;
    }
  }

  // footer with page numbers
  const pages = doc.getPages();
  const footer = sanitizePdfText(spec.footer ?? "Depanel");
  const title = sanitizePdfText(spec.title);
  pages.forEach((p, i) => {
    const label = `Halaman ${i + 1} / ${pages.length}`;
    p.drawLine({ start: { x: MARGIN_X, y: 32 }, end: { x: PAGE_W - MARGIN_X, y: 32 }, thickness: 0.5, color: C.line });
    let left = `${footer} - ${title}`;
    while (left.length > 4 && font.widthOfTextAtSize(left, 7.5) > CONTENT_W - 90) left = left.slice(0, -4) + "...";
    p.drawText(left, { x: MARGIN_X, y: 20, size: 7.5, font, color: C.muted });
    p.drawText(label, { x: PAGE_W - MARGIN_X - font.widthOfTextAtSize(label, 7.5), y: 20, size: 7.5, font, color: C.muted });
  });

  return doc.save();
}

/** Build a safe ASCII filename like "laporan-health-check-2026-11-18.pdf". */
export function pdfFilename(base: string, date: Date = new Date(), timezone = "Asia/Jakarta"): string {
  const day = date.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD
  const slug = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "laporan";
  return `${slug}-${day}.pdf`;
}

/** Wrap PDF bytes in a download Response (works for Next.js route handlers). */
export function pdfResponse(bytes: Uint8Array, filename: string, inline = false): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}
