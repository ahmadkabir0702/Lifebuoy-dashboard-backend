/**
 * pretest.js — Pre-test Asset modal logic
 * Handles file selection, dummy upload sequence, and report request.
 */

(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedFile = null;
  let uploadTimer  = null;
  let currentStep  = 1;

  // ── Open / Close ──────────────────────────────────────────────────────────
  window.openPretestModal = function() {
    resetPretestModal();
    document.getElementById('pretestModal').classList.add('open');
    if (typeof enhanceSelectsIn === 'function') enhanceSelectsIn('pretestModal');
  };

  window.closePretestModal = function() {
    document.getElementById('pretestModal').classList.remove('open');
    if (uploadTimer) clearInterval(uploadTimer);
  };

  window.closePretestOnBackdrop = function(e) {
    if (e.target.id === 'pretestModal') closePretestModal();
  };

  // ── File handling ──────────────────────────────────────────────────────────
  window.pretestDragOver = function(e) {
    e.preventDefault();
    document.getElementById('pretestDropZone').classList.add('drag-over');
  };

  window.pretestDragLeave = function() {
    document.getElementById('pretestDropZone').classList.remove('drag-over');
  };

  window.pretestDrop = function(e) {
    e.preventDefault();
    document.getElementById('pretestDropZone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) applyFile(file);
  };

  window.pretestFileSelected = function(e) {
    const file = e.target.files[0];
    if (file) applyFile(file);
  };

  window.pretestClearFile = function() {
    selectedFile = null;
    document.getElementById('pretest-file-preview').style.display = 'none';
    document.getElementById('pretestDropZone').style.display = 'flex';
    document.getElementById('pretestFileInput').value = '';
    updateUploadBtn();
  };

  function applyFile(file) {
    selectedFile = file;
    document.getElementById('pretestDropZone').style.display = 'none';
    document.getElementById('pretest-file-preview').style.display = 'flex';
    document.getElementById('pretest-filename').textContent = file.name;
    document.getElementById('pretest-filesize').textContent = formatBytes(file.size);
    // Auto-fill asset name if empty
    const nameInput = document.getElementById('pretest-asset-name');
    if (!nameInput.value) {
      nameInput.value = file.name.replace(/\.[^/.]+$/, '');
    }
    updateUploadBtn();
  }

  function formatBytes(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(0) + ' KB';
  }

  function updateUploadBtn() {
    const btn = document.getElementById('pretest-upload-btn');
    if (btn) btn.disabled = !selectedFile;
  }

  // ── Upload sequence (dummy, 30 s) ─────────────────────────────────────────
  window.pretestStartUpload = function() {
    if (!selectedFile) return;

    // Move to step 2
    goToStep(2);

    const steps = [
      { id: 'usl-1', label: 'Validating file integrity',    start: 0,    end: 14,   title: 'Validating file…',        sub: 'Checking format and integrity' },
      { id: 'usl-2', label: 'Encrypting transfer',          start: 15,   end: 34,   title: 'Encrypting transfer…',    sub: 'Securing upload channel' },
      { id: 'usl-3', label: 'Uploading to analysis queue',  start: 35,   end: 68,   title: 'Uploading asset…',        sub: 'Transferring to analysis queue' },
      { id: 'usl-4', label: 'Registering asset metadata',   start: 69,   end: 86,   title: 'Registering metadata…',   sub: 'Tagging asset in system' },
      { id: 'usl-5', label: 'Confirming receipt',           start: 87,   end: 100,  title: 'Finalising…',             sub: 'Confirming receipt' },
    ];

    let pct = 0;
    const totalMs = 30000;
    const intervalMs = 300;
    const increment = 100 / (totalMs / intervalMs);

    uploadTimer = setInterval(() => {
      pct = Math.min(pct + increment + (Math.random() * 0.4 - 0.2), 100);
      const p = Math.round(pct);

      // Progress bar
      const fill = document.getElementById('pretest-prog-fill');
      const pctEl = document.getElementById('pretest-prog-pct');
      if (fill) fill.style.width = p + '%';
      if (pctEl) pctEl.textContent = p + '%';

      // Step states + title
      steps.forEach(s => {
        const el = document.getElementById(s.id);
        if (!el) return;
        if (p > s.end) {
          el.className = 'usl-item done';
        } else if (p >= s.start) {
          el.className = 'usl-item active';
          const titleEl = document.getElementById('upload-status-title');
          const subEl   = document.getElementById('upload-status-sub');
          if (titleEl) titleEl.textContent = s.title;
          if (subEl)   subEl.textContent   = s.sub;
        }
      });

      if (p >= 100) {
        clearInterval(uploadTimer);
        setTimeout(() => goToStep(3), 400);
      }
    }, intervalMs);
  };

  // ── Step 3: request report ─────────────────────────────────────────────────
  window.pretestRequestReport = function() {
    const btn      = document.getElementById('pretest-generate-btn');
    const confirm  = document.getElementById('pretest-report-requested');
    const footer   = document.getElementById('pretest-step3-footer');

    if (btn) btn.disabled = true;
    if (confirm) confirm.style.display = 'flex';
    // Optionally hide the button row after confirmation
    setTimeout(() => {
      if (footer) {
        const closeBtn = footer.querySelector('.pretest-btn.secondary');
        if (closeBtn) closeBtn.textContent = 'Done';
      }
    }, 100);
  };

  // ── Step navigation ────────────────────────────────────────────────────────
  function goToStep(n) {
    currentStep = n;

    // Bodies
    document.getElementById('pretest-step1').style.display = n === 1 ? 'block' : 'none';
    document.getElementById('pretest-step2').style.display = n === 2 ? 'block' : 'none';
    document.getElementById('pretest-step3').style.display = n === 3 ? 'block' : 'none';

    // Step track
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`pstep-${i}`);
      if (!el) continue;
      el.classList.remove('active', 'done');
      if (i < n)      el.classList.add('done');
      else if (i === n) el.classList.add('active');
    }

    // Connectors
    const connectors = document.querySelectorAll('.pstep-connector');
    connectors.forEach((c, idx) => {
      c.classList.toggle('done', idx + 1 < n);
    });

    // Step 3 enrichment
    if (n === 3) {
      const assetName = document.getElementById('pretest-asset-name')?.value || selectedFile?.name || 'Unknown asset';
      const subEl = document.getElementById('psb-asset-name');
      if (subEl) subEl.textContent = assetName;
      const posEl = document.getElementById('pqc-position');
      if (posEl) posEl.textContent = Math.floor(Math.random() * 4) + 1;
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  function resetPretestModal() {
    selectedFile = null;
    if (uploadTimer) clearInterval(uploadTimer);
    currentStep = 1;

    // Step 1 UI
    document.getElementById('pretestDropZone').style.display = 'flex';
    document.getElementById('pretest-file-preview').style.display = 'none';
    document.getElementById('pretestFileInput').value = '';
    document.getElementById('pretest-asset-name').value = '';
    document.getElementById('pretest-campaign').value = '';
    document.getElementById('pretest-duration').value = '';
    document.getElementById('pretest-content-type').value = '';

    // Step 2 reset
    const fill = document.getElementById('pretest-prog-fill');
    const pctEl = document.getElementById('pretest-prog-pct');
    if (fill) fill.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    ['usl-1','usl-2','usl-3','usl-4','usl-5'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'usl-item pending';
    });
    const titleEl = document.getElementById('upload-status-title');
    const subEl   = document.getElementById('upload-status-sub');
    if (titleEl) titleEl.textContent = 'Uploading asset…';
    if (subEl)   subEl.textContent   = 'Securing file transfer';

    // Step 3 reset
    const conf = document.getElementById('pretest-report-requested');
    if (conf) conf.style.display = 'none';
    const genBtn = document.getElementById('pretest-generate-btn');
    if (genBtn) genBtn.disabled = false;

    goToStep(1);
    updateUploadBtn();
  }

})();
