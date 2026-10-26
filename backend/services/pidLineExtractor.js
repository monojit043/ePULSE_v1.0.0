"use strict";
// Scans a P&ID's own text content for real piping line tags, so the
// "Extractor from P&ID" tool can list every line called out on already
// -uploaded, currently-approved P&IDs instead of asking someone to retype
// them. Reuses the same pdfjs-dist text-extraction primitive already proven
// in isoPdfParser.js and pidTitleBlockParser.js — this org's P&IDs are
// native vector PDFs, confirmed against a real sample, so no OCR involved.
const { parsePdf } = require("./isoPdfParser");

// This org's P&ID line tag format (confirmed against a real sample, and
// explicitly confirmed by the user — unlike ISO tags, P&ID line references
// never carry a trailing zone letter):
//   {size}"-{service}-{unit}-{seq}[-{subLine}]-{spec}[-{insulType}]
// e.g. 10"-CL-111-90213-A1A-IS, 2"-WDM-111-90201-A1K-NI, 3/4"-CL-111-90208-A1A-IS
//
// Variants seen on real B862 P&IDs / confirmed by the user (2026-10-23):
//   - letters on the seq belong to the line no. itself: 05341A-A62A-NI → seq "05341A"
//   - a numeric segment after the seq is a SUB-LINE: 05341-01-A62A-NI → seq "05341", sub-line "01"
//   - the insulation code is often missing: 05340A-A65A → insulation blank
//   - some sheets put a space before the spec and a bracketed code after it:
//     1-1/2"-FG-101-18605- A59N(M1A1)-IE → spec A59N, insulation IE; the
//     bracket code is kept only in full_line_no
// A spec always contains a letter AND a digit (A62A, D1N — true of every class
// in the line list): the letter tells it apart from a sub-line, the digit from
// an insulation code (NI, IS…) on a tag that has no spec.
//
// Size handles whole numbers, decimals, and bare fractions (3/4", 1/4") —
// order matters: the more specific fraction/decimal alternatives must be
// tried before the bare \d+ fallback, or "3/4" would short-match as just "3".
// The optional space after the size-quote mirrors a real quirk isoPdfParser.js
// already had to handle for ISO tags (some PDFs render a stray space there);
// kept here defensively even though the sample checked so far never needed it.
const PID_LINE_TAG_RE = /(\d+-\d+\/\d+|\d+\/\d+|\d+\.\d+|\d+)"- ?([A-Z][A-Z0-9]*)-(\d{3})-(\d{3,6}[A-Z]{0,2})(?:-(\d{1,3}))?- ?((?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{2,6})(?: ?\([A-Z0-9]+\))?(?:-([A-Z]{1,4}))?\b/g;

/**
 * Scan every text item on every page for line tags. Verified against a real
 * sample: complete tags come back as a single, unbroken pdfjs text item
 * (never split across fragments), so this deliberately scans each item's own
 * string individually rather than flattening/joining the whole page first —
 * that avoids the false-merge risk a flatten-then-regex approach would carry
 * if two unrelated adjacent items ever happened to look tag-shaped once
 * joined.
 */
function extractLinesFromPages(pages) {
  const found = [];
  const seen = new Set();

  for (const page of pages) {
    for (const item of page.items) {
      const re = new RegExp(PID_LINE_TAG_RE.source, "g");
      let m;
      while ((m = re.exec(item.str)) !== null) {
        const [full, size, service, unitNo, seqNo, subLine, spec, insulType] = m;
        if (seen.has(full)) continue;
        seen.add(full);
        found.push({
          fullLineNo: full,
          size: `${size}"`,
          service,
          unitNo,
          seqNo,
          subLine: subLine || null,
          spec,
          insulType: insulType || null,
          pageNo: page.pageNo,
        });
      }
    }
  }
  return found;
}

async function extractLines(filePath) {
  const parsed = await parsePdf(filePath);
  return extractLinesFromPages(parsed.pages);
}

module.exports = { extractLines, extractLinesFromPages, PID_LINE_TAG_RE };
