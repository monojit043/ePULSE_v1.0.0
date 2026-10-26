// Shared parser for this org's fixed P&ID naming convention:
//   {JOB}-{XX}-{XX}-{UNIT}-{SERIAL}
// e.g. B378-02-42-111-11902, ...-111-11902A, ...-111-11902-01
//
// Job is always the 1st dash-separated segment, Unit is always the 4th.
// Everything from the 5th segment onward is the serial number, which can
// itself contain a dash (a "-01" suffix) or a trailing letter (A/B/C), so
// it's rejoined rather than treated as a single fixed segment.
function parsePidName(rawName) {
  const name = String(rawName || "").trim();
  const parts = name.split("-");
  if (parts.length < 5) return null;

  const jobNo = parts[0].trim();
  const unitNo = parts[3].trim();
  const serialNo = parts.slice(4).join("-").trim();
  if (!jobNo || !unitNo || !serialNo) return null;

  return { jobNo, unitNo, serialNo };
}

module.exports = { parsePidName };
