const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const q = require("../db/queries/pidQueries");
const dq = require("../db/queries/pidDocumentQueries");
const auditQ = require("../db/queries/pidAuditQueries");
const { parsePidFileName } = require("../utils/pidFileNameParser");
const { revisionSortKey } = require("../utils/pidRevisionOrder");
const { extractTitleBlock } = require("../services/pidTitleBlockParser");
const { extractLines } = require("../services/pidLineExtractor");
const lq = require("../db/queries/pidLineQueries");

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch (_e) { /* best-effort cleanup, file may already be gone */ }
}

// Runs whenever a document becomes the new 'current' one, from any of the
// six places that can happen (first upload, supersede, forced-older-upload,
// and the three equivalents in resolvePendingDocument). Never lets an
// extraction failure break the actual document-status change it's attached
// to — a P&ID that fails to parse for line numbers should still become
// current, just with an empty (or previous, until the next successful
// re-extraction) line list rather than blocking the real action.
async function reExtractLines(masterIndexId, doc) {
  try {
    const absPath = path.join(UPLOADS_ROOT, doc.file_path);
    const lines = await extractLines(absPath);
    await lq.replaceExtractedLines(masterIndexId, doc.id, lines);
  } catch (err) {
    console.error("line extraction error:", err);
  }
}

function namesMatch(declared, parsed) {
  return String(declared).trim().toUpperCase() === String(parsed).trim().toUpperCase();
}

function revsMatch(declaredLabel, parsedLabel) {
  const a = revisionSortKey(declaredLabel);
  const b = revisionSortKey(parsedLabel);
  return a !== null && b !== null && a === b;
}

// POST /api/pid/documents/upload  (multipart: "files" (multi) + force? + forceReason?)
// Filename convention: <P&ID-Name>_<Rev>.pdf (old _Rev<X> also accepted)
// multer (see pidRoutes.js) only stages files into a generic temp folder —
// deliberately not doing filename-based routing in its destination callback,
// since a callback error there aborts multer's whole batch, not just one
// file. All parsing/validation/move-into-place happens here instead, per
// file, so one bad name in a batch can't block the rest.
async function uploadPidDocuments(req, res) {
  const user = req.session.user;
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ ok: false, error: "No files uploaded" });

  const force = String(req.body.force || "").toLowerCase() === "true";
  const forceReason = (req.body.forceReason || "").trim();

  const results = [];
  for (const file of files) {
    const result = await processOneUpload(file, user, { force, forceReason });
    const warning = await indexRevisionWarning(file.originalname, result);
    results.push(warning ? { ...result, indexWarning: warning } : result);
  }
  res.json({ ok: true, results });
}

// Warning only (decided 2026-10-22): the uploaded revision differs from the latest revision the Process
// P&ID index lists for this P&ID. Never blocks or changes the upload outcome.
async function indexRevisionWarning(fileName, result) {
  if (["bad_filename", "bad_revision", "not_in_index", "not_assigned"].includes(result.outcome)) return null;
  try {
    const parsed = parsePidFileName(fileName);
    const row = parsed && await q.findActiveMasterIndexRow(parsed.jobNo, parsed.unitNo, parsed.pidName);
    if (!row || !row.index_rev) return null;
    const up = revisionSortKey(parsed.revLabel), idx = revisionSortKey(row.index_rev);
    if (up === null || idx === null || up === idx) return null;
    const d = row.index_rev_date ? new Date(row.index_rev_date) : null;
    const date = d ? ` (${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)})` : "";
    return `The Process P&ID index lists Rev ${row.index_rev}${date} as the latest; this file is Rev ${parsed.revLabel} — ${up < idx ? "older" : "newer"} than the index.`;
  } catch (err) {
    console.error("index revision check error:", err);
    return null;
  }
}

async function processOneUpload(file, user, { force, forceReason }) {
  const parsed = parsePidFileName(file.originalname);
  if (!parsed) {
    safeUnlink(file.path);
    return { file: file.originalname, ok: false, outcome: "bad_filename", error: 'Doesn\'t match the expected filename format <P&ID Name>_<Rev>.pdf, e.g. B862-79-41-101-11045_4.pdf' };
  }

  const revSortKey = revisionSortKey(parsed.revLabel);
  if (revSortKey === null) {
    safeUnlink(file.path);
    return { file: file.originalname, ok: false, outcome: "bad_revision", error: `Unrecognized revision "${parsed.revLabel}" — must be a single letter A-Z or a whole number` };
  }

  const masterRow = await q.findActiveMasterIndexRow(parsed.jobNo, parsed.unitNo, parsed.pidName);
  if (!masterRow) {
    safeUnlink(file.path);
    return { file: file.originalname, ok: false, outcome: "not_in_index", pidName: parsed.pidName, error: `"${parsed.pidName}" isn't in the active Master Index for ${parsed.jobNo}/${parsed.unitNo} — add it there first` };
  }

  if (!(await q.isUserAssigned(user.id, !!user.isHod, parsed.jobNo, parsed.unitNo))) {
    safeUnlink(file.path);
    return { file: file.originalname, ok: false, outcome: "not_assigned", pidName: parsed.pidName, error: `You are not assigned to ${parsed.jobNo}/${parsed.unitNo} as GL or ISO Manager` };
  }

  // multer only staged the file generically (see pidRoutes.js) — filename
  // parsing determines the real destination, so the move happens here, in
  // application code, where a bad file can be skipped without multer aborting
  // the whole batch (its storage-engine callbacks can't do partial failure).
  const buffer = fs.readFileSync(file.path);
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

  const finalDir = path.join(UPLOADS_ROOT, parsed.jobNo, parsed.unitNo, "PID");
  fs.mkdirSync(finalDir, { recursive: true });
  const finalPath = path.join(finalDir, path.basename(file.path));
  fs.renameSync(file.path, finalPath);
  const relPath = path.relative(UPLOADS_ROOT, finalPath).split(path.sep).join("/");

  const current = await dq.getCurrentDocument(masterRow.id);

  // Exact re-upload of what's already current — nothing to verify, it
  // already went through this gate once. Short-circuits before spending any
  // time on PDF extraction.
  if (current && revSortKey === current.rev_sort_key && fileHash === current.file_hash) {
    safeUnlink(finalPath);
    return { file: file.originalname, ok: true, outcome: "duplicate_noop", pidName: parsed.pidName, revLabel: parsed.revLabel };
  }

  // Older than current, no force — rejected outright regardless of content,
  // so there's no point running extraction on a file that isn't being kept.
  if (current && revSortKey < current.rev_sort_key && !force) {
    safeUnlink(finalPath);
    return {
      file: file.originalname, ok: false, outcome: "blocked_older", pidName: parsed.pidName,
      revLabel: parsed.revLabel, currentRev: current.rev_label,
      error: `Rev ${parsed.revLabel} is older than the current Rev ${current.rev_label} on file — blocked. Re-upload with "force" and a reason if this is intentional.`,
    };
  }
  if (current && revSortKey < current.rev_sort_key && force && !forceReason) {
    safeUnlink(finalPath);
    return { file: file.originalname, ok: false, outcome: "blocked_older", pidName: parsed.pidName, error: "A reason is required to force an older revision to become current" };
  }

  // ── Step 4/5: read the PDF's own title block and cross-check it against
  // what the filename declared. Everything from here on (first upload,
  // supersede, conflict, forced-older) only actually applies once verified —
  // an unverified file is parked as pending_review instead, regardless of
  // what its structural outcome would otherwise have been. ──
  let extraction;
  try {
    extraction = await extractTitleBlock(finalPath);
  } catch (err) {
    console.error("title block extraction error:", err);
    extraction = { matched: false };
  }

  let parseConfidence;
  let verified = false;
  if (!extraction.matched) {
    parseConfidence = "unrecognized";
  } else {
    const nameOk = namesMatch(parsed.pidName, extraction.parsedName);
    const revOk = revsMatch(parsed.revLabel, extraction.parsedRevision);
    verified = nameOk && revOk;
    parseConfidence = verified ? "matched" : "mismatch";
  }

  if (!verified) {
    const doc = await dq.insertAsPendingReview({
      masterIndexId: masterRow.id, revLabel: parsed.revLabel, revSortKey,
      fileName: file.originalname, filePath: relPath, fileHash, uploadedBy: user.id,
      parsedPidName: extraction.matched ? extraction.parsedName : null,
      parsedRevLabel: extraction.matched ? extraction.parsedRevision : null,
      parseConfidence,
    });
    await auditQ.logAction({
      action: "document_pending_review", masterIndexId: masterRow.id, documentId: doc.id, performedBy: user.id,
      details: {
        pidName: parsed.pidName, declaredRev: parsed.revLabel, fileName: file.originalname,
        parsedName: extraction.matched ? extraction.parsedName : null,
        parsedRev: extraction.matched ? extraction.parsedRevision : null,
        reason: parseConfidence,
      },
    });
    return {
      file: file.originalname, ok: true, outcome: "pending_review", pidName: parsed.pidName, revLabel: parsed.revLabel,
      parseConfidence, parsedName: extraction.matched ? extraction.parsedName : null,
      parsedRevision: extraction.matched ? extraction.parsedRevision : null, doc,
    };
  }

  const parsedFields = { parsedPidName: extraction.parsedName, parsedRevLabel: extraction.parsedRevision, parseConfidence: "matched" };

  if (!current) {
    const doc = await dq.insertAsCurrent({
      masterIndexId: masterRow.id, revLabel: parsed.revLabel, revSortKey,
      fileName: file.originalname, filePath: relPath, fileHash, uploadedBy: user.id, ...parsedFields,
    });
    await auditQ.logAction({
      action: "document_uploaded", masterIndexId: masterRow.id, documentId: doc.id, performedBy: user.id,
      details: { pidName: parsed.pidName, revLabel: parsed.revLabel, fileName: file.originalname },
    });
    await reExtractLines(masterRow.id, doc);
    return { file: file.originalname, ok: true, outcome: "first_upload", pidName: parsed.pidName, revLabel: parsed.revLabel, doc };
  }

  if (revSortKey > current.rev_sort_key) {
    const doc = await dq.supersedeCurrent({
      masterIndexId: masterRow.id, oldDocId: current.id, revLabel: parsed.revLabel, revSortKey,
      fileName: file.originalname, filePath: relPath, fileHash, uploadedBy: user.id, ...parsedFields,
    });
    await auditQ.logAction({
      action: "document_superseded", masterIndexId: masterRow.id, documentId: doc.id, performedBy: user.id,
      details: { pidName: parsed.pidName, oldRev: current.rev_label, newRev: parsed.revLabel, fileName: file.originalname },
    });
    await reExtractLines(masterRow.id, doc);
    return { file: file.originalname, ok: true, outcome: "superseded_previous", pidName: parsed.pidName, revLabel: parsed.revLabel, previousRev: current.rev_label, doc };
  }

  if (revSortKey === current.rev_sort_key) {
    // The exact-duplicate case was already short-circuited above, so
    // reaching here with equal rev_sort_key means the content genuinely
    // differs — a real conflict.
    const doc = await dq.insertAsConflict({
      masterIndexId: masterRow.id, revLabel: parsed.revLabel, revSortKey,
      fileName: file.originalname, filePath: relPath, fileHash, uploadedBy: user.id, ...parsedFields,
    });
    await auditQ.logAction({
      action: "document_conflict", masterIndexId: masterRow.id, documentId: doc.id, performedBy: user.id,
      details: { pidName: parsed.pidName, revLabel: parsed.revLabel, fileName: file.originalname, existingFile: current.file_name },
    });
    return {
      file: file.originalname, ok: false, outcome: "conflict", pidName: parsed.pidName, revLabel: parsed.revLabel,
      error: `Rev ${parsed.revLabel} already exists with different content — parked for manual resolution, not applied`,
      doc,
    };
  }

  // revSortKey < current.rev_sort_key, force + forceReason both present (the
  // no-force and no-reason rejections already happened above)
  const doc = await dq.supersedeCurrent({
    masterIndexId: masterRow.id, oldDocId: current.id, revLabel: parsed.revLabel, revSortKey,
    fileName: file.originalname, filePath: relPath, fileHash, uploadedBy: user.id, overrideReason: forceReason, ...parsedFields,
  });
  await auditQ.logAction({
    action: "document_forced_override", masterIndexId: masterRow.id, documentId: doc.id, performedBy: user.id,
    reason: forceReason,
    details: { pidName: parsed.pidName, oldRev: current.rev_label, newRev: parsed.revLabel, fileName: file.originalname },
  });
  await reExtractLines(masterRow.id, doc);
  return {
    file: file.originalname, ok: true, outcome: "forced_older_current", pidName: parsed.pidName,
    revLabel: parsed.revLabel, previousRev: current.rev_label, doc,
  };
}

// POST /api/pid/documents/:id/resolve  { action: 'accept'|'reject', reason? }
// A pending_review document's declared identity (already validated against
// the Master Index at upload time) either gets accepted — applying the same
// current/supersede/conflict lifecycle Step 7 already has, just deferred
// until now — or rejected outright, leaving the file/row in place (never
// deleted) but permanently excluded from ever being current.
async function resolvePendingDocument(req, res) {
  try {
    const user = req.session.user;
    const { id } = req.params;
    const { action, reason } = req.body || {};

    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ ok: false, error: 'action must be "accept" or "reject"' });
    }

    const pendingDoc = await dq.getDocumentById(id);
    if (!pendingDoc || pendingDoc.status !== "pending_review") {
      return res.status(404).json({ ok: false, error: "Pending review document not found (already resolved?)" });
    }

    if (action === "reject") {
      const doc = await dq.rejectDocument(id, user.id, reason);
      await auditQ.logAction({
        action: "document_review_rejected", masterIndexId: pendingDoc.master_index_id, documentId: pendingDoc.id,
        performedBy: user.id, reason,
      });
      return res.json({ ok: true, outcome: "rejected", doc });
    }

    // action === "accept" — re-check what's current right now, not what it
    // was at upload time, in case something else became current meanwhile.
    const current = await dq.getCurrentDocument(pendingDoc.master_index_id);

    if (!current) {
      const doc = await dq.promotePendingToCurrent(pendingDoc.id, null, user.id);
      await auditQ.logAction({
        action: "document_review_accepted", masterIndexId: pendingDoc.master_index_id, documentId: doc.id,
        performedBy: user.id, reason, details: { outcome: "first_upload" },
      });
      await reExtractLines(pendingDoc.master_index_id, doc);
      return res.json({ ok: true, outcome: "current", doc });
    }

    if (pendingDoc.rev_sort_key > current.rev_sort_key) {
      const doc = await dq.promotePendingToCurrent(pendingDoc.id, current.id, user.id);
      await auditQ.logAction({
        action: "document_review_accepted", masterIndexId: pendingDoc.master_index_id, documentId: doc.id,
        performedBy: user.id, reason, details: { outcome: "superseded_previous", oldRev: current.rev_label },
      });
      await reExtractLines(pendingDoc.master_index_id, doc);
      return res.json({ ok: true, outcome: "superseded_previous", doc });
    }

    if (pendingDoc.rev_sort_key === current.rev_sort_key) {
      if (pendingDoc.file_hash === current.file_hash) {
        // Something else already became current with identical content
        // while this sat pending — nothing left to apply.
        const doc = await dq.rejectDocument(id, user.id, "Automatically rejected — identical to the current revision by the time this was reviewed");
        await auditQ.logAction({
          action: "document_review_rejected", masterIndexId: pendingDoc.master_index_id, documentId: doc.id,
          performedBy: user.id, reason: "duplicate at resolve time",
        });
        return res.json({ ok: true, outcome: "duplicate_noop", doc });
      }
      const doc = await dq.markPendingAsConflict(pendingDoc.id, user.id);
      await auditQ.logAction({
        action: "document_review_accepted", masterIndexId: pendingDoc.master_index_id, documentId: doc.id,
        performedBy: user.id, reason, details: { outcome: "conflict" },
      });
      return res.json({ ok: true, outcome: "conflict", doc });
    }

    // pendingDoc.rev_sort_key < current.rev_sort_key — older than what's
    // live right now. Accepting this still needs an explicit reason, same
    // safety invariant as the force-upload path.
    if (!reason) {
      return res.status(400).json({ ok: false, error: "A reason is required to accept a revision older than what is currently live" });
    }
    const doc = await dq.promotePendingToCurrent(pendingDoc.id, current.id, user.id, reason);
    await auditQ.logAction({
      action: "document_review_accepted", masterIndexId: pendingDoc.master_index_id, documentId: doc.id,
      performedBy: user.id, reason, details: { outcome: "forced_older_current", oldRev: current.rev_label },
    });
    await reExtractLines(pendingDoc.master_index_id, doc);
    return res.json({ ok: true, outcome: "forced_older_current", doc });
  } catch (err) {
    console.error("resolvePendingDocument error:", err);
    res.status(500).json({ ok: false, error: "Failed to resolve pending document" });
  }
}

// GET /api/pid/lines?jobNo=&unitNo=
// Every extracted line across all active P&IDs' *current* revision for a
// Job/Unit — the real data source for the "Extractor from P&ID" tool.
// Read-only, open to any logged-in user (same reference-material visibility
// as pid-view.html) — no GL/ISO Manager gate here, unlike the write routes.
async function getLinesByJobUnit(req, res) {
  try {
    const { jobNo, unitNo } = req.query;
    if (!jobNo || !unitNo) {
      return res.status(400).json({ ok: false, error: "jobNo and unitNo are required" });
    }
    const lines = await lq.getLinesForJobUnit(jobNo, unitNo);
    res.json({ ok: true, lines });
  } catch (err) {
    console.error("getLinesByJobUnit error:", err);
    res.status(500).json({ ok: false, error: "Failed to load extracted lines" });
  }
}

// GET /api/pid/master-index/:id/documents
async function getDocumentHistory(req, res) {
  try {
    const { id } = req.params;
    const [documents, auditLog] = await Promise.all([
      dq.getDocumentsForMasterIndex(id),
      auditQ.getAuditLog(id),
    ]);
    res.json({ ok: true, documents, auditLog });
  } catch (err) {
    console.error("getDocumentHistory error:", err);
    res.status(500).json({ ok: false, error: "Failed to load document history" });
  }
}

module.exports = { uploadPidDocuments, getDocumentHistory, resolvePendingDocument, getLinesByJobUnit };
