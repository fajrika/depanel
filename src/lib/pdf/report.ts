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
  | { type: "spacer"; size?: number }
  | { type: "pageBreak" };

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

  ensure(h: number) {
    if (this.y - h < MARGIN_BOTTOM) this.newPage();
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
    this.ensure(gap + size * 1.35 * 2 + 20); // keep heading with following content
    this.y -= gap;
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
    const labelW = Math.min(
      170,
      Math.max(...rows.map(([k]) => this.bold.widthOfTextAtSize(sanitizePdfText(k), size)), 40) + 12,
    );
    for (const [k, v] of rows) {
      const lines = this.wrap(v === null || v === undefined || v === "" ? "-" : String(v), this.font, size, CONTENT_W - labelW);
      const lh = size * 1.35;
      this.ensure(lh * Math.min(lines.length, 3));
      const y0 = this.y;
      this.page.drawText(sanitizePdfText(k), { x: MARGIN_X, y: y0 - size, size, font: this.bold, color: C.muted });
      this.drawLines(lines, this.font, size, C.text, MARGIN_X + labelW);
    }
    this.y -= 4;
  }

  table(b: Extract<ReportBlock, { type: "table" }>) {
    const size = 8.5;
    const pad = 4;
    const lh = size * 1.3;
    const totalWeight = b.columns.reduce((a, c) => a + (c.width ?? 1), 0);
    const widths = b.columns.map((c) => ((c.width ?? 1) / totalWeight) * CONTENT_W);

    const drawRow = (cells: string[], font: PDFFont, bg: RGB | null, color: RGB) => {
      const wrapped = cells.map((c, i) => this.wrap(c, font, size, widths[i] - pad * 2).slice(0, 8));
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
    this.ensure(header.h + lh * 2 + pad * 2);
    paint(header);
    if (!b.rows.length) {
      paint(drawRow([sanitizePdfText("Tidak ada data")].concat(b.columns.slice(1).map(() => "")), this.font, null, C.muted));
    }
    b.rows.forEach((row, ri) => {
      const st = b.rowStates?.[ri];
      const bg = st === "down" ? C.downTint : st === "partial" ? C.partialTint : null;
      const r = drawRow(b.columns.map((_, i) => (row[i] === null || row[i] === undefined ? "-" : String(row[i]))), this.font, bg, C.text);
      if (this.y - r.h < MARGIN_BOTTOM) {
        this.newPage();
        paint(header); // repeat header on the new page
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

  for (const b of spec.blocks) {
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
      case "spacer":
        w.y -= b.size ?? 10;
        break;
      case "pageBreak":
        w.newPage();
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
