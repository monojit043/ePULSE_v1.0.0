let _scope = [];
let _pickedFiles = [];       // index files, PDF and/or Excel (Import tab)
let _previewed = [];         // [{ file, data }] from the last preview
let _pickedDocFiles = [];    // PDF files (Upload Documents tab)
let _statusFilter = 'active';
let _allRows = [];
let _retireTargetId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadScope();
  setupDropZone();
  setupPdfDropZone();
  // Delegated listener — rows are re-rendered via innerHTML on every table
  // refresh, so data-attributes (safely HTML-escaped) are used instead of
  // building inline onclick with embedded pid_name text, which would break
  // if a name ever contained an apostrophe.
  document.getElementById('pmiTbody').addEventListener('click', (e) => {
    const retireBtn = e.target.closest('.pmi-retire-btn');
    if (retireBtn) return pmiOpenRetireModal(Number(retireBtn.dataset.id), retireBtn.dataset.name);
    const histBtn = e.target.closest('.pmi-hist-btn');
    if (histBtn) return pmiOpenHistory(Number(histBtn.dataset.id), histBtn.dataset.name);
  });
  document.getElementById('histBody').addEventListener('click', (e) => {
    const resolveBtn = e.target.closest('.pmi-resolve-btn');
    if (resolveBtn) return pmiResolvePending(Number(resolveBtn.dataset.id), resolveBtn.dataset.action);
  });
  await pmiLoadTable();
}

// ── Job/Unit scope ──────────────────────────────────────────────────────────
// One shared dropdown for the whole page. Import Index and Add Single Row
// cross-check against it (a wrong pick can't silently slip a mismatched row
// into the index), and it decides which unit the P&ID table and the Uploaded
// indexes list show. Upload Documents doesn't need it: the filename alone
// determines Job/Unit/name, checked server-side against the Master Index.

async function loadScope() {
  try {
    const r = await fetch('/api/pid/scope');
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Failed to load scope');
    _scope = data.scope || [];
  } catch (e) {
    console.error('loadScope error:', e);
    _scope = [];
  }
  const sel = document.getElementById('jobSel');
  const seen = new Set();
  sel.innerHTML = '<option value="">— select —</option>';
  _scope.forEach((row) => {
    if (seen.has(row.job_no)) return;
    seen.add(row.job_no);
    const opt = document.createElement('option');
    opt.value = row.job_no;
    opt.textContent = `${row.job_no} — ${row.job_name}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', onJobChange);
  document.getElementById('unitSel').addEventListener('change', onScopeChange);
  // Only one job (and one unit) assigned → select it, so the P&ID table shows straight away
  if (seen.size === 1) {
    sel.value = [...seen][0];
    onJobChange();
    const unitSel = document.getElementById('unitSel');
    if (unitSel.options.length === 2) { unitSel.selectedIndex = 1; onScopeChange(); }
  }
}

function onJobChange() {
  const jobSel = document.getElementById('jobSel');
  const unitSel = document.getElementById('unitSel');
  unitSel.innerHTML = '<option value="">— select —</option>';
  unitSel.disabled = true;
  if (jobSel.value) {
    _scope.filter((r) => r.job_no === jobSel.value).forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.unit_no;
      opt.textContent = r.unit_no;
      unitSel.appendChild(opt);
    });
    unitSel.disabled = false;
  }
  onScopeChange();
}

function onScopeChange() {
  resetImportPreview();
  checkImportReady();
  pmiOnNameInput();
  pmiLoadIssues();
  pmiLoadTable();   // the P&ID table shows only the selected Job / Unit
}

// ── Uploaded index files (download exactly as uploaded) ──────────────────────
async function pmiLoadIssues() {
  const box = document.getElementById('issueList');
  const jobNo = document.getElementById('jobSel').value;
  const unitNo = document.getElementById('unitSel').value;
  if (!jobNo || !unitNo) { box.innerHTML = ''; return; }
  try {
    const r = await fetch(`/api/pid/index-issues?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    if (!data.issues.length) {
      box.innerHTML = `<h4>Uploaded indexes</h4><div class="pmi-muted" style="font-size:12px;">None yet for ${escHtml(jobNo)} / ${escHtml(unitNo)}.</div>`;
      return;
    }
    box.innerHTML = '<h4>Uploaded indexes</h4>' + data.issues.map((i) => {
      const when = new Date(i.uploaded_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const index = [i.document_no, i.document_rev ? 'Rev ' + i.document_rev : '', i.unit_label && i.unit_label !== i.unit_no ? i.unit_label : '',
                     i.date_of_issue ? 'issued ' + fmtDate(i.date_of_issue) : ''].filter(Boolean).join(' · ');
      const dl = i.has_file
        ? `<a class="pmi-issue-dl" href="/api/pid/index-issues/${i.id}/file">⬇ Download</a>`
        : '<span class="pmi-muted" title="Uploaded before files were kept — upload the same file again to attach it">file not kept</span>';
      return `<div class="pmi-issue">
        <div class="pmi-issue-top"><span class="pmi-issue-file">${escHtml(i.file_name)}</span>${dl}</div>
        ${index ? `<div class="pmi-muted">${escHtml(index)}</div>` : ''}
        <div class="pmi-muted">${escHtml(when)} · ${escHtml(i.uploaded_by_name || i.uploaded_by || '—')} ·
          ${i.added} added, ${i.updated} updated, ${i.unchanged} unchanged${i.skipped ? `, ${i.skipped} skipped` : ''}</div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('loadIssues error:', e);
    box.innerHTML = '<h4>Uploaded indexes</h4><div class="pmi-muted" style="font-size:12px;">Could not load.</div>';
  }
}

// What Apply will do with the file itself, from the preview's fileStatus
function fileStatusNote(fs, changes) {
  if (!fs) return '';
  const when = (x) => new Date(x.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  if (fs.duplicateOf) return `This exact file was already uploaded on ${when(fs.duplicateOf)} by ${escHtml(fs.duplicateOf.uploaded_by_name || fs.duplicateOf.uploaded_by)}${changes ? ' — Apply will record the changes again' : ' — nothing to do'}.`;
  if (fs.attachTo) return `Nothing changes in the master index. Apply will attach this file to the earlier upload of ${when(fs.attachTo)}, so it can be downloaded.`;
  if (fs.recordOnly) return 'Nothing changes in the master index. Apply will keep this file as a new upload record.';
  return '';
}

// Mirrors backend/utils/pidNameParser.js — this org's fixed P&ID naming
// convention (JOB-XX-XX-UNIT-SERIAL) encodes Job No and Unit No positionally.
// The server re-derives and re-validates this independently; this copy only
// drives the live preview so a bad name (or one that disagrees with the
// selected dropdown) is caught before the request ever fires.
function parsePidNameClient(rawName) {
  const name = String(rawName || '').trim();
  const parts = name.split('-');
  if (parts.length < 5) return null;
  const jobNo = parts[0].trim();
  const unitNo = parts[3].trim();
  const serialNo = parts.slice(4).join('-').trim();
  if (!jobNo || !unitNo || !serialNo) return null;
  return { jobNo, unitNo, serialNo };
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function okIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
}
function errIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
}
function warnIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function pmiSwitchTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  // The Job / Unit bar stays visible on every tab: it also chooses which unit the P&ID table shows
  // (Upload Documents itself doesn't need it — the filename decides).
}

// ── Import Index (PDF or Excel) ─────────────────────────────────────────────────────────────

function setupDropZone() {
  const zone = document.getElementById('dropZone');
  const picker = document.getElementById('filePicker');
  picker.addEventListener('change', () => { if (picker.files.length) setFiles(picker.files); });
  ['dragover', 'dragenter'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
  });
}

// One or more index files (PDF and/or Excel) — each is previewed, applied and kept separately
function setFiles(fileList) {
  _pickedFiles = Array.from(fileList).filter((f) => /\.(pdf|xlsx|xls|csv)$/i.test(f.name));
  const label = document.getElementById('zoneFileName');
  const skipped = fileList.length - _pickedFiles.length;
  label.textContent = _pickedFiles.length === 1 ? _pickedFiles[0].name
    : `${_pickedFiles.length} files: ${_pickedFiles.map((f) => f.name).join(', ')}`;
  if (skipped) label.textContent += ` (${skipped} not a PDF/Excel — ignored)`;
  label.style.display = _pickedFiles.length || skipped ? 'inline-block' : 'none';
  resetImportPreview();
  checkImportReady();
}

// A preview belongs to these files + one Job/Unit — anything changing makes it stale
function resetImportPreview() {
  _previewed = [];
  document.getElementById('applyBtn').style.display = 'none';
  const area = document.getElementById('importResult');
  if (area.dataset.kind === 'preview') { area.style.display = 'none'; area.innerHTML = ''; area.dataset.kind = ''; }
}

function checkImportReady() {
  const jobSel = document.getElementById('jobSel');
  const unitSel = document.getElementById('unitSel');
  document.getElementById('importBtn').disabled = !(jobSel.value && unitSel.value && _pickedFiles.length);
}

function pmiClearImport() {
  _pickedFiles = [];
  _previewed = [];
  document.getElementById('filePicker').value = '';
  const label = document.getElementById('zoneFileName');
  label.style.display = 'none';
  label.textContent = '';
  const area = document.getElementById('importResult');
  area.style.display = 'none'; area.innerHTML = ''; area.dataset.kind = '';
  document.getElementById('applyBtn').style.display = 'none';
  checkImportReady();
}

// "13.05.25"-style display of an ISO date
function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : String(iso);
}
function revList(history, latest) {
  if (!history || !history.length) return '—';
  return history.map((h) => {
    const t = `${escHtml(h.rev)}${h.date ? ' <span class="pmi-muted">' + fmtDate(h.date) + '</span>' : ''}`;
    return latest && h.rev === latest.rev ? `<b>${t}</b>` : t;
  }).join(' · ');
}

async function sendIndexFile(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('jobNo', document.getElementById('jobSel').value);
  fd.append('unitNo', document.getElementById('unitSel').value);
  const r = await fetch(url, { method: 'POST', body: fd });
  return r.json();
}

// One file's header, counts and rows. extraNotes: { pidName: [note, …] } added by the multi-file checks.
function renderIndexPlan(data, extraNotes) {
  const c = data.counts;
  const h = data.header;
  let html = '';
  if (h) {
    html += `<dl class="pmi-idx-head">
      <dt>Index</dt><dd>${escHtml(h.documentNo || '—')}${h.documentRev ? ' · Rev ' + escHtml(h.documentRev) : ''}</dd>
      <dt>Job / Unit</dt><dd>${escHtml(h.jobNo || '—')} / ${escHtml(h.unitLabel || h.unitNo || '—')}</dd>
      <dt>Date of issue</dt><dd>${escHtml(h.dateOfIssue || '—')} · ${h.pages} page${h.pages === 1 ? '' : 's'}</dd>
    </dl>`;
  }
  html += countBadges(c);
  (data.fileWarnings || []).forEach((w) => { html += `<div class="result-banner warn" style="margin-top:6px;">${warnIcon()}<span>${escHtml(w)}</span></div>`; });

  const label = { new: '<span class="badge badge-green">New</span>', update: '<span class="badge badge-blue">Update</span>',
                  unchanged: '<span class="badge badge-gray">No change</span>', skip: '<span class="badge badge-red">Skip</span>' };
  html += `<div class="pmi-idx-scroll"><table class="pmi-idx-table"><thead><tr>
      <th></th><th>Drawing No.</th><th>Description</th><th>Revisions (latest in bold)</th><th>Notes</th>
    </tr></thead><tbody>`;
  for (const r of data.rows) {
    const notes = [
      ...(r.reason ? [`<span class="pmi-idx-note warn">${escHtml(r.reason)}</span>`] : []),
      ...(r.changes || []).map((x) => `<span class="pmi-idx-note">${escHtml(x)}</span>`),
      ...(r.warnings || []).map((x) => `<span class="pmi-idx-note warn">⚠ ${escHtml(x)}</span>`),
      ...((extraNotes && extraNotes[r.pidName]) || []).map((x) => `<span class="pmi-idx-note warn">⚠ ${escHtml(x)}</span>`),
      `<span class="pmi-idx-note">${escHtml(r.ref || '')}</span>`,
    ].join('');
    const revs = r.history ? revList(r.history, r.latest) : revList(r.revisions, r.revisions[r.revisions.length - 1]);
    html += `<tr class="${r.action}">
      <td>${label[r.action] || ''}</td>
      <td style="white-space:nowrap;font-weight:600;">${escHtml(r.pidName || '—')}</td>
      <td>${escHtml(r.description || '')}</td>
      <td class="pmi-idx-revs">${revs}</td>
      <td>${notes}</td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  return html;
}

function countBadges(c) {
  return `<div class="pmi-idx-counts">
    <span class="badge badge-gray">${c.inFile} in file${c.files ? 's' : ''}</span>
    <span class="badge badge-green">${c.new} new</span>
    <span class="badge badge-blue">${c.update} to update</span>
    <span class="badge badge-gray">${c.unchanged} unchanged</span>
    ${c.skip ? `<span class="badge badge-red">${c.skip} skipped</span>` : ''}
    ${c.warnings ? `<span class="badge badge-amber">${c.warnings} with warnings</span>` : ''}
  </div>`;
}

// What Apply will do with one previewed file
function applyKind(data) {
  if (!data || !data.ok) return null;
  const n = data.counts.new + data.counts.update;
  const fs = data.fileStatus || {};
  if (n) return 'apply';
  if (fs.attachTo) return 'attach';
  if (fs.recordOnly) return 'keep';
  return null;   // identical file already kept, nothing to change
}

// Checks that need all selected files together: a P&ID in two files, and P&IDs in none of them
function crossFileChecks(results) {
  const where = {};
  results.forEach((x) => { if (x.data && x.data.ok) x.data.rows.forEach((r) => { if (r.pidName) (where[r.pidName] = where[r.pidName] || []).push(x.file.name); }); });
  const notes = {};
  for (const [name, files] of Object.entries(where)) {
    if (new Set(files).size > 1) notes[name] = [`Also listed in ${[...new Set(files)].join(' and ')} — the file applied last decides the description`];
  }
  const ok = results.filter((x) => x.data && x.data.ok);
  let missing = ok.length ? ok[0].data.missing : [];
  for (const x of ok.slice(1)) missing = missing.filter((n) => x.data.missing.includes(n));   // in NONE of the files
  return { notes, missing, duplicates: Object.keys(notes).length };
}

function missingBlock(missing, files, applied) {
  if (!missing || !missing.length) return '';
  return `<details class="pmi-idx-missing"><summary>${missing.length} P&amp;ID${missing.length === 1 ? '' : 's'} already in the master index ${applied ? 'were' : 'are'} not in ${files > 1 ? 'any of these files' : 'this file'} — left as they are</summary>
    <div style="margin-top:4px;">${missing.map(escHtml).join(' · ')}</div></details>`;
}

function fileSection(x, cross, open, applied) {
  const d = x.data;
  if (!d || !d.ok) {
    return `<details class="pmi-file" open><summary><b>${escHtml(x.file.name)}</b> <span class="badge badge-red">Not imported</span></summary>
      <div class="result-banner error" style="margin-top:6px;">${errIcon()}<span>${escHtml((d && d.error) || 'Could not read the file')}</span></div></details>`;
  }
  const kind = applied ? null : applyKind(d);
  const tag = applied
    ? (d.nothingToDo ? '<span class="badge badge-gray">Already kept</span>' : d.attached ? '<span class="badge badge-green">File attached</span>' : '<span class="badge badge-green">Saved</span>')
    : (kind === 'apply' ? `<span class="badge badge-blue">add ${d.counts.new}, update ${d.counts.update}</span>`
      : kind === 'attach' ? '<span class="badge badge-blue">attach file</span>' : kind === 'keep' ? '<span class="badge badge-blue">keep file</span>'
      : '<span class="badge badge-gray">nothing to do</span>');
  const note = applied ? '' : fileStatusNote(d.fileStatus, d.counts.new + d.counts.update);
  return `<details class="pmi-file"${open ? ' open' : ''}><summary><b>${escHtml(x.file.name)}</b> ${tag}</summary>
    ${note ? `<div class="pmi-muted" style="font-size:12px;margin-top:6px;">${note}</div>` : ''}
    ${renderIndexPlan(d, cross.notes)}</details>`;
}

function totals(results) {
  const t = { inFile: 0, new: 0, update: 0, unchanged: 0, skip: 0, warnings: 0, files: results.length > 1 };
  results.forEach((x) => { if (x.data && x.data.ok) for (const k of ['inFile', 'new', 'update', 'unchanged', 'skip', 'warnings']) t[k] += x.data.counts[k]; });
  return t;
}

async function pmiPreviewImport() {
  if (!document.getElementById('jobSel').value || !document.getElementById('unitSel').value || !_pickedFiles.length) return;
  const btn = document.getElementById('importBtn');
  const spinner = document.getElementById('importSpinner');
  const area = document.getElementById('importResult');
  const applyBtn = document.getElementById('applyBtn');
  btn.disabled = true; applyBtn.style.display = 'none';
  _previewed = [];
  try {
    for (const [i, file] of _pickedFiles.entries()) {
      spinner.textContent = `⏳ Reading ${i + 1} of ${_pickedFiles.length}…`; spinner.style.display = 'inline';
      let data;
      try { data = await sendIndexFile('/api/pid/master-index/import/preview', file); }
      catch (e) { data = { ok: false, error: 'Network error while reading this file' }; }
      _previewed.push({ file, data });
    }
    const cross = crossFileChecks(_previewed);
    const todo = _previewed.filter((x) => applyKind(x.data));
    const failed = _previewed.filter((x) => !x.data || !x.data.ok).length;
    const t = totals(_previewed);
    area.style.display = 'block'; area.dataset.kind = 'preview';
    area.innerHTML = `<div class="result-banner ${todo.length ? 'success' : 'warn'}">${todo.length ? okIcon() : warnIcon()}<span>
        ${todo.length ? `Preview only — nothing saved yet. Check ${_previewed.length > 1 ? 'each file' : 'the rows'} below, then <b>Apply</b>.` : 'Nothing to save from ' + (_previewed.length > 1 ? 'these files.' : 'this file.')}
        ${failed ? `<br>${failed} file${failed === 1 ? '' : 's'} can't be imported (see below) and will be left out.` : ''}
        ${cross.duplicates ? `<br>⚠ ${cross.duplicates} P&amp;ID${cross.duplicates === 1 ? ' is' : 's are'} listed in more than one of these files.` : ''}
      </span></div>`
      + (_previewed.length > 1 ? countBadges(t) : '')
      + _previewed.map((x) => fileSection(x, cross, _previewed.length === 1, false)).join('')
      + missingBlock(cross.missing, _previewed.length, false);
    if (todo.length) {
      document.getElementById('applyBtnText').textContent = _previewed.length === 1
        ? ({ apply: `Apply — add ${t.new}, update ${t.update}`, attach: 'Attach file to earlier upload', keep: 'Keep this index file' })[applyKind(todo[0].data)]
        : `Apply ${todo.length} file${todo.length === 1 ? '' : 's'} — add ${t.new}, update ${t.update}`;
      applyBtn.style.display = '';
    }
  } finally {
    spinner.style.display = 'none';
    checkImportReady();
  }
}

// Applies the previewed files one after another; each becomes its own upload with its file kept
async function pmiApplyImport() {
  const todo = _previewed.filter((x) => applyKind(x.data));
  if (!todo.length) return;
  const applyBtn = document.getElementById('applyBtn');
  const spinner = document.getElementById('importSpinner');
  const area = document.getElementById('importResult');
  applyBtn.disabled = true;
  const results = [];
  try {
    for (const [i, x] of todo.entries()) {
      spinner.textContent = `⏳ Saving ${i + 1} of ${todo.length}…`; spinner.style.display = 'inline';
      let data;
      try { data = await sendIndexFile('/api/pid/master-index/import', x.file); }
      catch (e) { data = { ok: false, error: 'Network error while saving this file' }; }
      results.push({ file: x.file, data });
    }
    const saved = results.filter((x) => x.data && x.data.ok);
    const failed = results.length - saved.length;
    const t = totals(saved);
    const cross = crossFileChecks(saved);
    area.style.display = 'block'; area.dataset.kind = 'result';
    area.innerHTML = `<div class="result-banner ${failed ? 'error' : 'success'}">${failed ? errIcon() : okIcon()}<span>
        ${saved.length} file${saved.length === 1 ? '' : 's'} saved: <b>${t.new}</b> added, <b>${t.update}</b> updated, ${t.unchanged} unchanged${t.skip ? `, ${t.skip} skipped` : ''}.
        The index files are kept — see below.${failed ? `<br>${failed} file${failed === 1 ? '' : 's'} failed — see below; nothing from ${failed === 1 ? 'it' : 'them'} was saved.` : ''}
      </span></div>`
      + results.map((x) => fileSection(x, cross, false, true)).join('');
    applyBtn.style.display = 'none';
    _pickedFiles = []; _previewed = [];
    document.getElementById('filePicker').value = '';
    document.getElementById('zoneFileName').style.display = 'none';
    pmiLoadIssues();
    pmiLoadTable();
  } finally {
    applyBtn.disabled = false;
    spinner.style.display = 'none';
    checkImportReady();
  }
}

// ── Add Single Row ───────────────────────────────────────────────────────────

function pmiOnNameInput() {
  const name = document.getElementById('manPidName').value.trim();
  const jobSel = document.getElementById('jobSel').value;
  const unitSel = document.getElementById('unitSel').value;
  const preview = document.getElementById('manParsePreview');
  const parsed = parsePidNameClient(name);
  let ready = false;

  if (!name) {
    preview.className = 'pmi-parse-preview';
    preview.textContent = '';
  } else if (!parsed) {
    preview.className = 'pmi-parse-preview bad';
    preview.textContent = "Doesn't match the expected format JOB-XX-XX-UNIT-SERIAL (e.g. B378-02-42-111-11902)";
  } else if (!jobSel || !unitSel) {
    preview.className = 'pmi-parse-preview ok';
    preview.innerHTML = `Job <b>${escHtml(parsed.jobNo)}</b> · Unit <b>${escHtml(parsed.unitNo)}</b> · Serial <b>${escHtml(parsed.serialNo)}</b> — select a Job/Unit above to confirm`;
  } else if (parsed.jobNo !== jobSel || parsed.unitNo !== unitSel) {
    preview.className = 'pmi-parse-preview bad';
    preview.innerHTML = `⚠ Name is for Job <b>${escHtml(parsed.jobNo)}</b> / Unit <b>${escHtml(parsed.unitNo)}</b>, but you selected ${escHtml(jobSel)}/${escHtml(unitSel)}`;
  } else {
    preview.className = 'pmi-parse-preview ok';
    preview.innerHTML = `Matches selected Job <b>${escHtml(parsed.jobNo)}</b> · Unit <b>${escHtml(parsed.unitNo)}</b> · Serial <b>${escHtml(parsed.serialNo)}</b>`;
    ready = true;
  }
  document.getElementById('addRowBtn').disabled = !ready;
}

async function pmiAddRow() {
  const jobNo = document.getElementById('jobSel').value;
  const unitNo = document.getElementById('unitSel').value;
  const pidName = document.getElementById('manPidName').value.trim();
  const zone = document.getElementById('manZone').value.trim();
  const description = document.getElementById('manDesc').value.trim();
  const rev = document.getElementById('manRev').value.trim();
  const revDate = document.getElementById('manRevDate').value.trim();
  const parsed = parsePidNameClient(pidName);
  if (!jobNo || !unitNo || !parsed || parsed.jobNo !== jobNo || parsed.unitNo !== unitNo) return;

  const btn = document.getElementById('addRowBtn');
  btn.disabled = true;
  const area = document.getElementById('addResult');
  try {
    const r = await fetch('/api/pid/master-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobNo, unitNo, zone, pidName, description, rev, revDate }),
    });
    const data = await r.json();
    area.style.display = 'block';
    if (!data.ok) {
      area.innerHTML = `<div class="result-banner error">${errIcon()}<span>${escHtml(data.error || 'Failed to add row')}</span></div>`;
    } else {
      area.innerHTML = `<div class="result-banner success">${okIcon()}<span>"${escHtml(data.row.pid_name)}" added for ${escHtml(data.row.job_no)}/${escHtml(data.row.unit_no)}.</span></div>`;
      document.getElementById('manPidName').value = '';
      document.getElementById('manZone').value = '';
      document.getElementById('manDesc').value = '';
      document.getElementById('manRev').value = '';
      document.getElementById('manRevDate').value = '';
      document.getElementById('manParsePreview').textContent = '';
      document.getElementById('manParsePreview').className = 'pmi-parse-preview';
      pmiLoadTable();
    }
  } catch (e) {
    console.error('add row error:', e);
    area.style.display = 'block';
    area.innerHTML = `<div class="result-banner error">${errIcon()}<span>Network error</span></div>`;
  } finally {
    pmiOnNameInput();
  }
}

// ── Upload Documents (no dropdown — filename is self-sufficient) ─────────────

function setupPdfDropZone() {
  const zone = document.getElementById('pdfDropZone');
  const picker = document.getElementById('pdfFilePicker');
  picker.addEventListener('change', () => addDocFiles(picker.files));
  ['dragover', 'dragenter'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => addDocFiles(e.dataTransfer.files));
}

function addDocFiles(fileList) {
  _pickedDocFiles = _pickedDocFiles.concat(Array.from(fileList));
  const label = document.getElementById('pdfFileName');
  if (_pickedDocFiles.length) {
    label.textContent = _pickedDocFiles.length === 1 ? _pickedDocFiles[0].name : `${_pickedDocFiles.length} files selected`;
    label.style.display = 'inline-block';
  } else {
    label.style.display = 'none';
  }
  checkDocUploadReady();
}

function pmiClearDocFiles() {
  _pickedDocFiles = [];
  document.getElementById('pdfFilePicker').value = '';
  const label = document.getElementById('pdfFileName');
  label.style.display = 'none';
  label.textContent = '';
  document.getElementById('docUploadResult').style.display = 'none';
  document.getElementById('forceCheck').checked = false;
  document.getElementById('forceReason').value = '';
  document.getElementById('forcePanel').classList.remove('open');
  checkDocUploadReady();
}

function checkDocUploadReady() {
  document.getElementById('pdfUploadBtn').disabled = !_pickedDocFiles.length;
}

function pmiToggleForce() {
  const check = document.getElementById('forceCheck');
  document.getElementById('forcePanel').classList.toggle('open', check.checked);
}

async function pmiDoDocUpload() {
  if (!_pickedDocFiles.length) return;

  const force = document.getElementById('forceCheck').checked;
  const forceReason = document.getElementById('forceReason').value.trim();
  if (force && !forceReason) {
    alert('A reason is required when forcing an older revision to become current.');
    return;
  }

  const btn = document.getElementById('pdfUploadBtn');
  const spinner = document.getElementById('pdfUploadSpinner');
  btn.disabled = true;
  spinner.style.display = 'inline';

  const area = document.getElementById('docUploadResult');
  try {
    const fd = new FormData();
    _pickedDocFiles.forEach((f) => fd.append('files', f));
    if (force) {
      fd.append('force', 'true');
      fd.append('forceReason', forceReason);
    }
    const r = await fetch('/api/pid/documents/upload', { method: 'POST', body: fd });
    const data = await r.json();
    area.style.display = 'block';

    if (!data.ok) {
      area.innerHTML = `<div class="result-banner error">${errIcon()}<span>${escHtml(data.error || 'Upload failed')}</span></div>`;
    } else {
      const okCount = data.results.filter((r2) => r2.ok).length;
      let html = `<div class="result-banner success">${okIcon()}<span><strong>${okCount}</strong> of ${data.results.length} file${data.results.length === 1 ? '' : 's'} processed successfully.</span></div>`;
      html += '<div class="pmi-file-outcomes">';
      data.results.forEach((res) => {
        // pending_review is neither a clean success nor a rejection — it
        // needs its own visual state so it doesn't read as either "done" or
        // "failed" when it's actually "needs a human to look at it."
        const cls = res.outcome === 'pending_review' ? 'warn' : (res.ok ? 'ok' : 'fail');
        const icon = res.outcome === 'pending_review' ? warnIcon() : (res.ok ? okIcon() : errIcon());
        html += `<div class="pmi-outcome-row ${cls}">
          <span class="pmi-outcome-icon ${cls}">${icon}</span>
          <div>
            <div class="pmi-outcome-name">${escHtml(res.file)}</div>
            <div class="pmi-outcome-msg">${escHtml(docOutcomeMessage(res))}</div>
            ${res.indexWarning ? `<div class="pmi-outcome-msg" style="color:#b45309;">⚠ ${escHtml(res.indexWarning)}</div>` : ''}
          </div>
        </div>`;
      });
      html += '</div>';
      area.innerHTML = html;
      pmiClearDocFiles();
      pmiShowUploadDone(data.results);
      showUploadedRows(data.results.filter((r2) => r2.ok && r2.pidName).map((r2) => r2.pidName));
    }
  } catch (e) {
    console.error('doc upload error:', e);
    area.style.display = 'block';
    area.innerHTML = `<div class="result-banner error">${errIcon()}<span>Network error during upload</span></div>`;
  } finally {
    spinner.style.display = 'none';
    checkDocUploadReady();
  }
}

// After an upload, switch the table to the uploaded files' Job / Unit (read
// from the P&ID name: job = 1st segment, unit = 4th) and highlight their rows.
let _justUploaded = new Set(), _scrollToUploaded = false;
function showUploadedRows(pidNames) {
  _justUploaded = new Set(pidNames);
  _scrollToUploaded = true;
  const scopes = new Set(pidNames.map((n) => { const p = n.split('-'); return `${p[0]}|${p[3]}`; }));
  if (scopes.size === 1) {
    const [jobNo, unitNo] = [...scopes][0].split('|');
    const jobSel = document.getElementById('jobSel');
    const unitSel = document.getElementById('unitSel');
    if ([...jobSel.options].some((o) => o.value === jobNo)) {
      if (jobSel.value !== jobNo) { jobSel.value = jobNo; onJobChange(); }
      if (unitSel.value !== unitNo && [...unitSel.options].some((o) => o.value === unitNo)) {
        unitSel.value = unitNo;
        onScopeChange();
        return;
      }
    }
  }
  pmiLoadTable();
}

// Popup summarising an upload: stored / already on file / needs review / not uploaded
const UPLOAD_GROUPS = [
  { key: 'stored',    label: 'Uploaded',          cls: 'ok',   test: (r) => ['first_upload', 'superseded_previous', 'forced_older_current'].includes(r.outcome) },
  { key: 'same',      label: 'Already on file',   cls: 'ok',   test: (r) => r.outcome === 'duplicate_noop' },
  { key: 'review',    label: 'Needs review',      cls: 'warn', test: (r) => ['pending_review', 'conflict'].includes(r.outcome) },
  { key: 'rejected',  label: 'Not uploaded',      cls: 'fail', test: () => true },
];
function pmiShowUploadDone(results) {
  const groups = UPLOAD_GROUPS.map((g) => ({ ...g, items: [] }));
  results.forEach((r) => groups.find((g) => g.test(r)).items.push(r));
  const [stored, same, review, rejected] = groups.map((g) => g.items.length);
  const warned = results.filter((r) => r.indexWarning).length;

  let title;
  if (!review && !rejected) title = stored ? '✔ Uploaded successfully' : '✔ Nothing new — already on file';
  else if (!stored && !same) title = review && !rejected ? '⚠ Uploaded — needs review' : '✖ Upload not accepted';
  else title = '⚠ Upload finished — some files need attention';
  document.getElementById('uploadDoneTitle').textContent = title;
  document.getElementById('uploadDoneSub').textContent = groups.filter((g) => g.items.length)
    .map((g) => `${g.items.length} ${g.label.toLowerCase()}`).join(' · ')
    + (warned ? ` · ${warned} differ from the index revision` : '');

  document.getElementById('uploadDoneBody').innerHTML = groups.filter((g) => g.items.length).map((g) => `
    <div style="font-weight:700;font-size:12.5px;margin:6px 0 4px;">${g.label} (${g.items.length})</div>
    <div class="pmi-file-outcomes">${g.items.map((res) => `
      <div class="pmi-outcome-row ${g.cls}">
        <div>
          <div class="pmi-outcome-name">${escHtml(res.file)}</div>
          <div class="pmi-outcome-msg">${escHtml(docOutcomeMessage(res))}</div>
          ${res.indexWarning ? `<div class="pmi-outcome-msg" style="color:#b45309;">⚠ ${escHtml(res.indexWarning)}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>`).join('');
  document.getElementById('uploadDoneOverlay').classList.add('open');
}
function pmiCloseUploadDone() {
  document.getElementById('uploadDoneOverlay').classList.remove('open');
}

function docOutcomeMessage(res) {
  switch (res.outcome) {
    case 'first_upload': return `Rev ${res.revLabel} stored as the first upload for ${res.pidName}.`;
    case 'superseded_previous': return `Rev ${res.revLabel} is now current, replacing Rev ${res.previousRev}.`;
    case 'forced_older_current': return `Rev ${res.revLabel} forced current over Rev ${res.previousRev} (override logged).`;
    case 'duplicate_noop': return `Already on file — Rev ${res.revLabel} matches exactly, nothing changed.`;
    case 'pending_review':
      return res.parseConfidence === 'unrecognized'
        ? `Couldn't read the PDF's title block — open History to confirm manually.`
        : `Filename says Rev ${res.revLabel}, but the PDF content says ${res.parsedName ? `"${res.parsedName}" Rev ${res.parsedRevision}` : 'something else'} — open History to resolve.`;
    default: return res.error || 'Rejected.';
  }
}

// ── Table: load, filter, render ──────────────────────────────────────────────

function pmiSetStatusFilter(status, btn) {
  _statusFilter = status;
  document.querySelectorAll('#statusSeg .seg-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  pmiLoadTable();
}

// Only the P&IDs of the Job / Unit selected above (like the Uploaded indexes list) — nothing until both are chosen
function selectedScope() {
  return { jobNo: document.getElementById('jobSel').value, unitNo: document.getElementById('unitSel').value };
}

let _tableRequest = 0;
async function pmiLoadTable() {
  const { jobNo, unitNo } = selectedScope();
  const req = ++_tableRequest;
  if (!jobNo || !unitNo) {
    _allRows = [];
  } else {
    try {
      const qs = new URLSearchParams({ jobNo, unitNo });
      if (_statusFilter) qs.set('status', _statusFilter);
      const r = await fetch('/api/pid/master-index/with-status?' + qs.toString());
      const data = await r.json();
      if (req !== _tableRequest) return;   // the selection changed while this was loading
      _allRows = data.ok ? (data.rows || []) : [];
    } catch (e) {
      console.error('loadTable error:', e);
      _allRows = [];
    }
  }
  pmiRenderTable();
  updateTopBadge();
}

function updateTopBadge() {
  const badge = document.getElementById('topBadge');
  const uploaded = _allRows.filter((r) => r.current_doc_id).length;
  const { jobNo, unitNo } = selectedScope();
  if (!jobNo || !unitNo) {
    badge.textContent = 'Select Job / Unit';
  } else if (_statusFilter === 'retired') {
    badge.textContent = `${_allRows.length} Retired`;
  } else {
    badge.textContent = `${uploaded} / ${_allRows.length} Uploaded`;
  }
}

function pmiRenderTable() {
  const q = document.getElementById('pmiSearch').value.trim().toLowerCase();
  const thead = document.getElementById('pmiThead');
  const tbody = document.getElementById('pmiTbody');

  const filtered = _allRows.filter((r) => {
    if (!q) return true;
    return [r.pid_name, r.job_no, r.unit_no, r.zone, r.description].some((v) => (v || '').toLowerCase().includes(q));
  });

  if (!filtered.length) {
    const { jobNo, unitNo } = selectedScope();
    const [title, text] = !jobNo || !unitNo
      ? ['Select a Job No. and Unit No.', 'Choose them on the left to see that unit\'s P&amp;IDs.']
      : ['No P&amp;IDs found', _allRows.length ? 'No rows match your search.'
          : `No ${_statusFilter === 'retired' ? 'retired ' : _statusFilter === 'active' ? 'active ' : ''}P&amp;IDs for ${escHtml(jobNo)} / ${escHtml(unitNo)} yet — import an index or add a row on the left.`];
    thead.innerHTML = '<tr><th style="border:none;"></th></tr>';
    tbody.innerHTML = `<tr><td><div class="empty-state" style="padding:2.5rem;">
        <h3 style="font-size:15px;">${title}</h3>
        <p>${text}</p>
      </div></td></tr>`;
    return;
  }

  thead.innerHTML = `<tr>
    <th>P&amp;ID Name</th><th>Description</th><th>Job No</th><th>Unit No</th>
    <th title="Latest revision per the Process P&amp;ID index">Index Rev</th><th>Uploaded Rev</th>
    <th>Status</th><th>Created By</th><th></th>
  </tr>`;

  tbody.innerHTML = filtered.map((r) => {
    const statusBadge = r.status === 'active'
      ? '<span class="badge badge-green">Active</span>'
      : `<span class="badge badge-gray" title="${escHtml(r.retire_reason || '')}">Retired</span>`;
    const revChip = r.current_rev_label
      ? `<span class="pmi-rev-chip">Rev ${escHtml(r.current_rev_label)}</span>`
      : '<span class="pmi-rev-chip none">Not uploaded</span>';
    const pendingBadge = r.pending_count > 0
      ? `<span class="pmi-pending-chip" title="Needs review — open History">${r.pending_count} pending</span>`
      : '';
    const created = r.created_at ? new Date(r.created_at).toLocaleDateString() : '—';
    // What the Process index says is current; hover shows the whole revision history
    const hist = Array.isArray(r.rev_history) ? r.rev_history : [];
    const histTitle = hist.map((h) => `Rev ${h.rev}${h.date ? ' — ' + fmtDate(h.date) : ''}`).join('\n');
    const idxRev = r.index_rev
      ? `<span class="pmi-idxrev" title="${escHtml(histTitle)}">Rev ${escHtml(r.index_rev)}${r.index_rev_date ? ' · ' + fmtDate(r.index_rev_date) : ''}</span>`
      : '<span class="pmi-muted">—</span>';
    const revDiff = r.index_rev && r.current_rev_label && String(r.index_rev).toUpperCase() !== String(r.current_rev_label).toUpperCase()
      ? `<span class="pmi-rev-diff" title="The uploaded P&amp;ID revision differs from the index">≠ index</span>` : '';
    const retireBtn = r.status === 'active'
      ? `<button class="btn btn-outline btn-sm pmi-retire-btn" data-id="${r.id}" data-name="${escHtml(r.pid_name)}">Retire</button>`
      : '';
    // Name links straight to the current PDF when one exists — clicking opens
    // it in a new tab; plain text when nothing's been uploaded yet.
    const nameCell = r.current_file_path
      ? `<a class="pmi-row-name pmi-open-link" href="/uploads/${escHtml(r.current_file_path)}" target="_blank" rel="noopener">${escHtml(r.pid_name)}</a>`
      : `<span class="pmi-row-name">${escHtml(r.pid_name)}</span>`;
    return `<tr${_justUploaded.has(r.pid_name) ? ' class="pmi-just-uploaded"' : ''}>
      <td>${nameCell}</td>
      <td class="pmi-desc">${escHtml(r.description || '')}</td>
      <td>${escHtml(r.job_no)}</td>
      <td>${escHtml(r.unit_no)}</td>
      <td>${idxRev}</td>
      <td>${revChip}${revDiff}${pendingBadge}</td>
      <td>${statusBadge}</td>
      <td class="pmi-muted" title="${escHtml(created)}">${escHtml(r.created_by_name || r.created_by || '—')}</td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm pmi-hist-btn" data-id="${r.id}" data-name="${escHtml(r.pid_name)}">History</button>
        ${retireBtn}
      </td>
    </tr>`;
  }).join('');
  const first = tbody.querySelector('tr.pmi-just-uploaded');
  if (first && _scrollToUploaded) { _scrollToUploaded = false; first.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

// ── Retire modal ──────────────────────────────────────────────────────────────

function pmiOpenRetireModal(id, name) {
  _retireTargetId = id;
  document.getElementById('retirePidName').textContent = `"${name}"`;
  document.getElementById('retireReason').value = '';
  document.getElementById('retireOverlay').classList.add('open');
}

function pmiCloseRetireModal() {
  _retireTargetId = null;
  document.getElementById('retireOverlay').classList.remove('open');
}

async function pmiConfirmRetire() {
  if (!_retireTargetId) return;
  const reason = document.getElementById('retireReason').value.trim();
  try {
    const r = await fetch(`/api/pid/master-index/${_retireTargetId}/retire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await r.json();
    if (!data.ok) {
      alert(data.error || 'Failed to retire row');
      return;
    }
    pmiCloseRetireModal();
    pmiLoadTable();
  } catch (e) {
    console.error('retire error:', e);
    alert('Network error while retiring row');
  }
}

// ── Revision history modal ────────────────────────────────────────────────────

const PMI_ACTION_LABELS = {
  master_index_added: 'Added to Master Index',
  master_index_retired: 'Retired',
  document_uploaded: 'Document Uploaded',
  document_superseded: 'Revision Superseded',
  document_conflict: 'Conflict Detected',
  document_forced_override: 'Forced Override',
  document_pending_review: 'Needs Review — Content Didn’t Verify',
  document_review_accepted: 'Review Accepted',
  document_review_rejected: 'Review Rejected',
};

const PMI_STATUS_COLORS = {
  current: '#1a7a33',
  conflict: '#b71c1c',
  pending_review: '#d97706',
  rejected: 'var(--text-muted)',
};

async function pmiOpenHistory(masterIndexId, pidName) {
  document.getElementById('histPidName').textContent = pidName;
  document.getElementById('histBody').dataset.masterIndexId = masterIndexId;
  const body = document.getElementById('histBody');
  body.innerHTML = '<div class="empty-state" style="padding:2rem;"><h3 style="font-size:13px;">Loading…</h3></div>';
  document.getElementById('histOverlay').classList.add('open');
  await pmiRenderHistory(masterIndexId, pidName);
}

async function pmiRenderHistory(masterIndexId, pidName) {
  const body = document.getElementById('histBody');
  try {
    const r = await fetch(`/api/pid/master-index/${masterIndexId}/documents`);
    const data = await r.json();
    const docs = data.ok ? data.documents : [];
    const auditLog = data.ok ? (data.auditLog || []) : [];

    let html = '';
    if (!docs.length) {
      html += '<div class="empty-state" style="padding:2rem;"><h3 style="font-size:13px;">No documents uploaded yet</h3></div>';
    } else {
      html += docs.map((d) => {
        const statusColor = PMI_STATUS_COLORS[d.status] || 'var(--text-muted)';
        const statusLabel = d.status === 'pending_review' ? 'Pending Review' : d.status;
        const when = d.uploaded_at ? new Date(d.uploaded_at).toLocaleString() : '—';
        const row = `<div class="pmi-hist-row">
          <span class="pmi-hist-rev">${escHtml(d.rev_label)}</span>
          <a class="pmi-hist-file pmi-open-link" href="/uploads/${escHtml(d.file_path)}" target="_blank" rel="noopener">${escHtml(d.file_name)}</a>
          <span class="pmi-hist-meta" style="color:${statusColor};text-transform:capitalize;">${escHtml(statusLabel)}</span>
          <span class="pmi-hist-meta">${escHtml(d.uploaded_by_name || d.uploaded_by || '—')}<br>${when}</span>
        </div>`;

        if (d.status !== 'pending_review') return row;

        // Pending review — show what was declared vs. what the PDF content
        // actually says (or "nothing recognized" for an unrecognized
        // template), plus inline Accept/Reject actions right here.
        const parsedLine = d.parsed_pid_name
          ? `Content says: <b>${escHtml(d.parsed_pid_name)}</b> Rev <b>${escHtml(d.parsed_rev_label)}</b>`
          : `Content couldn't be read automatically — no recognized title block`;
        return row + `<div class="pmi-pending-detail">
          <div class="pmi-pending-compare">
            Filename declares: <b>${escHtml(d.file_name.replace(/\.pdf$/i, ''))}</b><br>
            ${parsedLine}
          </div>
          <textarea class="pmi-pending-reason" id="pmi-reason-${d.id}" placeholder="Reason (optional — only required if this would replace a newer revision)"></textarea>
          <div class="pmi-pending-actions">
            <button class="btn btn-outline btn-sm pmi-resolve-btn" data-id="${d.id}" data-action="reject">Reject</button>
            <button class="btn btn-primary btn-sm pmi-resolve-btn" data-id="${d.id}" data-action="accept">Accept as Declared</button>
          </div>
          <div class="pmi-pending-error" id="pmi-resolve-error-${d.id}"></div>
        </div>`;
      }).join('');
    }

    if (auditLog.length) {
      html += '<div class="pmi-audit-heading">Activity Log</div>';
      html += auditLog.map((a) => {
        const when = a.performed_at ? new Date(a.performed_at).toLocaleString() : '—';
        const label = PMI_ACTION_LABELS[a.action] || a.action;
        const reason = a.reason ? `<div class="pmi-audit-reason">"${escHtml(a.reason)}"</div>` : '';
        return `<div class="pmi-hist-row">
          <span class="pmi-hist-rev" style="width:auto;flex-shrink:0;">
            <span class="pmi-audit-dot"></span>
          </span>
          <span class="pmi-hist-file" style="text-overflow:clip;white-space:normal;">
            ${escHtml(label)}${reason}
          </span>
          <span class="pmi-hist-meta">${escHtml(a.performed_by_name || a.performed_by || '—')}<br>${when}</span>
        </div>`;
      }).join('');
    }

    body.innerHTML = html;
  } catch (e) {
    console.error('history load error:', e);
    body.innerHTML = '<div class="empty-state" style="padding:2rem;"><h3 style="font-size:13px;">Failed to load history</h3></div>';
  }
}

function pmiCloseHistory() {
  document.getElementById('histOverlay').classList.remove('open');
}

// Step 5 resolution — accept applies the same current/supersede/conflict
// lifecycle Step 7 already has (just deferred until now); reject leaves the
// row/file in place, permanently excluded from ever being current. Reason
// is optional except in the rare case accept would replace a revision newer
// than the one this was originally compared against — the server enforces
// that, this just surfaces the error inline if it happens.
async function pmiResolvePending(docId, action) {
  const reasonEl = document.getElementById(`pmi-reason-${docId}`);
  const errorEl = document.getElementById(`pmi-resolve-error-${docId}`);
  const reason = reasonEl ? reasonEl.value.trim() : '';
  if (errorEl) errorEl.textContent = '';

  try {
    const r = await fetch(`/api/pid/documents/${docId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });
    const data = await r.json();
    if (!data.ok) {
      if (errorEl) errorEl.textContent = data.error || 'Failed to resolve';
      return;
    }
    const masterIndexId = document.getElementById('histBody').dataset.masterIndexId;
    const pidName = document.getElementById('histPidName').textContent;
    await pmiRenderHistory(masterIndexId, pidName);
    pmiLoadTable();
  } catch (e) {
    console.error('resolve pending error:', e);
    if (errorEl) errorEl.textContent = 'Network error';
  }
}
