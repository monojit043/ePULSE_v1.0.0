const { pool } = require("../db/pool");
const lq = require("../db/queries/pidLineQueries");

// line_list.unit_no is inconsistently decorated ("111" vs "111 (PDH
// Unit)") — confirmed against real data, not assumed — so it's normalized to
// its leading digits before comparing against pid_extracted_lines.unit_no,
// which is always clean.
function normalizeUnit(raw) {
  const m = String(raw || "").match(/^\d+/);
  return m ? m[0] : String(raw || "").trim();
}

// line_list has no full tag of its own (line_no is only the bare seq
// no) — for a line that only exists in the Line List (no matching P&ID line
// yet), build one in the same shape as pid_extracted_lines.full_line_no
// (`{size}"-{service}-{unit}-{seq}-{spec}-{insulType}`) so the consolidated
// table's Line No column isn't left blank. line_size can be a comma-separated
// multi-value field ("20\",3/4\"", and confirmed on real data to sometimes
// have an empty leading segment like ",4\"") — the first NON-EMPTY value is
// used, since we don't know which applies without a matching P&ID line to
// disambiguate.
function buildLinelistTag(l, unitNo) {
  const sizeTokens = String(l.line_size || "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const size = sizeTokens[0] || "";
  return [size, l.service, unitNo, l.line_no, l.line_class, l.insulation]
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0)
    .join("-");
}

// GET /api/pid/consolidated-lines?jobNo=&unitNo=
// Merges two independently-sourced line lists for the same Job/Unit:
//   - pid_extracted_lines — parsed straight from currently-approved P&ID content
//   - line_list — the job's current line list (Line List Normalizer uploads)
// Matched on the same "coreId" convention already established for ISO line
// matching in backend/services/isoPdfParser.js (extractLineNo's pdfCoreId):
// `${service}-${unitNo}-${seqNo}`.toLowerCase(), e.g. "p-101-12345". Confirmed
// against real B378/111 data that seq_no ALONE is not a unique key — the same
// seq_no legitimately repeats across different lines with different
// service/size (e.g. 90201 appears as 1"-IG-111-90201, 8"-CL-111-90201,
// 8"-SL-111-90201, etc., all real, distinct lines) — service is required in
// the key to disambiguate them.
// A matched pair whose size/spec disagree is flagged as a mismatch — shown
// once in the main consolidated list (P&ID content is treated as the
// authoritative value there, consistent with this system's design throughout)
// and again, with both sides' values, in the separate mismatch summary.
async function getConsolidatedLines(req, res) {
  try {
    const { jobNo, unitNo } = req.query;
    if (!jobNo || !unitNo) {
      return res.status(400).json({ ok: false, error: "jobNo and unitNo are required" });
    }

    const pidLines = await lq.getLinesForJobUnit(jobNo, unitNo);

    const llRes = await pool.query(
      `SELECT ll.pid_no, ll.line_no, ll.unit_no, ll.line_size, ll.service, ll.line_class, ll.insulation
       FROM line_list ll
       WHERE ll.project_id = $1`,
      [jobNo]
    );
    const linelistLines = llRes.rows.filter((r) => normalizeUnit(r.unit_no) === String(unitNo).trim());

    // Both sources are already scoped to this one requested unit, so the
    // normalized query unitNo is used for every key rather than each row's
    // own unit_no field — line_list.unit_no can be decorated ("111 (PDH
    // Unit)") which would otherwise never coreId-match pid_extracted_lines'
    // clean "111".
    const normUnit = normalizeUnit(unitNo);
    const coreId = (service, seqNo) =>
      `${String(service || "").trim()}-${normUnit}-${String(seqNo).trim()}`.toLowerCase();

    // Grouped into arrays, not a last-wins Map: coreId is usually unique but
    // not always (confirmed on real B378/111 data — e.g. two distinct lines,
    // 6" and 10", both CL-111-90212). A residual same-key collision must
    // never silently drop a real line, so entries at the same key are paired
    // up positionally instead of one overwriting the other.
    // A sub-line (05341-01) is its own line — keyed and shown as "05341-01",
    // so it never pairs with line-list line 05341
    const pidSeq = (l) => (l.sub_line ? `${l.seq_no}-${l.sub_line}` : l.seq_no);
    const pidByKey = new Map();
    pidLines.forEach((l) => {
      const k = coreId(l.service, pidSeq(l));
      if (!pidByKey.has(k)) pidByKey.set(k, []);
      pidByKey.get(k).push(l);
    });
    const llByKey = new Map();
    linelistLines.forEach((l) => {
      const k = coreId(l.service, l.line_no);
      if (!llByKey.has(k)) llByKey.set(k, []);
      llByKey.get(k).push(l);
    });

    const allKeys = new Set([...pidByKey.keys(), ...llByKey.keys()]);
    const consolidated = [];
    const mismatches = [];

    for (const key of allKeys) {
      const pGroup = pidByKey.get(key) || [];
      const llGroup = llByKey.get(key) || [];
      const pairCount = Math.max(pGroup.length, llGroup.length);

      for (let i = 0; i < pairCount; i++) {
        const p = pGroup[i];
        const l = llGroup[i];
        const seq = p ? pidSeq(p) : l.line_no;

        if (p && l) {
          const llSizes = String(l.line_size || "").split(",").map((s) => s.trim());
          const sizeOk = llSizes.includes(String(p.size_in || "").trim());
          const specOk = String(p.piping_spec || "").toUpperCase() === String(l.line_class || "").toUpperCase();
          const isMismatch = !(sizeOk && specOk);

          consolidated.push({
            unitNo, seqNo: seq, fullLineNo: p.full_line_no,
            size: p.size_in, service: p.service, spec: p.piping_spec,
            sources: ["pid", "linelist"], hasMismatch: isMismatch,
          });

          if (isMismatch) {
            mismatches.push({
              unitNo, seqNo: seq,
              pid: { fullLineNo: p.full_line_no, size: p.size_in, service: p.service, spec: p.piping_spec, sourcePid: p.pid_name },
              linelist: { lineNo: l.line_no, size: l.line_size, service: l.service, spec: l.line_class, sourcePid: l.pid_no },
              diffFields: [!sizeOk && "size", !specOk && "spec"].filter(Boolean),
            });
          }
        } else if (p) {
          consolidated.push({
            unitNo, seqNo: seq, fullLineNo: p.full_line_no,
            size: p.size_in, service: p.service, spec: p.piping_spec,
            sources: ["pid"], hasMismatch: false,
          });
        } else {
          consolidated.push({
            unitNo, seqNo: seq, fullLineNo: buildLinelistTag(l, normUnit),
            size: l.line_size, service: l.service, spec: l.line_class,
            sources: ["linelist"], hasMismatch: false, sourcePid: l.pid_no,
          });
        }
      }
    }

    consolidated.sort((a, b) => String(a.seqNo).localeCompare(String(b.seqNo), undefined, { numeric: true }));

    res.json({
      ok: true,
      lines: consolidated,
      mismatches,
      stats: {
        totalPid: pidLines.length,
        totalLinelist: linelistLines.length,
        matched: consolidated.filter((r) => r.sources.length === 2).length,
        mismatchCount: mismatches.length,
      },
    });
  } catch (err) {
    console.error("getConsolidatedLines error:", err);
    res.status(500).json({ ok: false, error: "Failed to build consolidated line list" });
  }
}

module.exports = { getConsolidatedLines };
