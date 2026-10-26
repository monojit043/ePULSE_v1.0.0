const { parsePidName } = require("./pidNameParser");

// Filename convention: <P&ID-Name>_<Rev>.<ext> — the revision follows the
// LAST underscore, as Process issues them.
// e.g. B862-79-41-101-11045_4.pdf, B862-79-41-101-11048-2_0.pdf,
//      B862-79-41-101-11115A_1.pdf
// The older <P&ID-Name>_Rev<X> form (B378-02-42-111-11902_RevA.pdf) is still
// accepted; the "Rev" prefix is dropped, so both give the same revision.
// The P&ID Name portion must itself match the org's JOB-XX-XX-UNIT-SERIAL
// convention (backend/utils/pidNameParser.js) — a file can't declare a
// revision for a name that isn't even shaped like a real P&ID.
function parsePidFileName(originalFileName) {
  const base = String(originalFileName || "").trim().replace(/\.[^.]+$/, "");
  const m = base.match(/^(.+)_(?:Rev)?([A-Za-z0-9]+)$/i);
  if (!m) return null;

  const pidName = m[1];
  const revLabel = m[2].toUpperCase();
  const parsedName = parsePidName(pidName);
  if (!parsedName) return null;

  return {
    pidName,
    revLabel,
    jobNo: parsedName.jobNo,
    unitNo: parsedName.unitNo,
    serialNo: parsedName.serialNo,
  };
}

module.exports = { parsePidFileName };
