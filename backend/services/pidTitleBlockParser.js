"use strict";
// Extracts the real identity + revision printed inside a P&ID's own title
// block, so it can be cross-checked against what the uploaded filename
// declares (Step 5's self-consistency gate). Reuses the same pdfjs-dist
// text-extraction primitive already proven in isoPdfParser.js for ISO
// title blocks — just a different coordinate geometry for this template.
const { parsePdf } = require("./isoPdfParser");

// ── Template registry ──────────────────────────────────────────────────────
// A small, growing list of known P&ID title-block layouts. Each template
// declares how to recognize itself and how to pull the identity fields out.
// Start with exactly one — EIL's standard P&ID title block — verified
// against a real sample. New templates get added here one at a time as real
// samples for other layouts arrive; a P&ID that matches none of them falls
// back to manual confirmation rather than guessing.

const EIL_STANDARD_LABELS = ["JOB NO.", "DEPT.", "SECTN.", "UNIT", "DWG. No.", "REV."];

const EIL_STANDARD_TEMPLATE = {
  name: "eil_standard",
  // All 6 exact-text labels must be present on the page for this template
  // to even be considered — cheap, reliable first filter before attempting
  // coordinate extraction.
  detect(items) {
    return EIL_STANDARD_LABELS.every((label) => items.some((it) => it.str === label));
  },
  // Values sit directly BELOW their label, tightly column-aligned on x
  // (verified: within ~6px on a real sample) and a consistent distance
  // below on y (verified: ~24-25px). Tolerances below are deliberately a
  // bit looser than the observed values to allow for minor variation
  // across different drawings using the same template.
  extract(items) {
    const X_TOLERANCE = 15;
    const Y_MIN_BELOW = 10;
    const Y_MAX_BELOW = 40;

    const fieldFor = (labelText) => {
      const label = items.find((it) => it.str === labelText);
      if (!label) return null;
      const candidates = items.filter((it) => {
        const dx = Math.abs(it.x - label.x);
        const dy = label.y - it.y; // positive = below the label, PDF y grows upward
        return dx <= X_TOLERANCE && dy >= Y_MIN_BELOW && dy <= Y_MAX_BELOW;
      });
      if (!candidates.length) return null;
      // The value is in the row DIRECTLY below the label: nearest row first, and only then the
      // closest on x within that row. (Closest-x alone picked the next row's "DISTRIBUTION CODE"
      // under UNIT on B862 title blocks — 1 px closer on x than the real value "101", one row lower.)
      const ROW_TOLERANCE = 3;
      candidates.sort((a, b) => {
        const dyA = label.y - a.y, dyB = label.y - b.y;
        if (Math.abs(dyA - dyB) > ROW_TOLERANCE) return dyA - dyB;
        return Math.abs(a.x - label.x) - Math.abs(b.x - label.x);
      });
      return candidates[0].str.trim();
    };

    const jobNo = fieldFor("JOB NO.");
    const dept = fieldFor("DEPT.");
    const sectn = fieldFor("SECTN.");
    const unit = fieldFor("UNIT");
    const dwgNo = fieldFor("DWG. No.");
    const rev = fieldFor("REV.");

    if (!jobNo || !dept || !sectn || !unit || !dwgNo || !rev) return null;

    return {
      parsedName: `${jobNo}-${dept}-${sectn}-${unit}-${dwgNo}`,
      parsedRevision: rev,
    };
  },
};

const TEMPLATES = [EIL_STANDARD_TEMPLATE];

/**
 * Try every registered template against a PDF's first page (P&IDs are one
 * identity per file even when a drawing spans multiple sheets — every sheet
 * repeats the same title block, so page 1 alone is enough).
 * Returns { matched: true, templateName, parsedName, parsedRevision }
 *      or { matched: false }  — no known template recognized this page.
 */
function extractTitleBlockFromPages(pages) {
  const page1 = pages && pages[0];
  if (!page1 || !page1.items || !page1.items.length) return { matched: false };

  for (const template of TEMPLATES) {
    if (!template.detect(page1.items)) continue;
    const fields = template.extract(page1.items);
    if (!fields) continue;
    return { matched: true, templateName: template.name, ...fields };
  }
  return { matched: false };
}

/**
 * Convenience wrapper: parse the PDF file and extract its title block in
 * one call.
 */
async function extractTitleBlock(filePath) {
  const parsed = await parsePdf(filePath);
  return extractTitleBlockFromPages(parsed.pages);
}

module.exports = { extractTitleBlock, extractTitleBlockFromPages, TEMPLATES };
