"use strict";
// Reads an EIL "P & ID INDEX" PDF (Format No. 3-7941-1039 / 3-0241-1039) as issued by Process:
//   header : Document No., Rev. No., Page x of y, JOB NO., UNIT NO. (e.g. "101 (1130 Section)"), DATE OF ISSUE
//   table  : Drawing No. | Drawing Description | Revision No./ Date  (pairs: "3 13.05.25 | 4 27.08.25 | …")
// Verified on four real B862 / 101 indexes (2026-10-22). Layout quirks handled:
//   - descriptions wrapped over 2–3 lines, some ABOVE the drawing-number line
//   - revision history wrapped onto a second line below the drawing number
//   - multi-page indexes (header repeated on every page)
//   - hand-struck revisions: the strike is a drawing, not text, so they show up as a revision with
//     no date — reported as a warning and NOT counted, never guessed.
// Native vector PDFs only (no OCR), same pdfjs text extraction as isoPdfParser / pidTitleBlockParser.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parsePdf } = require("./isoPdfParser");
const { parsePidName } = require("../utils/pidNameParser");
const { revisionSortKey } = require("../utils/pidRevisionOrder");

const DRAWING_RE = /^[A-Z0-9]+-\d{2}-\d{2}-[0-9A-Z]+-[0-9A-Z]+(?:-[0-9A-Z]+)?$/i; // JOB-XX-XX-UNIT-SERIAL[-n]
const REV_RE = /^(?:[A-Z]|\d{1,2})$/i;
const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;

// "13.05.25" / "15.07.2026" → "2025-05-13" (null if not a real date)
function toIsoDate(s) {
  const m = String(s || "").trim().match(DATE_RE);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const norm = (s) => s.replace(/\s+/g, " ").trim().toUpperCase();
const find = (items, label) => items.find((i) => norm(i.str) === label);

// Value on the same line, right of a label (within a few px vertically)
function rightOf(items, label, maxDx = 200) {
  if (!label) return null;
  return items
    .filter((i) => i !== label && Math.abs(i.top - label.top) <= 4 && i.x > label.x && i.x - label.x <= maxDx)
    .sort((a, b) => a.x - b.x)[0] || null;
}
// Value directly below a label (Document No. sits under its label)
function below(items, label) {
  if (!label) return null;
  return items
    .filter((i) => i.top > label.top && i.top - label.top <= 18 && Math.abs(i.x - label.x) <= 20)
    .sort((a, b) => a.top - b.top)[0] || null;
}

function parsePage(page) {
  // top-down coordinates; pdfjs y is measured from the bottom of the page
  const items = page.items.map((i) => ({ ...i, top: -i.y }));
  const warnings = [];

  const header = {};
  const docNoLabel = find(items, "DOCUMENT NO.");
  header.documentNo = below(items, docNoLabel)?.str || null;
  header.documentRev = rightOf(items, find(items, "REV. NO."), 80)?.str || null;
  const pageLabel = find(items, "PAGE");
  if (pageLabel) {
    const nums = items.filter((i) => Math.abs(i.top - pageLabel.top) <= 4 && i.x > pageLabel.x && /^\d+$/.test(i.str))
      .sort((a, b) => a.x - b.x);
    header.pageNo = nums[0] ? +nums[0].str : null;
    header.pageCount = nums[1] ? +nums[1].str : null;
  }
  header.jobNo = rightOf(items, find(items, "JOB NO."), 120)?.str || null;
  header.unitLabel = rightOf(items, find(items, "UNIT NO."), 150)?.str || null;
  header.unitNo = header.unitLabel ? (header.unitLabel.match(/^\s*([0-9A-Z]+)/i) || [])[1] || null : null;
  header.dateOfIssue = rightOf(items, find(items, "DATE OF ISSUE"), 150)?.str || null;

  // Table band: from the column headings down to "DATE OF ISSUE" / "NOTES:"
  const hDrawing = find(items, "DRAWING NO.");
  const hDesc = find(items, "DRAWING DESCRIPTION");
  const hRev = items.find((i) => norm(i.str).startsWith("REVISION NO."));
  if (!hDrawing || !hDesc || !hRev) {
    return { header, rows: [], warnings: [`Page ${page.pageNo}: not an EIL P&ID index table (column headings not found)`] };
  }
  const tableTop = Math.max(hDrawing.top, hDesc.top, hRev.top) + 6;
  const ends = items.filter((i) => ["DATE OF ISSUE", "NOTES:"].includes(norm(i.str))).map((i) => i.top);
  const tableBottom = ends.length ? Math.min(...ends) - 4 : Infinity;
  // Column boundaries half-way between the headings' left edges (headings are roughly centred)
  const descLeft = hDrawing.x + (hDesc.x - hDrawing.x) * 0.55;
  const revLeft = hRev.x - 60;

  const body = items.filter((i) => i.top > tableTop && i.top < tableBottom);
  const anchors = body.filter((i) => i.x < descLeft && DRAWING_RE.test(i.str)).sort((a, b) => a.top - b.top);
  const stray = body.filter((i) => i.x < descLeft && !DRAWING_RE.test(i.str));
  for (const s of stray) warnings.push(`Page ${page.pageNo}: unreadable entry in the Drawing No. column: "${s.str}"`);

  const rows = anchors.map((a) => ({ pidName: a.str, page: page.pageNo, top: a.top, desc: [], rev: [], warnings: [] }));
  if (!rows.length) return { header, rows, warnings };

  for (const it of body) {
    if (it.x < descLeft) continue;
    if (it.x >= revLeft) {
      // revision history wraps DOWNWARD: belongs to the last drawing at or above it
      let target = null;
      for (const r of rows) if (r.top <= it.top + 4) target = r;
      (target || rows[0]).rev.push(it);
    } else {
      // descriptions wrap both ways around their drawing number: nearest drawing line (tie → the one above)
      let best = null, bestD = Infinity;
      for (const r of rows) {
        const d = Math.abs(r.top - it.top);
        if (d < bestD || (d === bestD && r.top < it.top)) { best = r; bestD = d; }
      }
      best.desc.push(it);
    }
  }

  for (const r of rows) {
    r.description = r.desc.sort((a, b) => a.top - b.top || a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    // revision tokens in reading order: line by line, left to right
    const toks = r.rev.sort((a, b) => (Math.abs(a.top - b.top) <= 4 ? a.x - b.x : a.top - b.top)).map((i) => i.str);
    r.revisions = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (REV_RE.test(t) && toks[k + 1] && DATE_RE.test(toks[k + 1])) {
        const date = toIsoDate(toks[k + 1]);
        if (!date) r.warnings.push(`Revision ${t}: "${toks[k + 1]}" is not a valid date — revision not counted`);
        else r.revisions.push({ rev: t.toUpperCase(), date });
        k++;
      } else if (REV_RE.test(t)) {
        r.warnings.push(`Revision ${t} has no date (possibly struck out on the index) — not counted`);
      } else if (DATE_RE.test(t)) {
        r.warnings.push(`Date ${t} has no revision number — not counted`);
      } else {
        r.warnings.push(`Unexpected text in the revision column: "${t}"`);
      }
    }
    // revisions must run in order (A < … < Z < 0 < 1 …); out-of-order means the layout was misread
    for (let k = 1; k < r.revisions.length; k++) {
      const p = revisionSortKey(r.revisions[k - 1].rev), c = revisionSortKey(r.revisions[k].rev);
      if (p != null && c != null && c <= p) { r.warnings.push(`Revisions are out of order (${r.revisions.map((x) => x.rev).join(", ")}) — check this row`); break; }
    }
    if (!r.description) r.warnings.push("No description found");
    if (!r.revisions.length) r.warnings.push("No revision found");
    delete r.desc; delete r.rev; delete r.top;
  }
  return { header, rows, warnings };
}

// Parse a P&ID index PDF from a buffer. Returns { ok, header, rows, warnings } or { ok:false, error }.
async function parsePidIndexPdf(buffer) {
  const tmp = path.join(os.tmpdir(), `pid-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  fs.writeFileSync(tmp, buffer);
  let parsed;
  try { parsed = await parsePdf(tmp); }
  catch (err) { return { ok: false, error: `Could not read the PDF: ${err.message}` }; }
  finally { fs.rmSync(tmp, { force: true }); }

  const pages = parsed.pages.map(parsePage);
  const header = { ...pages[0].header, pages: parsed.pageCount };
  const warnings = pages.flatMap((p) => p.warnings);
  // the header is repeated on every page — it must agree
  for (const p of pages.slice(1)) {
    for (const k of ["documentNo", "jobNo", "unitNo"]) {
      if (p.header[k] && header[k] && p.header[k] !== header[k]) warnings.push(`Page ${p.header.pageNo}: ${k} "${p.header[k]}" differs from page 1 ("${header[k]}")`);
    }
  }
  const rows = pages.flatMap((p) => p.rows);
  if (!rows.length) {
    return { ok: false, error: "No P&ID drawing numbers found. Is this an EIL \"P & ID INDEX\" PDF (Drawing No. / Drawing Description / Revision No./ Date)?" };
  }
  header.dateOfIssueIso = toIsoDate(header.dateOfIssue);
  return { ok: true, header, rows, warnings };
}

module.exports = { parsePidIndexPdf, toIsoDate, DATE_RE };
