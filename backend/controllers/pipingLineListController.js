const q = require("../db/queries/pipingLineListQueries");

// POST /api/piping-line-list
// body: { jobNo, unitNo, lines: [{ zone, lineNo, seqNo, size, service, spec, source }] }
// Called from ll-create.html Step D ("Create Piping Line List") after the
// user has assigned zones to some or all of the Consolidated List's lines.
// Only rows that already carry a zone are accepted — zone is NOT NULL in the
// table (same convention as drawings/s3d_export_log), and re-deriving "did
// the user mean to leave this unzoned" isn't something the server can safely
// guess, so an unzoned row is rejected rather than silently skipped or
// defaulted to some placeholder zone.
async function createLineList(req, res) {
  try {
    const { jobNo, unitNo, lines } = req.body;
    if (!jobNo || !unitNo) {
      return res.status(400).json({ ok: false, error: "jobNo and unitNo are required" });
    }
    if (!Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ ok: false, error: "No lines provided" });
    }

    const zoned = [];
    let skippedNoZone = 0;
    for (const l of lines) {
      if (!l.zone || !l.lineNo) { skippedNoZone++; continue; }
      zoned.push({
        zone: l.zone, lineNo: l.lineNo, seqNo: l.seqNo || null,
        size: l.size || null, service: l.service || null, spec: l.spec || null,
        source: Array.isArray(l.sources) ? l.sources.join("+") : (l.source || null),
      });
    }

    if (!zoned.length) {
      return res.status(400).json({ ok: false, error: "None of the submitted lines have a zone assigned" });
    }

    const userId = req.session.user.id;
    const insertedIds = await q.insertLines(jobNo, unitNo, zoned, userId);

    res.json({
      ok: true,
      createdCount: insertedIds.length,
      alreadyExistedCount: zoned.length - insertedIds.length,
      skippedNoZone,
    });
  } catch (err) {
    console.error("createLineList error:", err);
    res.status(500).json({ ok: false, error: "Failed to create piping line list" });
  }
}

// GET /api/piping-line-list?jobNo=&unitNo=
async function getLineList(req, res) {
  try {
    const { jobNo, unitNo } = req.query;
    if (!jobNo || !unitNo) {
      return res.status(400).json({ ok: false, error: "jobNo and unitNo are required" });
    }
    const rows = await q.getLinesForJobUnit(jobNo, unitNo);
    res.json({ ok: true, lines: rows });
  } catch (err) {
    console.error("getLineList error:", err);
    res.status(500).json({ ok: false, error: "Failed to load piping line list" });
  }
}

module.exports = { createLineList, getLineList };
