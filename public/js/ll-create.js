// ── Create Piping Line List ──────────────────────────────────────────────────
// Steps A, C and D are all real now:
//   - A (Extractor from P&ID): GET /api/pid/lines (cplLoadPidLines)
//   - C (Consolidated List): GET /api/pid/consolidated-lines (cplLoadConsolidated)
//   - D (Allocate Zone): GET /api/pid/consolidated-lines again, its own
//     independent Job/Unit filter (cplLoadAllocateLines) — not fed by Step C,
//     each step re-fetches for whatever Job/Unit its own inputs say.
// Step B (SP P&ID) is still a client-side mock (cplMockExtract) with no real
// backend of its own yet. It used to feed Step D's zone allocation via
// cplBuildConsolidated(); now that D is real, Step B's mock output has no
// downstream consumer — it still renders its own result table, just orphaned
// from the rest of the flow until SP P&ID gets a real backend.
// State lives only in memory for this tab — nothing persists across a refresh.

// ── Shared state ─────────────────────────────────────────────────────────
var cplState = {
  files: { pid: [], sp: [] },          // File objects staged for upload, per source
  extracted: { pid: [], sp: [] },      // { lineNo, size, spec, sheetNo, sourceFile } rows, per source
  consolidated: [],                    // deduped merge of extracted.pid + extracted.sp — no consumer since Step D went real; kept for when Step B gets a real backend
  selected: {},                        // fullLineNo -> true, for Step D bulk selection
  consolidatedReal: { lines: [], mismatches: [], stats: null }, // Step C's own real data from /api/pid/consolidated-lines
  allocateReal: { lines: [], stats: null }, // Step D's own real data from /api/pid/consolidated-lines — independent Job/Unit filter from Step C's
};

var cplPanelLabels = {
  'extract-pid': 'Line List Extractor from P&ID',
  'extract-sp':  'Line List from SP P&ID',
  'consolidated':'Consolidated Line List',
  'allocate':    'Allocate Zone & Create Piping Line List',
};

// Real line tags contain a literal " (inch mark, e.g. 1"-IG-111-90201-A3A-NI)
// — embedding one unescaped inside a double-quoted HTML attribute truncates
// the attribute at that character (found while building Step D's zone UI:
// data-line="1"-IG-..." was silently becoming data-line="1", merging every
// row whose tag happened to start with the same leading digit). Any lineNo
// going into a plain HTML attribute (data-line, title) must go through this.
function cplEscAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// For a value embedded as a JS string-literal ARGUMENT inside an inline
// event-handler attribute (onchange="fn('VALUE', ...)"): the browser
// HTML-decodes the attribute text BEFORE running it as script, so escaping
// a quote as an HTML entity (&#39;) does NOT protect the JS string — it
// decodes right back to a literal ' before the JS parser ever sees it.
// The JS string itself has to be escaped first (backslash, then quote),
// and only then does the result get HTML-escaped for the outer attribute.
function cplEscJsAttr(s) {
  var jsEscaped = String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return cplEscAttr(jsEscaped);
}

// ── Sidebar / panel switching ───────────────────────────────────────────────
function cplSwitchPanel(key) {
  document.querySelectorAll('.cpl-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.panel === key);
  });
  document.querySelectorAll('.cpl-panel').forEach(function(el) {
    el.classList.toggle('active', el.id === 'panel-' + key);
  });
  var bc = document.getElementById('cplBreadCurr');
  if (bc) bc.textContent = cplPanelLabels[key] || '';

  // Steps A, C and D (/api/pid/lines, /api/pid/consolidated-lines twice) are
  // real. Only Step B (SP P&ID source) is still mock data, so the preview
  // banner reflects that.
  var tag = document.getElementById('cplBcTag');
  var tagText = document.getElementById('cplBcTagText');
  if (tag && tagText) {
    if (key === 'extract-pid') {
      tag.title = 'Reads real lines from currently-approved P&ID revisions already uploaded to the system';
      tagText.textContent = 'Live data — from uploaded P&IDs';
    } else if (key === 'consolidated') {
      tag.title = 'Merges real P&ID-extracted lines with real Line List Normalizer data for this Job/Unit';
      tagText.textContent = 'Live data — P&ID + Line List Normalizer';
    } else if (key === 'allocate') {
      tag.title = 'Loads the real Consolidated Line List for this Job/Unit — zone assignment and Create Line List stay a preview';
      tagText.textContent = 'Live data — zone assignment not yet saved';
    } else {
      tag.title = 'Extraction below generates sample lines locally — the real P&ID parsing service isn\'t wired up yet';
      tagText.textContent = 'Frontend preview — no backend yet';
    }
  }

  // Both C and D own their own independent Job/Unit fetch and only
  // re-render already-loaded data on revisit; neither re-fetches automatically.
  if (key === 'consolidated') cplRenderConsolidatedReal();
  if (key === 'allocate') cplRenderAllocate();
}
window.cplSwitchPanel = cplSwitchPanel;

// ── File upload (drag-drop + click), shared by Step A and Step B ──────────
function cplFmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function cplFileIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function cplRenderFileList(source) {
  var listEl = document.getElementById(source === 'pid' ? 'cplFileListA' : 'cplFileListB');
  var extractBtn = document.getElementById(source === 'pid' ? 'cplExtractBtnA' : 'cplExtractBtnB');
  var files = cplState.files[source];
  listEl.innerHTML = files.map(function(f, idx) {
    return '<div class="cpl-file-chip">' + cplFileIcon() +
      '<span class="cpl-file-chip-name">' + f.name + '</span>' +
      '<span class="cpl-file-chip-size">' + cplFmtBytes(f.size) + '</span>' +
      '<button class="cpl-file-chip-remove" onclick="cplRemoveFile(\'' + source + '\',' + idx + ')" title="Remove">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></div>';
  }).join('');
  extractBtn.disabled = files.length === 0;
}

function cplAddFiles(source, fileList) {
  Array.from(fileList).forEach(function(f) { cplState.files[source].push(f); });
  cplRenderFileList(source);
}

function cplRemoveFile(source, idx) {
  cplState.files[source].splice(idx, 1);
  cplRenderFileList(source);
}
window.cplRemoveFile = cplRemoveFile;

function cplSetupDropZone(dropId, inputId, source) {
  var drop = document.getElementById(dropId);
  var input = document.getElementById(inputId);
  if (!drop || !input) return;

  input.addEventListener('change', function() {
    cplAddFiles(source, input.files);
    input.value = ''; // allow re-selecting the same file after removal
  });

  ['dragenter', 'dragover'].forEach(function(evt) {
    drop.addEventListener(evt, function(e) {
      e.preventDefault(); e.stopPropagation();
      drop.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(function(evt) {
    drop.addEventListener(evt, function(e) {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove('drag-over');
    });
  });
  drop.addEventListener('drop', function(e) {
    if (e.dataTransfer && e.dataTransfer.files.length) cplAddFiles(source, e.dataTransfer.files);
  });
}

// ── Mock extraction ─────────────────────────────────────────────────────────
// Generates plausible-looking piping line numbers so the rest of the flow
// (consolidation, dedup, zone allocation) has real data to work with. Not
// connected to the uploaded files' actual content in any way — clearly
// labelled as a preview via the .ll-bc-tag in the breadcrumb bar.
var CPL_SIZES = ['2"', '3"', '4"', '6"', '8"', '10"', '12"', '16"', '20"', '24"'];
var CPL_SPECS = ['A1A', 'B2B', 'C3C', 'D4D', 'A1B'];

function cplMockExtract(source, unit, fileCount) {
  var count = Math.max(3, Math.min(10, fileCount * 3 + Math.floor(Math.random() * 3)));
  var prefix = source === 'sp' ? 'SP' : 'P';
  var rows = [];
  var usedLineNos = {};
  for (var i = 0; i < count; i++) {
    var num = 10000 + Math.floor(Math.random() * 89999);
    var rev = String.fromCharCode(65 + Math.floor(Math.random() * 4)); // A-D
    var lineNo = prefix + '-' + (unit || '101') + '-' + num + '-' + rev;
    if (usedLineNos[lineNo]) { i--; continue; }
    usedLineNos[lineNo] = true;
    rows.push({
      lineNo: lineNo,
      size: CPL_SIZES[Math.floor(Math.random() * CPL_SIZES.length)],
      spec: CPL_SPECS[Math.floor(Math.random() * CPL_SPECS.length)],
      sheetNo: 'SH-' + (i + 1),
      sourceFile: cplState.files[source][i % cplState.files[source].length].name,
    });
  }
  return rows;
}

// ── Step A: real extraction from already-uploaded P&IDs ────────────────────
// Unlike Step B (SP P&ID, still a mock preview), Step A now reads real data
// from the P&ID system's pid_extracted_lines table via /api/pid/lines. Rows
// are mapped into the SAME shape cplMockExtract produces ({lineNo, size,
// spec, sheetNo, sourceFile}) specifically so Steps C/D (consolidation, zone
// allocation) keep working completely unchanged — they only ever read that
// generic shape, never caring how it was populated. sheetNo/sourceFile are
// repurposed here to carry service code / source P&ID name respectively —
// see the Step A table's own headers in ll-create.html for what they render as.
function cplCheckPidReady() {
  var job = document.getElementById('cplJobA').value.trim();
  var unit = document.getElementById('cplUnitA').value.trim();
  document.getElementById('cplExtractBtnA').disabled = !(job && unit);
}
window.cplCheckPidReady = cplCheckPidReady;

async function cplLoadPidLines() {
  var job = document.getElementById('cplJobA').value.trim();
  var unit = document.getElementById('cplUnitA').value.trim();
  if (!job || !unit) return;

  var extractingEl = document.getElementById('cplExtractingA');
  var extractBtn = document.getElementById('cplExtractBtnA');
  extractingEl.style.display = 'flex';
  extractBtn.disabled = true;

  try {
    var res = await fetch('/api/pid/lines?jobNo=' + encodeURIComponent(job) + '&unitNo=' + encodeURIComponent(unit));
    var data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Failed to load lines');
      cplState.extracted.pid = [];
    } else {
      cplState.extracted.pid = data.lines.map(function(l) {
        return {
          lineNo: l.full_line_no,
          size: l.size_in,
          spec: l.piping_spec,
          sheetNo: l.service,      // repurposed column, see table header
          sourceFile: l.pid_name,  // repurposed column, see table header
          insulType: l.insul_type,
        };
      });
    }
    cplRenderExtractedTable('pid');
    cplUpdateBadges();
  } catch (e) {
    console.error('load pid lines error:', e);
    alert('Network error while loading lines');
  } finally {
    extractingEl.style.display = 'none';
    extractBtn.disabled = false;
  }
}
window.cplLoadPidLines = cplLoadPidLines;

function cplClearPidResults() {
  cplState.extracted.pid = [];
  document.getElementById('cplResultCardA').style.display = 'none';
  document.getElementById('cplJobA').value = '';
  document.getElementById('cplUnitA').value = '';
  cplCheckPidReady();
  cplUpdateBadges();
}
window.cplClearPidResults = cplClearPidResults;

function cplExtract(source) {
  var files = cplState.files[source];
  if (!files.length) return;
  var unitInput = document.getElementById(source === 'pid' ? 'cplUnitA' : 'cplUnitB');
  var extractingEl = document.getElementById(source === 'pid' ? 'cplExtractingA' : 'cplExtractingB');
  var extractBtn = document.getElementById(source === 'pid' ? 'cplExtractBtnA' : 'cplExtractBtnB');

  extractingEl.style.display = 'flex';
  extractBtn.disabled = true;

  setTimeout(function() {
    var rows = cplMockExtract(source, unitInput.value.trim(), files.length);
    cplState.extracted[source] = rows;
    extractingEl.style.display = 'none';
    extractBtn.disabled = false;
    cplRenderExtractedTable(source);
    cplUpdateBadges();
  }, 1100);
}
window.cplExtract = cplExtract;

function cplRenderExtractedTable(source) {
  var card = document.getElementById(source === 'pid' ? 'cplResultCardA' : 'cplResultCardB');
  var sub = document.getElementById(source === 'pid' ? 'cplResultSubA' : 'cplResultSubB');
  var tbody = document.querySelector((source === 'pid' ? '#cplTableA' : '#cplTableB') + ' tbody');
  var rows = cplState.extracted[source];

  // Always show the card once a load/extract has been attempted — a real
  // Job/Unit filter can legitimately return zero lines (no P&ID uploaded
  // yet), and that's worth showing explicitly rather than looking like
  // nothing happened. The mock 'sp' path never actually hits the zero case
  // (always generates 3+ rows), so this is a no-op behavior change there.
  card.style.display = 'block';
  sub.textContent = source === 'pid'
    ? rows.length + ' line' + (rows.length === 1 ? '' : 's') + ' found'
    : rows.length + ' line' + (rows.length === 1 ? '' : 's') + ' found across ' + cplState.files[source].length + ' file' + (cplState.files[source].length === 1 ? '' : 's');
  tbody.innerHTML = rows.map(function(r) {
    return '<tr><td style="font-weight:700;color:var(--blue-700);font-family:monospace;font-size:12px;">' + r.lineNo + '</td>' +
      '<td>' + r.size + '</td><td>' + r.spec + '</td><td class="muted">' + r.sheetNo + '</td>' +
      '<td class="muted">' + r.sourceFile + '</td></tr>';
  }).join('');
}

function cplClearSource(source) {
  cplState.files[source] = [];
  cplState.extracted[source] = [];
  cplRenderFileList(source);
  document.getElementById(source === 'pid' ? 'cplResultCardA' : 'cplResultCardB').style.display = 'none';
  cplUpdateBadges();
}
window.cplClearSource = cplClearSource;

// ── Sidebar badges ───────────────────────────────────────────────────────
// Plain counts, not status sentences — matches the sidebar's own compact
// .nav-badge convention (e.g. #inboxBadge in user.html), and leaves the
// full label width for the step name instead of competing with it.
function cplUpdateBadges() {
  var a = cplState.extracted.pid.length, b = cplState.extracted.sp.length;
  cplSetBadge('cplBadgeA', a, a > 0);
  cplSetBadge('cplBadgeB', b, b > 0);

  // Badge C and D each reflect their own independent real fetch.
  var c = cplState.consolidatedReal.lines.length;
  cplSetBadge('cplBadgeC', c, c > 0);

  var allocateLines = cplState.allocateReal.lines;
  var d = allocateLines.length;
  var zoned = allocateLines.filter(function(r) { return cplZonesOf(r.fullLineNo).length > 0; }).length;
  cplSetBadge('cplBadgeD', d ? (zoned + '/' + d) : 0, zoned > 0 && zoned === d);
}

function cplSetBadge(id, text, hasData) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('has-data', !!hasData);
}

// ── Zone assignment (Step D) ────────────────────────────────────────────────
// A line can carry more than one zone — real drawings.zone data (checked
// directly in the DB) spans single letters A–H with no fixed enum, and a
// physical line can legitimately be split across more than one. So this maps
// fullLineNo -> array of zone letters, not a single value.
var CPL_ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
var cplZoneByLineNo = {};
function cplZonesOf(lineNo) { return cplZoneByLineNo[lineNo] || []; }
function cplToggleZone(lineNo, zone) {
  var arr = cplZonesOf(lineNo).slice();
  var idx = arr.indexOf(zone);
  if (idx >= 0) arr.splice(idx, 1); else arr.push(zone);
  if (arr.length) cplZoneByLineNo[lineNo] = arr; else delete cplZoneByLineNo[lineNo];
}

function cplZonePillsHtml(lineNo, activeZones) {
  var lineNoJs = cplEscJsAttr(lineNo);
  return CPL_ZONES.map(function(z) {
    var active = activeZones.indexOf(z) >= 0;
    return '<label class="cpl-zone-pill' + (active ? ' active' : '') + '">' +
      '<input type="checkbox" value="' + z + '"' + (active ? ' checked' : '') +
      ' onchange="cplOnZonePillToggle(\'' + lineNoJs + '\', \'' + z + '\', this)">' + z + '</label>';
  }).join('');
}

function cplOnZonePillToggle(lineNo, zone, cbEl) {
  cplToggleZone(lineNo, zone);
  cbEl.closest('.cpl-zone-pill').classList.toggle('active', cbEl.checked);
  var group = cbEl.closest('.cpl-zone-pills');
  if (group) group.classList.toggle('unassigned', cplZonesOf(lineNo).length === 0);
  cplUpdateBadges();
}
window.cplOnZonePillToggle = cplOnZonePillToggle;

function cplBuildConsolidated() {
  var byLine = {};
  cplState.extracted.pid.forEach(function(r) {
    byLine[r.lineNo] = { lineNo: r.lineNo, size: r.size, spec: r.spec, sources: ['pid'] };
  });
  cplState.extracted.sp.forEach(function(r) {
    if (byLine[r.lineNo]) { byLine[r.lineNo].sources.push('sp'); }
    else { byLine[r.lineNo] = { lineNo: r.lineNo, size: r.size, spec: r.spec, sources: ['sp'] }; }
  });
  var rows = Object.keys(byLine).sort().map(function(k) { return byLine[k]; });
  cplState.consolidated = rows;
  return rows;
}

// Step C is a real Job/Unit-filtered fetch to GET /api/pid/consolidated-lines
// — merges pid_extracted_lines with linelist_lines, matched on (unit_no,
// seq_no). Deliberately independent of cplState.extracted / cplBuildConsolidated
// above, which stay dedicated to Step D's still-mock A+B merge preview.
function cplCheckConsolReady() {
  var job = document.getElementById('cplJobC').value.trim();
  var unit = document.getElementById('cplUnitC').value.trim();
  document.getElementById('cplExtractBtnC').disabled = !(job && unit);
}
window.cplCheckConsolReady = cplCheckConsolReady;

async function cplLoadConsolidated() {
  var job = document.getElementById('cplJobC').value.trim();
  var unit = document.getElementById('cplUnitC').value.trim();
  if (!job || !unit) return;

  var extractingEl = document.getElementById('cplExtractingC');
  var extractBtn = document.getElementById('cplExtractBtnC');
  extractingEl.style.display = 'flex';
  extractBtn.disabled = true;

  try {
    var res = await fetch('/api/pid/consolidated-lines?jobNo=' + encodeURIComponent(job) + '&unitNo=' + encodeURIComponent(unit));
    var data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Failed to build consolidated list');
      cplState.consolidatedReal = { lines: [], mismatches: [], stats: null };
    } else {
      cplState.consolidatedReal = { lines: data.lines, mismatches: data.mismatches, stats: data.stats };
    }
    cplRenderConsolidatedReal();
    cplUpdateBadges();
  } catch (e) {
    console.error('load consolidated lines error:', e);
    alert('Network error while building consolidated list');
  } finally {
    extractingEl.style.display = 'none';
    extractBtn.disabled = false;
  }
}
window.cplLoadConsolidated = cplLoadConsolidated;

function cplClearConsolidatedResults() {
  cplState.consolidatedReal = { lines: [], mismatches: [], stats: null };
  document.getElementById('cplJobC').value = '';
  document.getElementById('cplUnitC').value = '';
  document.getElementById('cplConsolidatedSearch').value = '';
  cplCheckConsolReady();
  cplRenderConsolidatedReal();
  cplUpdateBadges();
}
window.cplClearConsolidatedResults = cplClearConsolidatedResults;

function cplRenderConsolidatedReal() {
  var loaded = cplState.consolidatedReal.stats !== null;
  var resultsEl = document.getElementById('cplConsolidatedResults');
  var emptyEl = document.getElementById('cplConsolidatedEmpty');

  if (!loaded) {
    resultsEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  resultsEl.style.display = 'block';

  var rows = cplState.consolidatedReal.lines;
  var mismatches = cplState.consolidatedReal.mismatches;
  var stats = cplState.consolidatedReal.stats;

  document.getElementById('cplStatTotal').textContent = rows.length;
  document.getElementById('cplStatFromPid').textContent = stats.totalPid;
  document.getElementById('cplStatFromLl').textContent = stats.totalLinelist;
  document.getElementById('cplStatMismatch').textContent = stats.mismatchCount;
  document.getElementById('cplResultSubC').textContent =
    rows.length + ' line' + (rows.length === 1 ? '' : 's') + ' — ' + stats.matched + ' matched in both sources';

  var term = (document.getElementById('cplConsolidatedSearch').value || '').toLowerCase().trim();
  var filtered = term ? rows.filter(function(r) {
    return (r.fullLineNo || '').toLowerCase().includes(term) || String(r.seqNo).toLowerCase().includes(term);
  }) : rows;

  var tbody = document.querySelector('#cplTableC tbody');
  tbody.innerHTML = filtered.map(function(r) {
    var srcBadges = r.sources.map(function(s) {
      return s === 'pid'
        ? '<span class="badge cpl-src-pid">P&ID</span>'
        : '<span class="badge badge-gray">Line List</span>';
    }).join(' ');
    var mismatchTag = r.hasMismatch ? '<span class="badge badge-amber">Mismatch</span>' : '';
    return '<tr><td style="font-weight:700;color:var(--blue-700);font-family:monospace;font-size:12px;">' + (r.fullLineNo || '<span class="muted">—</span>') + '</td>' +
      '<td>' + r.seqNo + '</td><td>' + (r.size || '') + '</td><td>' + (r.service || '') + '</td><td>' + (r.spec || '') + '</td>' +
      '<td>' + srcBadges + '</td><td>' + mismatchTag + '</td></tr>';
  }).join('');

  var mismatchCard = document.getElementById('cplMismatchCard');
  if (!mismatches.length) {
    mismatchCard.style.display = 'none';
  } else {
    mismatchCard.style.display = 'block';
    var mtbody = document.querySelector('#cplTableMismatch tbody');
    var fieldLabels = { size: 'Size', service: 'Service', spec: 'Spec' };
    mtbody.innerHTML = mismatches.map(function(m) {
      return m.diffFields.map(function(field) {
        return '<tr><td style="font-weight:700;">' + m.seqNo + '</td>' +
          '<td>' + fieldLabels[field] + '</td>' +
          '<td style="color:var(--blue-700);">' + (m.pid[field] || '') + '</td>' +
          '<td style="color:#92600a;">' + (m.linelist[field] || '') + '</td>' +
          '<td class="muted">' + (m.pid.sourcePid || '') + '</td>' +
          '<td class="muted">' + (m.linelist.sourcePid || '') + '</td></tr>';
      }).join('');
    }).join('');
  }
}
window.cplRenderConsolidatedReal = cplRenderConsolidatedReal;

// ── Step D: allocate zone & create ──────────────────────────────────────────
// Real, independent Job/Unit-filtered fetch to the same
// GET /api/pid/consolidated-lines endpoint Step C uses — its own filter
// inputs, its own state, not fed by whatever's currently loaded in Step C.
// Rows are identified by fullLineNo (the fluid code-unit-sequence no tag,
// e.g. "2"-CL-111-90205-A1A-IS" or the synthetic Line-List-only equivalent)
// for zone assignment/selection.
function cplCheckAllocateReady() {
  var job = document.getElementById('cplJobD').value.trim();
  var unit = document.getElementById('cplUnitD').value.trim();
  document.getElementById('cplLoadBtnD').disabled = !(job && unit);
}
window.cplCheckAllocateReady = cplCheckAllocateReady;

async function cplLoadAllocateLines() {
  var job = document.getElementById('cplJobD').value.trim();
  var unit = document.getElementById('cplUnitD').value.trim();
  if (!job || !unit) return;

  var extractingEl = document.getElementById('cplExtractingD');
  var loadBtn = document.getElementById('cplLoadBtnD');
  extractingEl.style.display = 'flex';
  loadBtn.disabled = true;

  try {
    var res = await fetch('/api/pid/consolidated-lines?jobNo=' + encodeURIComponent(job) + '&unitNo=' + encodeURIComponent(unit));
    var data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Failed to load lines');
      cplState.allocateReal = { lines: [], stats: null };
    } else {
      cplState.allocateReal = { lines: data.lines, stats: data.stats };
    }
    cplRenderAllocate();
    cplUpdateBadges();
  } catch (e) {
    console.error('load allocate lines error:', e);
    alert('Network error while loading lines');
  } finally {
    extractingEl.style.display = 'none';
    loadBtn.disabled = false;
  }
}
window.cplLoadAllocateLines = cplLoadAllocateLines;

function cplRenderAllocate() {
  var loaded = cplState.allocateReal.stats !== null;
  var rows = cplState.allocateReal.lines;
  var emptyEl = document.getElementById('cplAllocateEmpty');
  var wrapEl = document.getElementById('cplAllocateTableWrap');
  var createBtn = document.getElementById('cplCreateBtn');
  var subEl = document.getElementById('cplResultSubD');

  if (!rows.length) {
    emptyEl.style.display = 'block'; wrapEl.style.display = 'none';
    createBtn.disabled = true;
    subEl.textContent = loaded ? 'No lines found for this Job/Unit.' : '—';
    return;
  }
  emptyEl.style.display = 'none'; wrapEl.style.display = 'block';
  createBtn.disabled = false;
  subEl.textContent = rows.length + ' line' + (rows.length === 1 ? '' : 's');

  var tbody = document.querySelector('#cplTableD tbody');
  tbody.innerHTML = rows.map(function(r) {
    // The zone-assignment KEY stays the full tag (fullLineNo) — the short
    // service-unit-seq id shown to the user is NOT always unique (confirmed
    // on real B378/111 data: e.g. CL-111-90212 belongs to both a 6" and a
    // 10" line) — keying zone/selection off it would silently merge two
    // distinct lines' zone assignments. Only the display text is shortened;
    // the full tag stays in the title attribute so a duplicate-looking id
    // can still be told apart on hover.
    var lineNo = r.fullLineNo;
    var lineNoAttr = cplEscAttr(lineNo);
    var displayId = r.service + '-' + r.unitNo + '-' + r.seqNo;
    var srcBadges = r.sources.map(function(s) {
      return s === 'pid'
        ? '<span class="badge cpl-src-pid">P&ID</span>'
        : '<span class="badge badge-gray">Line List</span>';
    }).join(' ');
    var zones = cplZonesOf(lineNo);
    var checked = cplState.selected[lineNo] ? 'checked' : '';
    return '<tr>' +
      '<td><input type="checkbox" class="cpl-row-check" data-line="' + lineNoAttr + '" ' + checked + ' onchange="cplToggleRow(this)"></td>' +
      '<td style="font-weight:700;color:var(--blue-700);font-family:monospace;font-size:12px;" title="' + lineNoAttr + '">' + displayId + '</td>' +
      '<td>' + (r.size || '') + '</td><td>' + (r.spec || '') + '</td><td>' + srcBadges + '</td>' +
      '<td><div class="cpl-zone-pills' + (zones.length ? '' : ' unassigned') + '">' + cplZonePillsHtml(lineNo, zones) + '</div></td>' +
      '</tr>';
  }).join('');

  cplUpdateBulkBar();
}
window.cplRenderAllocate = cplRenderAllocate;

function cplToggleRow(cb) {
  if (cb.checked) cplState.selected[cb.dataset.line] = true; else delete cplState.selected[cb.dataset.line];
  cplUpdateBulkBar();
}
window.cplToggleRow = cplToggleRow;

function cplToggleSelectAll(masterCb) {
  var rows = cplState.allocateReal.lines;
  if (masterCb.checked) rows.forEach(function(r) { cplState.selected[r.fullLineNo] = true; });
  else cplState.selected = {};
  document.querySelectorAll('.cpl-row-check').forEach(function(cb) { cb.checked = masterCb.checked; });
  cplUpdateBulkBar();
}
window.cplToggleSelectAll = cplToggleSelectAll;

function cplUpdateBulkBar() {
  var count = Object.keys(cplState.selected).length;
  var bar = document.getElementById('cplBulkBar');
  document.getElementById('cplBulkCount').textContent = count;
  bar.classList.toggle('show', count > 0);
}

// Bulk zone picker is its own small pill group, separate from any one row —
// "Apply to Selected" ADDS the checked zones to every selected row's zone
// set (union, doesn't overwrite already-assigned zones), consistent with how
// per-row pills behave.
var cplBulkPendingZones = [];
function cplRenderBulkZonePills() {
  var container = document.getElementById('cplBulkZonePills');
  if (!container) return;
  container.innerHTML = CPL_ZONES.map(function(z) {
    var active = cplBulkPendingZones.indexOf(z) >= 0;
    return '<label class="cpl-zone-pill' + (active ? ' active' : '') + '">' +
      '<input type="checkbox" value="' + z + '"' + (active ? ' checked' : '') +
      ' onchange="cplToggleBulkZone(\'' + z + '\', this)">' + z + '</label>';
  }).join('');
}

function cplToggleBulkZone(zone, cbEl) {
  var idx = cplBulkPendingZones.indexOf(zone);
  if (idx >= 0) cplBulkPendingZones.splice(idx, 1); else cplBulkPendingZones.push(zone);
  cbEl.closest('.cpl-zone-pill').classList.toggle('active', cbEl.checked);
}
window.cplToggleBulkZone = cplToggleBulkZone;

function cplBulkAssignZone() {
  if (!cplBulkPendingZones.length) return;
  Object.keys(cplState.selected).forEach(function(lineNo) {
    var arr = cplZonesOf(lineNo).slice();
    cplBulkPendingZones.forEach(function(z) { if (arr.indexOf(z) < 0) arr.push(z); });
    if (arr.length) cplZoneByLineNo[lineNo] = arr; else delete cplZoneByLineNo[lineNo];
  });
  cplState.selected = {};
  cplBulkPendingZones = [];
  cplRenderBulkZonePills();
  cplRenderAllocate();
}
window.cplBulkAssignZone = cplBulkAssignZone;

// Saves real: POSTs one row per (line, zone) pair to piping_line_list (a
// staging table — "this line is identified and zoned", not yet an uploaded
// ISO drawing). A line with more than one zone submits multiple rows — the
// table's unique key is (job_no, unit_no, zone, line_no), not line_no alone,
// so that's the correct shape, not a duplicate. Unzoned lines are left out
// client-side (server would reject them anyway) so the user isn't blocked
// from creating a partial list while some lines are still pending zone
// assignment.
async function cplCreateLineList() {
  var job = document.getElementById('cplJobD').value.trim();
  var unit = document.getElementById('cplUnitD').value.trim();
  var rows = cplState.allocateReal.lines;
  var zonedRows = rows.filter(function(r) { return cplZonesOf(r.fullLineNo).length > 0; });
  var unzonedCount = rows.length - zonedRows.length;

  if (!zonedRows.length) {
    alert('Assign a zone to at least one line before creating the list.');
    return;
  }

  var payloadLines = [];
  zonedRows.forEach(function(r) {
    cplZonesOf(r.fullLineNo).forEach(function(z) {
      payloadLines.push({
        zone: z, lineNo: r.fullLineNo, seqNo: r.seqNo,
        size: r.size, service: r.service, spec: r.spec, sources: r.sources,
      });
    });
  });

  var createBtn = document.getElementById('cplCreateBtn');
  createBtn.disabled = true;

  try {
    var res = await fetch('/api/piping-line-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobNo: job, unitNo: unit, lines: payloadLines }),
    });
    var data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Failed to create piping line list');
      return;
    }
    var msg = data.createdCount + ' line-zone entr' + (data.createdCount === 1 ? 'y' : 'ies') + ' added to the Piping Line List';
    if (data.alreadyExistedCount) msg += ', ' + data.alreadyExistedCount + ' already existed';
    if (unzonedCount) msg += ', ' + unzonedCount + ' line' + (unzonedCount === 1 ? '' : 's') + ' skipped (no zone assigned)';
    msg += '.';
    document.getElementById('cplSuccessTitle').textContent = msg;
    document.getElementById('cplSuccessCard').style.display = 'block';
    document.getElementById('cplSuccessCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    console.error('create piping line list error:', e);
    alert('Network error while creating the piping line list');
  } finally {
    createBtn.disabled = false;
  }
}
window.cplCreateLineList = cplCreateLineList;

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  cplSetupDropZone('cplDropB', 'cplFileB', 'sp');
  cplRenderBulkZonePills();
  cplUpdateBadges();
});
