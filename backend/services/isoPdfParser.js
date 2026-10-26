"use strict";
const fs   = require("fs");
const path = require("path");
const url  = require("url");

// ── pdfjs-dist (ESM) — loaded once, cached ───────────────────────────────────
let _pdfjs = null;
async function getPdfJs() {
  if (!_pdfjs) {
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Point to the bundled worker file using a proper file:// URL (required on Windows)
    lib.GlobalWorkerOptions.workerSrc = url.pathToFileURL(
      path.resolve(__dirname, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")
    ).href;
    _pdfjs = lib;
  }
  return _pdfjs;
}

// ── Patterns ──────────────────────────────────────────────────────────────────
// Full ISO piping tag: {size}"-{service}-{unitNo}-{seqNo}-{spec}-{insulType}-{zone}
// e.g.  8"-P-111-40201-B1A-NI-B   or   1.5"-F-201-10023-A11A-HI-A
const ISO_TAG_RE = /^(\d+(?:[./]\d+)?)"- ?([A-Z]+)-(\d+)-(\d+)-([A-Z0-9]+)-([A-Z]+)-([A-Z]{1,2})$/i;

// System line_no decomposition: {service}-{unitNo}-{seqNo}[-{subline}]-{zone}
// ISOGEN's printed ISO_TAG_RE tag has NO subline slot, so coreId comparisons
// against the PDF tag must strip an optional subline along with the zone —
// otherwise every subline'd line falsely fails the core-ID match below.
const SYS_CORE_RE = /^([A-Za-z]+)-(\d+)-(\w+?)(?:-([A-Za-z0-9]{1,3}))?-([A-Za-z]{1,2})$/i;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a PDF file and extract structured text content.
 * Returns: { ok, pageCount, pages:[{pageNo, items:[{str,x,y,w,h}]}], metadata, hash }
 */
async function parsePdf(filePath) {
  const pdfjsLib  = await getPdfJs();
  const fileBuffer = fs.readFileSync(filePath);
  const data       = new Uint8Array(fileBuffer);

  const pdf       = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
  const pageCount  = pdf.numPages;
  const pages      = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page        = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const items = textContent.items
      .filter(i => i.str && i.str.trim().length > 0)
      .map(i => ({
        str: i.str.trim(),
        x:   Math.round(i.transform[4]),
        y:   Math.round(i.transform[5]),
        w:   Math.round(i.width  || 0),
        h:   Math.round(i.height || 0),
      }));

    pages.push({ pageNo: pageNum, items });
  }

  let metadata = {};
  try {
    const meta = await pdf.getMetadata();
    metadata = {
      title:        meta.info?.Title        || null,
      creator:      meta.info?.Creator      || null,
      producer:     meta.info?.Producer     || null,
      creationDate: meta.info?.CreationDate || null,
    };
  } catch (_) {}

  return { ok: true, pageCount, pages, metadata };
}

/**
 * Search all pages for the line number stored in the system.
 * Returns: { found, extractedText, parsed }
 *
 * parsed is populated when a full ISO tag is found and decoded:
 *   { rawTag, size, sizeNum, service, unitNo, seqNo, spec, insulType, zone }
 * parsed is null when found only via plain text match (fallback path).
 *
 * Strategy:
 *   1. Scan every token for a full ISO piping tag whose coreId matches the system line_no
 *   2. Exact token match against system line_no (fallback)
 *   3. Substring match in concatenated page text (fallback)
 */
function extractLineNo(pages, candidateLineNo) {
  if (!candidateLineNo) return { found: false, extractedText: null, parsed: null };

  const needle   = candidateLineNo.trim();
  const needleLc = needle.toLowerCase();

  // Derive coreId from system line_no: strip trailing zone AND optional subline
  // P-111-40201-B → coreId = P-111-40201
  // TRM-111-VV1227-VS-A → coreId = TRM-111-VV1227  (subline "VS" dropped — ISOGEN tags never carry it)
  const sysCoreM  = SYS_CORE_RE.exec(needle);
  const sysCoreId = (sysCoreM ? `${sysCoreM[1]}-${sysCoreM[2]}-${sysCoreM[3]}` : needle).toLowerCase();

  // ── Pass 1: find a full ISO tag token whose coreId matches ───────────────
  for (const page of pages) {
    for (const item of page.items) {
      const m = ISO_TAG_RE.exec(item.str);
      if (!m) continue;
      const [, rawSize, service, unitNo, seqNo, spec, insulType, zone] = m;
      const pdfCoreId = `${service}-${unitNo}-${seqNo}`.toLowerCase();
      if (pdfCoreId === sysCoreId) {
        return {
          found:         true,
          extractedText: item.str,
          parsed: {
            rawTag:    item.str,
            size:      rawSize + '"',
            sizeNum:   _normSize(rawSize),
            service:   service.toUpperCase(),
            unitNo,
            seqNo,
            spec:      spec.toUpperCase(),
            insulType: insulType.toUpperCase(),
            zone:      zone.toUpperCase(),
          },
        };
      }
    }
  }

  // ── Pass 2: exact token match or substring in page text (fallback) ───────
  for (const page of pages) {
    for (const item of page.items) {
      if (item.str.toLowerCase() === needleLc) {
        return { found: true, extractedText: item.str, parsed: null };
      }
    }
    const pageText = page.items.map(i => i.str).join(" ");
    if (pageText.toLowerCase().includes(needleLc)) {
      return { found: true, extractedText: needle, parsed: null };
    }
  }

  return { found: false, extractedText: null, parsed: null };
}

// Normalize a size string to a float — handles "8", "8\"", "1.5\"", "3/4\""
function _normSize(sizeStr) {
  const s = String(sizeStr).replace(/"/g, "").trim();
  if (s.includes("/")) {
    const [num, den] = s.split("/").map(Number);
    return den ? num / den : NaN;
  }
  return parseFloat(s);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// ── Strategy 1: Coordinate-based ─────────────────────────────────────────────

// ── Strategy 2: Pattern scan ──────────────────────────────────────────────────

// ── Utility: group text items into rows by Y coordinate ───────────────────────

// ── Pipe schedule extraction ──────────────────────────────────────────────────
//
// Reads four title-block fields that ISOGEN prints on EVERY sheet:
//   PIPE NS (IN)            — nominal bore in inches       (same on all sheets)
//   CURVILINEAR LENGTH (M)  — centre-line pipe length (m) for this sheet
//   INCH DIA:               — inch-dia units for this sheet (size × weld count)
//   INCH MTR:               — inch-metre for this sheet    (size × pipe length)
//
// Also reads the PIPE row from the BOM table on each sheet:
//   item code from the ITEM CODE column
//   description from the COMPONENT DESCRIPTION column (two-line, merged)
//   quantity from the QTY column (e.g. "29.5 M" → 29.5)
//
// All numeric fields are SUMMED across pages. PIPE NS (IN) is taken from the
// first page (it is the same on every sheet of a single-line ISO).
//
// Returns { pipeNsIn, curvLengthM, inchDia, inchMeter, bomPipeItems[] }
//   bomPipeItems: [{ itemCode, description, qtyM }] — one per unique item code

module.exports = { parsePdf, extractLineNo, SYS_CORE_RE };
