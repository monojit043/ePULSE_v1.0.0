// Locked ordering (Step 0 of the P&ID indexing design): a single linear
// sequence, letters before numbers — A < B < ... < Z < 0 < 1 < 2 < ...
// This org's P&IDs use letters (A-Z, single letter only, no AA/AB) during the
// pre-engineering "issued for comments" stage, then switch to numbers once
// issued as engineering. Numbers compare as integers (Rev0 == Rev00);
// letters compare case-insensitively.
//
// Returns a comparable integer, or null if the label doesn't fit either
// scheme — callers must treat null as "reject, don't guess an ordering."
function revisionSortKey(rawLabel) {
  const label = String(rawLabel || "").trim();
  if (/^[A-Za-z]$/.test(label)) {
    return label.toUpperCase().charCodeAt(0) - 64; // A=1 ... Z=26
  }
  if (/^\d+$/.test(label)) {
    return 100 + parseInt(label, 10); // always > any letter's 1-26 range
  }
  return null;
}

module.exports = { revisionSortKey };
