const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const multer = require("multer");
const q = require("../db/queries/pidQueries");
const auditQ = require("../db/queries/pidAuditQueries");
const { pool } = require("../db/pool");
const { parsePidName } = require("../utils/pidNameParser");
const { revisionSortKey } = require("../utils/pidRevisionOrder");
const { parsePidIndexPdf, toIsoDate } = require("../services/pidIndexParser");

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

const _upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".xlsx", ".xls", ".csv"].includes(ext)) return cb(null, true);
    cb(new Error("Only a P&ID index PDF, or .xlsx / .xls / .csv, is accepted"));
  },
}).single("file");

// GET /api/pid/scope
async function getScope(req, res) {
  try {
    const user = req.session.user;
    const scope = await q.getAssignedScope(user.id, !!user.isHod);
    res.json({ ok: true, scope });
  } catch (err) {
    console.error("getScope error:", err);
    res.status(500).json({ ok: false, error: "Failed to load assigned job/unit scope" });
  }
}

// GET /api/pid/master-index?jobNo=&unitNo=&status=
async function getMasterIndex(req, res) {
  try {
    const { jobNo, unitNo, status } = req.query;
    const rows = await q.getMasterIndexRows({ jobNo, unitNo, status });
    res.json({ ok: true, rows });
  } catch (err) {
    console.error("getMasterIndex error:", err);
    res.status(500).json({ ok: false, error: "Failed to load P&ID master index" });
  }
}

// GET /api/pid/master-index/with-status?jobNo=&unitNo=&status=
async function getMasterIndexWithStatus(req, res) {
  try {
    const { jobNo, unitNo, status } = req.query;
    const rows = await q.getMasterIndexWithCurrentDoc({ jobNo, unitNo, status });
    res.json({ ok: true, rows });
  } catch (err) {
    console.error("getMasterIndexWithStatus error:", err);
    res.status(500).json({ ok: false, error: "Failed to load P&ID index with document status" });
  }
}

// POST /api/pid/master-index  { jobNo, unitNo, zone, pidName }
// The user still picks Job No / Unit No from the dropdown (it's what drives
// the assignment check and is the user's deliberate declared intent) — but
// it's never trusted on its own. This org's P&ID naming convention
// (JOB-XX-XX-UNIT-SERIAL) encodes both positionally, so the name is parsed
// and must AGREE with the dropdown selection, or the row is rejected. That's
// what catches a wrong dropdown pick instead of silently accepting it.
async function addMasterIndexRow(req, res) {
  try {
    const user = req.session.user;
    const { jobNo, unitNo, zone, pidName, description } = req.body || {};
    if (!jobNo || !unitNo || !pidName || !String(pidName).trim()) {
      return res.status(400).json({ ok: false, error: "jobNo, unitNo and pidName are required" });
    }
    // Optional: latest revision per the Process index (A–Z, 0, 1 …) and its date (dd.mm.yy)
    const rev = String(req.body.rev || "").trim().toUpperCase();
    const revDateRaw = String(req.body.revDate || "").trim();
    let revHistory = [];
    if (rev) {
      if (revisionSortKey(rev) == null) return res.status(400).json({ ok: false, error: `Revision "${rev}" must be a letter A–Z or a number` });
      const date = revDateRaw ? (/^\d{4}-\d{2}-\d{2}$/.test(revDateRaw) ? revDateRaw : toIsoDate(revDateRaw)) : null;
      if (revDateRaw && !date) return res.status(400).json({ ok: false, error: `Date "${revDateRaw}" is not valid — use dd.mm.yy` });
      revHistory = [{ rev, date }];
    }
    const parsed = parsePidName(pidName);
    if (!parsed) {
      return res.status(400).json({
        ok: false,
        error: `"${pidName}" doesn't match the expected format JOB-XX-XX-UNIT-SERIAL (e.g. B378-02-42-111-11902)`,
      });
    }
    if (parsed.jobNo !== jobNo || parsed.unitNo !== unitNo) {
      return res.status(400).json({
        ok: false,
        error: `"${pidName}" is for Job ${parsed.jobNo} / Unit ${parsed.unitNo}, but you selected ${jobNo}/${unitNo}`,
      });
    }
    if (!(await q.jobUnitExists(jobNo, unitNo))) {
      return res.status(400).json({ ok: false, error: "That Job No / Unit No combination doesn't exist in PIMS" });
    }
    if (!(await q.isUserAssigned(user.id, !!user.isHod, jobNo, unitNo))) {
      return res.status(403).json({ ok: false, error: "You are not assigned to this Job/Unit as GL or ISO Manager" });
    }
    try {
      const row = await q.insertMasterIndexRow({
        jobNo, unitNo, zone, pidName: String(pidName).trim(), createdBy: user.id,
        description: String(description || "").replace(/\s+/g, " ").trim(), revHistory,
      });
      await auditQ.logAction({
        action: "master_index_added", masterIndexId: row.id, performedBy: user.id,
        details: { pidName: row.pid_name, jobNo, unitNo, source: "manual" },
      });
      res.json({ ok: true, row });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ ok: false, error: `"${pidName}" is already active for ${jobNo}/${unitNo}` });
      }
      throw err;
    }
  } catch (err) {
    console.error("addMasterIndexRow error:", err);
    res.status(500).json({ ok: false, error: "Failed to add P&ID index row" });
  }
}

// POST /api/pid/master-index/:id/retire  { reason }
async function retireMasterIndexRow(req, res) {
  try {
    const user = req.session.user;
    const { id } = req.params;
    const { reason } = req.body || {};
    const ok = await q.retireMasterIndexRow(id, user.id, reason);
    if (!ok) return res.status(404).json({ ok: false, error: "Row not found or already retired" });
    await auditQ.logAction({
      action: "master_index_retired", masterIndexId: Number(id), performedBy: user.id, reason,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("retireMasterIndexRow error:", err);
    res.status(500).json({ ok: false, error: "Failed to retire row" });
  }
}

// GET /api/pid/master-index/template
// Same columns as the Process "P & ID INDEX" (2026-10-22): one row per P&ID with its latest revision.
async function downloadTemplate(req, res) {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("P&ID Index");
    ws.columns = [
      { header: "Drawing No.", key: "pidName", width: 30 },
      { header: "Drawing Description", key: "description", width: 44 },
      { header: "Revision", key: "rev", width: 10 },
      { header: "Date", key: "date", width: 12 },
      { header: "Zone (optional)", key: "zone", width: 16 },
    ];
    ws.addRow({ pidName: "B862-79-41-101-11021", description: "INCOMING BATTERY LIMITS", rev: "4", date: "27.08.25", zone: "" });
    ws.getRow(1).font = { bold: true };
    ws.getColumn("rev").numFmt = "@";
    ws.getColumn("date").numFmt = "@";
    ws.addRow([]);
    ws.addRow(["Revision: A–Z, then 0, 1, 2 …   Date: dd.mm.yy   One row per P&ID, its latest revision."]).font = { italic: true, color: { argb: "FF888888" } };
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Disposition", "attachment; filename=PID_Master_Index_Template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("downloadTemplate error:", err);
    res.status(500).json({ ok: false, error: "Failed to build template" });
  }
}

// ── Index import (2026-10-22): the Process "P & ID INDEX" PDF, or the Excel template ─────────────
// Two steps with the same checks: POST …/import/preview (nothing saved) and POST …/import (applies).
// Per P&ID the master index keeps: description, revision history, latest revision/date, and which
// uploaded index issue last set them. Re-imports UPDATE existing P&IDs. Index sheets only show the
// last 3–4 revisions, so revision histories are MERGED (a revision already known is never dropped;
// the file's date wins for a revision it lists). P&IDs missing from a file are only listed — never
// retired automatically (a unit's P&IDs are usually spread over several section indexes).

// Read the uploaded file into { source, header, rows: [{ pidName, description, revisions, zone, ref, warnings }], warnings }
async function readIndexFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".pdf") {
    const r = await parsePidIndexPdf(file.buffer);
    if (!r.ok) return { error: r.error };
    return {
      source: "pdf", header: r.header, warnings: r.warnings,
      rows: r.rows.map((x) => ({ ...x, zone: "", ref: `page ${x.page}` })),
    };
  }
  const wb = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
  if (!raw.length) return { error: "Sheet is empty" };
  const head = raw[0].map((h) => String(h).trim().toLowerCase());
  const pick = (...names) => names.map((n) => head.indexOf(n)).find((i) => i !== -1) ?? -1;
  const iName = pick("drawing no.", "drawing no", "p&id name", "pid name", "p&id no.", "p&id no");
  const iDesc = pick("drawing description", "description");
  const iRev = pick("revision", "rev", "rev.", "rev no", "rev. no.", "revision no.");
  const iDate = pick("date", "revision date", "rev date", "rev. date");
  const iZone = pick("zone (optional)", "zone");
  if (iName === -1) return { error: 'Expected a "Drawing No." column — use the template.' };

  const cellDate = (v) => {
    if (v instanceof Date && !isNaN(v)) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    }
    const s = String(v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : toIsoDate(s);
  };
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const line = raw[i];
    if (!line || line.every((c) => String(c ?? "").trim() === "")) continue;
    const pidName = String(line[iName] ?? "").trim();
    if (/^revision:/i.test(pidName)) continue; // the template's help line
    const warnings = [];
    const revisions = [];
    const rev = iRev !== -1 ? String(line[iRev] ?? "").trim().toUpperCase() : "";
    const dateRaw = iDate !== -1 ? line[iDate] : "";
    if (rev) {
      if (revisionSortKey(rev) == null) warnings.push(`Revision "${rev}" is not A–Z or a number — not counted`);
      else {
        const date = String(dateRaw ?? "").trim() ? cellDate(dateRaw) : null;
        if (String(dateRaw ?? "").trim() && !date) warnings.push(`Date "${String(dateRaw).trim()}" is not a valid date (use dd.mm.yy) — stored without a date`);
        revisions.push({ rev, date });
      }
    }
    rows.push({
      pidName, description: iDesc !== -1 ? String(line[iDesc] ?? "").replace(/\s+/g, " ").trim() : "",
      revisions, zone: iZone !== -1 ? String(line[iZone] ?? "").trim() : "", ref: `row ${i + 1}`, warnings,
    });
  }
  return { source: "excel", header: null, warnings: [], rows };
}

// Union of two revision lists by revision label (the file's date wins), in revision order
function mergeRevisions(existing, incoming) {
  const byRev = new Map((existing || []).map((r) => [r.rev, r]));
  for (const r of incoming) byRev.set(r.rev, { rev: r.rev, date: r.date ?? byRev.get(r.rev)?.date ?? null });
  return [...byRev.values()].sort((a, b) => revisionSortKey(a.rev) - revisionSortKey(b.rev));
}

// Compare a read file against the master index of the selected Job/Unit — used by preview AND apply
async function buildImportPlan(read, selectedJob, selectedUnit, db) {
  const h = read.header;
  if (h?.jobNo && h.jobNo !== selectedJob) {
    return { error: `This index is for Job ${h.jobNo}, but you selected ${selectedJob}.` };
  }
  if (h?.unitNo && h.unitNo !== selectedUnit) {
    return { error: `This index is for Unit ${h.unitLabel || h.unitNo}, but you selected ${selectedUnit}.` };
  }
  const existing = await q.getActiveRowsByName(selectedJob, selectedUnit, db);
  const seen = new Map();
  const rows = read.rows.map((r) => {
    const out = { ...r, action: null, reason: null, changes: [], history: null, latest: null };
    const latestIn = r.revisions[r.revisions.length - 1] || null;
    if (!r.pidName) return { ...out, action: "skip", reason: "Missing Drawing No." };
    const parsed = parsePidName(r.pidName);
    if (!parsed) return { ...out, action: "skip", reason: "Doesn't match the format JOB-XX-XX-UNIT-SERIAL" };
    if (parsed.jobNo !== selectedJob || parsed.unitNo !== selectedUnit) {
      return { ...out, action: "skip", reason: `Drawing is for Job ${parsed.jobNo} / Unit ${parsed.unitNo}, not ${selectedJob} / ${selectedUnit}` };
    }
    if (seen.has(r.pidName)) return { ...out, action: "skip", reason: `Listed twice in this file (also ${seen.get(r.pidName)})` };
    seen.set(r.pidName, r.ref);

    const cur = existing.get(r.pidName);
    if (!cur) {
      const history = mergeRevisions([], r.revisions);
      return { ...out, action: "new", history, latest: history[history.length - 1] || null };
    }
    const history = mergeRevisions(cur.rev_history, r.revisions);
    const latest = history[history.length - 1] || null;
    const olderIssue = latestIn && cur.index_rev && revisionSortKey(latestIn.rev) < revisionSortKey(cur.index_rev);
    if (olderIssue) out.warnings = [...out.warnings, `This file shows Rev ${latestIn.rev}; the master index already has Rev ${cur.index_rev} from a later issue — description and latest revision kept`];
    if (r.description && r.description !== (cur.description || "") && !olderIssue) {
      out.changes.push(`Description: "${cur.description || "—"}" → "${r.description}"`);
    }
    if (JSON.stringify(history) !== JSON.stringify(cur.rev_history || [])) {
      const added = history.filter((x) => !(cur.rev_history || []).some((y) => y.rev === x.rev)).map((x) => x.rev);
      out.changes.push(added.length ? `Revisions added: ${added.join(", ")}` : "Revision dates updated");
    }
    if (r.zone && r.zone !== (cur.zone || "")) out.changes.push(`Zone: ${cur.zone || "—"} → ${r.zone}`);
    return {
      ...out, existingId: cur.id, history, latest,
      description: olderIssue ? cur.description : r.description,
      action: out.changes.length ? "update" : "unchanged",
    };
  });
  const inFile = new Set(rows.map((r) => r.pidName));
  const missing = [...existing.keys()].filter((n) => !inFile.has(n)).sort();
  const count = (a) => rows.filter((r) => r.action === a).length;
  return {
    rows, missing,
    counts: { inFile: rows.length, new: count("new"), update: count("update"), unchanged: count("unchanged"), skip: count("skip"),
              warnings: rows.filter((r) => r.warnings.length).length },
  };
}

// Shared front half of preview / apply: upload, permissions, read, plan
function withIndexPlan(handler) {
  return (req, res) => _upload(req, res, async (multerErr) => {
    if (multerErr) return res.status(400).json({ ok: false, error: multerErr.message });
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });
    const { jobNo: selectedJob, unitNo: selectedUnit } = req.body || {};
    if (!selectedJob || !selectedUnit) {
      return res.status(400).json({ ok: false, error: "Select a Job No and Unit No before importing" });
    }
    try {
      const user = req.session.user;
      if (!(await q.jobUnitExists(selectedJob, selectedUnit))) {
        return res.status(400).json({ ok: false, error: "That Job No / Unit No combination doesn't exist in PIMS" });
      }
      if (!(await q.isUserAssigned(user.id, !!user.isHod, selectedJob, selectedUnit))) {
        return res.status(403).json({ ok: false, error: "You are not assigned to this Job/Unit as GL or ISO Manager" });
      }
      const read = await readIndexFile(req.file);
      if (read.error) return res.status(400).json({ ok: false, error: read.error });
      read.fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      await handler({ req, res, user, selectedJob, selectedUnit, read });
    } catch (err) {
      console.error("P&ID index import error:", err);
      res.status(500).json({ ok: false, error: "Failed to process the index file" });
    }
  });
}

const planForClient = (read, plan, fileStatus) => ({
  ok: true, source: read.source, header: read.header, fileWarnings: read.warnings,
  counts: plan.counts, missing: plan.missing, fileStatus: fileStatus || null,
  rows: plan.rows.map((r) => ({
    pidName: r.pidName, description: r.description, ref: r.ref, zone: r.zone,
    revisions: r.revisions, history: r.history, latest: r.latest,
    action: r.action, reason: r.reason, changes: r.changes, warnings: r.warnings,
  })),
});

// Is this exact file already kept, or can it be attached to an earlier upload of the same index whose file
// wasn't kept (uploads made before files were stored)? Only relevant when the file changes nothing.
async function indexFileStatus(read, plan, req, selectedJob, selectedUnit, db) {
  const duplicate = await q.findIndexIssueByHash(selectedJob, selectedUnit, read.fileHash, db);
  if (duplicate) return { duplicateOf: duplicate };
  if (plan.counts.new || plan.counts.update) return null;
  const h = read.header || {};
  const attachTo = await q.findIndexIssueWithoutFile(selectedJob, selectedUnit, req.file.originalname, h.documentNo, h.documentRev, db);
  return attachTo ? { attachTo } : { recordOnly: true };
}

// Keep the uploaded index byte-for-byte: uploads/<job>/<unit>/PID_INDEX/<issueId>_<original name>
function storeIndexFile(req, selectedJob, selectedUnit, issueId) {
  const dir = path.join(UPLOADS_ROOT, selectedJob, selectedUnit, "PID_INDEX");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${issueId}_${req.file.originalname.replace(/[^\w.\-&() ]/g, "_")}`);
  fs.writeFileSync(abs, req.file.buffer);
  return { abs, rel: path.relative(UPLOADS_ROOT, abs).split(path.sep).join("/") };
}

// POST /api/pid/master-index/import/preview  (multipart: "file" .pdf/.xlsx/.xls/.csv + jobNo + unitNo)
const previewMasterIndexImport = withIndexPlan(async ({ req, res, selectedJob, selectedUnit, read }) => {
  const plan = await buildImportPlan(read, selectedJob, selectedUnit);
  if (plan.error) return res.status(400).json({ ok: false, error: plan.error, header: read.header });
  res.json(planForClient(read, plan, await indexFileStatus(read, plan, req, selectedJob, selectedUnit)));
});

// POST /api/pid/master-index/import  — same input; re-reads and re-checks the file, then applies it in one
// transaction and keeps the file. A file that changes nothing is still kept (attached to the earlier upload
// of the same index if that one's file wasn't kept, otherwise recorded as a new upload); an identical file
// already kept is not stored twice.
const importMasterIndex = withIndexPlan(async ({ req, res, user, selectedJob, selectedUnit, read }) => {
  const client = await pool.connect();
  let written = null;
  try {
    await client.query("BEGIN");
    const plan = await buildImportPlan(read, selectedJob, selectedUnit, client);
    if (plan.error) { await client.query("ROLLBACK"); return res.status(400).json({ ok: false, error: plan.error }); }
    const fileStatus = await indexFileStatus(read, plan, req, selectedJob, selectedUnit, client);
    const fileInfo = { fileHash: read.fileHash, fileSize: req.file.size };

    if (fileStatus?.duplicateOf && !plan.counts.new && !plan.counts.update) {
      await client.query("ROLLBACK");
      return res.json({ ...planForClient(read, plan, fileStatus), nothingToDo: true });
    }
    if (fileStatus?.attachTo) {
      written = storeIndexFile(req, selectedJob, selectedUnit, fileStatus.attachTo.id);
      await q.setIndexIssueFile(fileStatus.attachTo.id, { storedPath: written.rel, ...fileInfo }, client);
      await client.query("COMMIT");
      return res.json({ ...planForClient(read, plan, fileStatus), issueId: fileStatus.attachTo.id, attached: true });
    }

    const h = read.header || {};
    const issueId = await q.insertIndexIssue({
      jobNo: selectedJob, unitNo: selectedUnit, sourceType: read.source, fileName: req.file.originalname,
      documentNo: h.documentNo, documentRev: h.documentRev, unitLabel: h.unitLabel, dateOfIssue: h.dateOfIssueIso,
      pageCount: h.pages, rowsInFile: plan.counts.inFile, added: plan.counts.new, updated: plan.counts.update,
      unchanged: plan.counts.unchanged, skipped: plan.counts.skip, uploadedBy: user.id, ...fileInfo,
    }, client);
    written = storeIndexFile(req, selectedJob, selectedUnit, issueId);
    await q.setIndexIssueFile(issueId, { storedPath: written.rel, ...fileInfo }, client);
    const audit = (action, id, details) => client.query(
      `INSERT INTO pid_audit_log (action, master_index_id, performed_by, details) VALUES ($1,$2,$3,$4)`,
      [action, id, user.id, JSON.stringify({ ...details, jobNo: selectedJob, unitNo: selectedUnit, source: `${read.source}_import`, indexIssueId: issueId })]
    );
    for (const r of plan.rows) {
      if (r.action === "new") {
        const row = await q.insertMasterIndexRow({
          jobNo: selectedJob, unitNo: selectedUnit, zone: r.zone, pidName: r.pidName, createdBy: user.id,
          description: r.description, revHistory: r.history, indexIssueId: issueId,
        }, client);
        await audit("master_index_added", row.id, { pidName: r.pidName, latestRev: r.latest?.rev || null });
      } else if (r.action === "update") {
        await q.updateMasterIndexFromIndex(r.existingId, {
          zone: r.zone, description: r.description, revHistory: r.history, indexIssueId: issueId, updatedBy: user.id,
        }, client);
        await audit("master_index_updated", r.existingId, { pidName: r.pidName, changes: r.changes });
      }
    }
    await client.query("COMMIT");
    res.json({ ...planForClient(read, plan, fileStatus), issueId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (written) fs.rmSync(written.abs, { force: true });   // nothing saved → no orphan file
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/pid/index-issues?jobNo=&unitNo=  — uploaded index files (any signed-in user)
async function listIndexIssues(req, res) {
  try {
    const { jobNo, unitNo } = req.query;
    if (!jobNo || !unitNo) return res.status(400).json({ ok: false, error: "jobNo and unitNo are required" });
    res.json({ ok: true, issues: await q.listIndexIssues(jobNo, unitNo) });
  } catch (err) {
    console.error("listIndexIssues error:", err);
    res.status(500).json({ ok: false, error: "Failed to load uploaded indexes" });
  }
}

// GET /api/pid/index-issues/:id/file  — the uploaded index exactly as it was uploaded, with its original name
async function downloadIndexIssueFile(req, res) {
  try {
    const issue = await q.getIndexIssue(req.params.id);
    if (!issue) return res.status(404).json({ ok: false, error: "Upload not found" });
    if (!issue.stored_path) return res.status(404).json({ ok: false, error: "This upload's file was not kept (uploaded before files were stored). Upload the same file again to attach it." });
    const abs = path.join(UPLOADS_ROOT, issue.stored_path);
    if (!abs.startsWith(UPLOADS_ROOT + path.sep) || !fs.existsSync(abs)) return res.status(404).json({ ok: false, error: "File missing on the server" });
    res.download(abs, issue.file_name, (err) => { if (err && !res.headersSent) res.status(500).end(); });
  } catch (err) {
    console.error("downloadIndexIssueFile error:", err);
    res.status(500).json({ ok: false, error: "Failed to download" });
  }
}

module.exports = {
  getScope,
  getMasterIndex,
  getMasterIndexWithStatus,
  addMasterIndexRow,
  retireMasterIndexRow,
  downloadTemplate,
  previewMasterIndexImport,
  importMasterIndex,
  listIndexIssues,
  downloadIndexIssueFile,
};
