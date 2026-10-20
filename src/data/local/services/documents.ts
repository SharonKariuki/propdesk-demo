/**
 * File generators for downloads — CSV, XLSX and PDF — built in the browser so
 * the demo needs no server. Deliberately small: a text-and-tables PDF writer
 * (standard Helvetica, no embedding) and an XLSX writer over a stored
 * (uncompressed) zip. Good enough to open in any viewer or spreadsheet.
 */

// ─── CSV ─────────────────────────────────────────────────────────────────────
/** Cells starting with = + - @ are neutralised so a spreadsheet never runs them. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvBlob(header: string[], rows: unknown[][]): Blob {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], { type: "text/csv" });
}

// ─── ZIP (store only) ────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const c of all) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

// ─── XLSX ────────────────────────────────────────────────────────────────────
const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(index: number) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function xlsxBlob(sheetName: string, rows: unknown[][]): Blob {
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
      if (value === null || value === undefined || value === "") return "";
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
    });
    return `<row r="${r + 1}">${cells.join("")}</row>`;
  });
  const safeName = xml(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1");
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join("")}</sheetData></worksheet>`,
    },
  ];
  return new Blob([zip(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
export interface PdfTable {
  columns: { label: string; align?: "left" | "right" }[];
  rows: string[][];
  footer?: string[];
}

export interface PdfSection {
  heading?: string;
  lines?: string[];
  /** Label/value pairs printed as two columns. */
  pairs?: [string, string][];
  table?: PdfTable;
}

export interface PdfSpec {
  title: string;
  subtitle?: string[];
  sections: PdfSection[];
  footnote?: string;
}

/** Map to WinAnsi-safe text; the standard fonts cannot draw most of Unicode. */
function pdfText(s: string) {
  const mapped = s
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/·/g, "·")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
  return mapped.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const approxWidth = (text: string, size: number) => text.length * size * 0.52;

function fit(text: string, width: number, size: number) {
  if (approxWidth(text, size) <= width) return text;
  const max = Math.max(1, Math.floor(width / (size * 0.52)) - 1);
  return `${text.slice(0, max)}…`;
}

export function pdfBlob(spec: PdfSpec): Blob {
  const wide = spec.sections.some((s) => (s.table?.columns.length ?? 0) > 6);
  const W = wide ? 842 : 595;
  const H = wide ? 595 : 842;
  const M = 40;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;

  const text = (x: number, yy: number, s: string, size = 10, bold = false) =>
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfText(s)}) Tj ET`);
  const rule = (yy: number, weight = 0.5) =>
    ops.push(`${weight} w 0.75 G ${M} ${yy.toFixed(1)} m ${W - M} ${yy.toFixed(1)} l S 0 G`);
  const newPage = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = H - M;
  };
  const ensure = (needed: number) => {
    if (y - needed < M + 20) newPage();
  };

  text(M, y - 4, spec.title, 16, true);
  y -= 24;
  for (const sub of spec.subtitle ?? []) {
    text(M, y, sub, 9);
    y -= 13;
  }
  text(M, y, `Demo data - generated ${new Date().toLocaleString("en-GB")}`, 7);
  y -= 10;
  rule(y);
  y -= 16;

  for (const section of spec.sections) {
    if (section.heading) {
      ensure(30);
      text(M, y, section.heading, 11, true);
      y -= 16;
    }
    for (const line of section.lines ?? []) {
      ensure(14);
      text(M, y, fit(line, W - 2 * M, 9), 9);
      y -= 13;
    }
    for (const [label, value] of section.pairs ?? []) {
      ensure(14);
      text(M, y, label, 9);
      const v = fit(value, (W - 2 * M) / 2, 9);
      text(W - M - approxWidth(v, 9), y, v, 9, true);
      y -= 14;
    }
    const table = section.table;
    if (table) {
      const size = table.columns.length > 8 ? 7 : 8;
      const all = [table.columns.map((c) => c.label), ...table.rows, ...(table.footer ? [table.footer] : [])];
      const weights = table.columns.map((_, i) => Math.max(4, Math.min(40, ...[Math.max(...all.map((r) => String(r[i] ?? "").length))])));
      const total = weights.reduce((s, w) => s + w, 0);
      const widths = weights.map((w) => ((W - 2 * M) * w) / total);
      const drawRow = (cells: string[], bold: boolean) => {
        let x = M;
        cells.forEach((cell, i) => {
          const w = widths[i];
          const value = fit(String(cell ?? ""), w - 6, size);
          const right = table.columns[i]?.align === "right";
          text(right ? x + w - 3 - approxWidth(value, size) : x + 2, y, value, size, bold);
          x += w;
        });
        y -= size + 6;
      };
      ensure(30);
      drawRow(table.columns.map((c) => c.label), true);
      rule(y + size + 2);
      for (const row of table.rows) {
        if (y - (size + 6) < M + 20) {
          newPage();
          drawRow(table.columns.map((c) => c.label), true);
          rule(y + size + 2);
        }
        drawRow(row, false);
      }
      if (table.footer) {
        ensure(20);
        rule(y + size + 3);
        drawRow(table.footer, true);
      }
      y -= 8;
    }
    y -= 6;
  }
  if (spec.footnote) {
    ensure(20);
    text(M, y, fit(spec.footnote, W - 2 * M, 7), 7);
  }
  pages.push(ops.join("\n"));

  // Assemble: 1 catalog, 2 pages, 3 F1, 4 F2, then page/content pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    const bytes = latin1(content);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${bytes.length} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = latin1(out).length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = latin1(out).length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new Blob([latin1(out) as BlobPart], { type: "application/pdf" });
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i] = code < 256 ? code : 63;
  }
  return out;
}

// ─── Shared export (Reports / Accounting) ────────────────────────────────────
export interface ExportColumn {
  key: string;
  label: string;
  kind: "money" | "number" | "text";
}

export interface ExportSpec {
  format: "csv" | "xlsx" | "pdf";
  title: string;
  filename: string;
  subtitle?: string[];
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  footer?: Record<string, unknown>;
}

const kesFmt = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cellText(col: ExportColumn, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (col.kind === "money" && Number.isFinite(Number(value))) {
    const n = Number(value);
    return n < 0 ? `(${kesFmt.format(-n)})` : kesFmt.format(n);
  }
  return String(value);
}

/** One table, any format — the body of POST /reports/export/. */
export function exportTable(spec: ExportSpec): { blob: Blob; filename: string } {
  const base = (spec.filename || "report").replace(/[^\w.-]+/g, "-");
  const header = spec.columns.map((c) => c.label);
  const raw = (row: Record<string, unknown>) =>
    spec.columns.map((c) => {
      const v = row[c.key];
      return c.kind !== "text" && v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : v ?? "";
    });
  const rows = spec.rows.map(raw);
  const footer = spec.footer ? raw(spec.footer) : null;
  if (spec.format === "csv") {
    return { blob: csvBlob(header, footer ? [...rows, footer] : rows), filename: `${base}.csv` };
  }
  if (spec.format === "xlsx") {
    const meta = [[spec.title], ...(spec.subtitle ?? []).map((s) => [s]), []];
    return { blob: xlsxBlob(spec.title, [...meta, header, ...rows, ...(footer ? [footer] : [])]), filename: `${base}.xlsx` };
  }
  const blob = pdfBlob({
    title: spec.title,
    subtitle: spec.subtitle,
    sections: [{
      table: {
        columns: spec.columns.map((c) => ({ label: c.label, align: c.kind === "text" ? "left" : "right" })),
        rows: spec.rows.map((r) => spec.columns.map((c) => cellText(c, r[c.key]))),
        footer: spec.footer ? spec.columns.map((c) => cellText(c, spec.footer![c.key])) : undefined,
      },
    }],
  });
  return { blob, filename: `${base}.pdf` };
}
