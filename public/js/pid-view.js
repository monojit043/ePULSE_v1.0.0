let _allRows = [];          // every active P&ID, every job/unit, from with-status
let _treeData = {};         // { [jobNo]: { jobName, units: { [unitNo]: rows[] } } }
let _selectedJob = null;
let _selectedUnit = null;
let _ctxRow = null;         // row the context menu is currently open for

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.getElementById('pidvTbody').addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    e.preventDefault();
    pidvShowContextMenu(e, { id: Number(tr.dataset.id), name: tr.dataset.name });
  });
  document.getElementById('pidvCtxMenu').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-action]');
    if (!li || !_ctxRow) return;
    if (li.dataset.action === 'history') pidvOpenHistory(_ctxRow.id, _ctxRow.name);
    document.getElementById('pidvCtxMenu').style.display = 'none';
  });
  document.addEventListener('click', () => {
    document.getElementById('pidvCtxMenu').style.display = 'none';
  });

  await pidvLoadAll();
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Load all P&IDs, build the Job/Unit tree from them ────────────────────────
// No separate "list of jobs/units" endpoint — the tree is derived from the
// same with-status data the table needs anyway, so a job/unit only shows up
// here once it actually has at least one active P&ID (an empty branch isn't
// useful to browse). This endpoint is open to any logged-in user, any job —
// P&IDs are reference material, not scoped to task assignment.

async function pidvLoadAll() {
  try {
    const r = await fetch('/api/pid/master-index/with-status?status=active');
    const data = await r.json();
    _allRows = data.ok ? (data.rows || []) : [];
  } catch (e) {
    console.error('pidvLoadAll error:', e);
    _allRows = [];
  }

  _treeData = {};
  _allRows.forEach((row) => {
    if (!_treeData[row.job_no]) _treeData[row.job_no] = { jobName: row.job_no, units: {} };
    if (!_treeData[row.job_no].units[row.unit_no]) _treeData[row.job_no].units[row.unit_no] = [];
    _treeData[row.job_no].units[row.unit_no].push(row);
  });

  document.getElementById('topBadge').textContent = `${_allRows.length} P&IDs`;
  pidvRenderTree();
  pidvRenderTable();
}

function pidvRenderTree() {
  const container = document.getElementById('pidvTree');
  const jobNos = Object.keys(_treeData).sort();

  if (!jobNos.length) {
    container.innerHTML = '<div class="tree-empty">No P&IDs uploaded anywhere yet</div>';
    return;
  }

  container.innerHTML = jobNos.map((jobNo) => {
    const job = _treeData[jobNo];
    const unitNos = Object.keys(job.units).sort();
    const unitsHtml = unitNos.map((unitNo) => {
      const count = job.units[unitNo].length;
      const selected = jobNo === _selectedJob && unitNo === _selectedUnit;
      return `<div class="tree-item unit-item${selected ? ' selected' : ''}" data-action="unit" data-job="${escHtml(jobNo)}" data-unit="${escHtml(unitNo)}">
        <svg class="tree-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        Unit ${escHtml(unitNo)}
        <span class="tree-count">${count}</span>
      </div>`;
    }).join('');

    return `<div class="tree-project">
      <div class="tree-item project-item" data-action="job" data-job="${escHtml(jobNo)}">
        <svg class="tree-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        ${escHtml(jobNo)}
      </div>
      <div class="tree-children" id="proj-${escHtml(jobNo)}">${unitsHtml}</div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-action="job"]').forEach((el) => {
    el.addEventListener('click', () => {
      const kids = document.getElementById('proj-' + el.dataset.job);
      kids.style.display = kids.style.display === 'block' ? 'none' : 'block';
    });
  });
  container.querySelectorAll('[data-action="unit"]').forEach((el) => {
    el.addEventListener('click', () => {
      _selectedJob = el.dataset.job;
      _selectedUnit = el.dataset.unit;
      document.getElementById('breadCurr').textContent = `${_selectedJob} / ${_selectedUnit}`;
      pidvRenderTree(); // re-render to move the "selected" highlight
      // keep the parent job's branch open after re-render
      const kids = document.getElementById('proj-' + _selectedJob);
      if (kids) kids.style.display = 'block';
      pidvRenderTable();
    });
  });

  // Re-open whichever job branch is currently selected, if any
  if (_selectedJob) {
    const kids = document.getElementById('proj-' + _selectedJob);
    if (kids) kids.style.display = 'block';
  }
}

// ── Table for the selected Job/Unit ──────────────────────────────────────────

function pidvRenderTable() {
  const q = document.getElementById('pidvSearch').value.trim().toLowerCase();
  const thead = document.getElementById('pidvThead');
  const tbody = document.getElementById('pidvTbody');

  if (!_selectedJob || !_selectedUnit) {
    thead.innerHTML = '<tr><th style="border:none;"></th></tr>';
    tbody.innerHTML = `<tr><td><div class="empty-state" style="padding:2.5rem;">
        <h3 style="font-size:15px;">Select a Job and Unit</h3>
        <p>Choose a unit from the tree on the left to see its P&amp;IDs.</p>
      </div></td></tr>`;
    return;
  }

  const rows = (_treeData[_selectedJob] && _treeData[_selectedJob].units[_selectedUnit]) || [];
  const filtered = rows.filter((r) => !q || r.pid_name.toLowerCase().includes(q));

  if (!filtered.length) {
    thead.innerHTML = '<tr><th style="border:none;"></th></tr>';
    tbody.innerHTML = `<tr><td><div class="empty-state" style="padding:2.5rem;">
        <h3 style="font-size:15px;">No P&amp;IDs found</h3>
        <p>${rows.length ? 'No rows match your search.' : 'No P&IDs uploaded for this Job/Unit yet.'}</p>
      </div></td></tr>`;
    return;
  }

  thead.innerHTML = `<tr>
    <th>P&amp;ID Name</th><th>Current Rev</th><th>Last Uploaded</th>
  </tr>`;

  tbody.innerHTML = filtered.map((r) => {
    const revChip = r.current_rev_label
      ? `<span class="pidv-rev-chip">Rev ${escHtml(r.current_rev_label)}</span>`
      : '<span class="pidv-rev-chip none">Not uploaded</span>';
    const pendingBadge = r.pending_count > 0
      ? `<span class="pidv-pending-chip" title="Awaiting review by GL/ISO Manager">${r.pending_count} pending</span>`
      : '';
    const uploaded = r.current_uploaded_at ? new Date(r.current_uploaded_at).toLocaleDateString() : '—';
    // Name is a real link to the current PDF when one exists — clicking opens
    // it in a new tab. When there's no upload yet it's just plain text.
    const nameCell = r.current_file_path
      ? `<a class="pidv-row-name pidv-open-link" href="/uploads/${escHtml(r.current_file_path)}" target="_blank" rel="noopener">${escHtml(r.pid_name)}</a>`
      : `<span class="pidv-row-name">${escHtml(r.pid_name)}</span>`;
    return `<tr data-id="${r.id}" data-name="${escHtml(r.pid_name)}">
      <td>${nameCell}</td>
      <td>${revChip}${pendingBadge}</td>
      <td class="pidv-muted">${uploaded}</td>
    </tr>`;
  }).join('');
}

// ── Right-click context menu ──────────────────────────────────────────────────

function pidvShowContextMenu(event, row) {
  _ctxRow = row;
  const menu = document.getElementById('pidvCtxMenu');
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.style.display = 'block';
  event.stopPropagation();
}

// ── Revision history modal ────────────────────────────────────────────────────

const PIDV_ACTION_LABELS = {
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

const PIDV_STATUS_COLORS = {
  current: '#1a7a33',
  conflict: '#b71c1c',
  pending_review: '#d97706',
  rejected: 'var(--text-muted)',
};

async function pidvOpenHistory(masterIndexId, pidName) {
  document.getElementById('histPidName').textContent = pidName;
  const body = document.getElementById('histBody');
  body.innerHTML = '<div class="empty-state" style="padding:2rem;"><h3 style="font-size:13px;">Loading…</h3></div>';
  document.getElementById('histOverlay').classList.add('open');

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
        const statusColor = PIDV_STATUS_COLORS[d.status] || 'var(--text-muted)';
        const statusLabel = d.status === 'pending_review' ? 'Pending Review' : d.status;
        const when = d.uploaded_at ? new Date(d.uploaded_at).toLocaleString() : '—';
        const row = `<div class="pidv-hist-row">
          <span class="pidv-hist-rev">${escHtml(d.rev_label)}</span>
          <a class="pidv-hist-file pidv-open-link" href="/uploads/${escHtml(d.file_path)}" target="_blank" rel="noopener">${escHtml(d.file_name)}</a>
          <span class="pidv-hist-meta" style="color:${statusColor};text-transform:capitalize;">${escHtml(statusLabel)}</span>
          <span class="pidv-hist-meta">${escHtml(d.uploaded_by_name || d.uploaded_by || '—')}<br>${when}</span>
        </div>`;

        if (d.status !== 'pending_review') return row;

        // View-only page — show why it's pending, but no accept/reject here;
        // that's a GL/ISO Manager action on the management page.
        const parsedLine = d.parsed_pid_name
          ? `Content says: <b>${escHtml(d.parsed_pid_name)}</b> Rev <b>${escHtml(d.parsed_rev_label)}</b>`
          : `Content couldn't be read automatically — no recognized title block`;
        return row + `<div class="pidv-pending-detail">
          Filename declares: <b>${escHtml(d.file_name.replace(/\.pdf$/i, ''))}</b><br>
          ${parsedLine}<br>
          <span class="pidv-muted">Awaiting review by GL/ISO Manager.</span>
        </div>`;
      }).join('');
    }

    if (auditLog.length) {
      html += '<div class="pidv-audit-heading">Activity Log</div>';
      html += auditLog.map((a) => {
        const when = a.performed_at ? new Date(a.performed_at).toLocaleString() : '—';
        const label = PIDV_ACTION_LABELS[a.action] || a.action;
        const reason = a.reason ? `<div class="pidv-audit-reason">"${escHtml(a.reason)}"</div>` : '';
        return `<div class="pidv-hist-row">
          <span class="pidv-hist-rev" style="width:auto;flex-shrink:0;"><span class="pidv-audit-dot"></span></span>
          <span class="pidv-hist-file" style="text-overflow:clip;white-space:normal;">${escHtml(label)}${reason}</span>
          <span class="pidv-hist-meta">${escHtml(a.performed_by_name || a.performed_by || '—')}<br>${when}</span>
        </div>`;
      }).join('');
    }

    body.innerHTML = html;
  } catch (e) {
    console.error('history load error:', e);
    body.innerHTML = '<div class="empty-state" style="padding:2rem;"><h3 style="font-size:13px;">Failed to load history</h3></div>';
  }
}

function pidvCloseHistory() {
  document.getElementById('histOverlay').classList.remove('open');
}
