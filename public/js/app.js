/**
 * docchat — Main Application Logic
 *
 * Handles: initialization, sidebar rendering, document loading,
 * exploration loading, and content display.
 */
(function() {
  'use strict';

  // ─── State ─────────────────────────────────────
  var repoInfo = null;
  var docs = [];
  var explorations = [];
  var activeView = null; // { type: 'doc'|'exploration', path: string }

  // ─── Init ──────────────────────────────────────

  async function init() {
    try {
      var results = await Promise.all([
        fetch('/api/info').then(function(r) { return r.json(); }),
        fetch('/api/docs').then(function(r) { return r.json(); }),
        fetch('/api/explorations').then(function(r) { return r.json(); }).catch(function() { return []; }),
      ]);

      repoInfo = results[0];
      docs = results[1];
      explorations = results[2];

      // Update UI
      document.getElementById('repo-name').textContent = repoInfo.name || 'unknown';
      document.title = 'docchat \u2014 ' + (repoInfo.name || 'unknown');
      renderStats();
      renderDocTree();
      renderExplorations();

      // If explorations exist, show the latest one by default
      if (explorations.length > 0) {
        loadExploration(explorations[0].name);
      }
    } catch (err) {
      console.error('docchat init failed:', err);
      document.getElementById('repo-name').textContent = 'connection error';
    }
  }

  // ─── Render Functions ──────────────────────────

  function renderStats() {
    var el = document.getElementById('sidebar-stats');
    if (!repoInfo) return;
    var fileCount = repoInfo.fileCount || 0;
    var totalKB = repoInfo.totalSize ? (repoInfo.totalSize / 1024).toFixed(0) : '0';
    var expCount = repoInfo.explorationCount || explorations.length || 0;
    el.innerHTML =
      '<div class="stat">' + fileCount + ' docs</div>' +
      '<div class="stat-sep">\u00b7</div>' +
      '<div class="stat">' + totalKB + 'KB</div>' +
      '<div class="stat-sep">\u00b7</div>' +
      '<div class="stat">' + expCount + ' explorations</div>';
  }

  function renderDocTree() {
    var container = document.getElementById('doc-tree');
    if (!docs.length) {
      container.innerHTML = '<div class="empty-hint">No documents found</div>';
      return;
    }
    container.innerHTML = docs.map(function(doc) {
      var parts = doc.path.split('/');
      var name = parts.pop();
      var dir = parts.join('/');
      var safePath = escAttr(doc.path);
      return '<a class="doc-item" data-path="' + safePath + '" onclick="loadDoc(\'' + safeJs(doc.path) + '\')">' +
        (dir ? '<span class="doc-dir">' + escHtml(dir) + '/</span>' : '') +
        '<span class="doc-name">' + escHtml(name) + '</span>' +
        '</a>';
    }).join('');
  }

  function renderExplorations() {
    var container = document.getElementById('exploration-list');
    if (!explorations.length) {
      container.innerHTML = '<div class="empty-hint">No explorations yet</div>';
      return;
    }
    container.innerHTML = explorations.map(function(exp) {
      var safeName = escAttr(exp.name);
      return '<a class="exploration-item" data-name="' + safeName + '" onclick="loadExploration(\'' + safeJs(exp.name) + '\')">' +
        '<span class="exp-date">' + escHtml(exp.date || '') + '</span>' +
        '<span class="exp-commit">' + escHtml(exp.commit || '') + '</span>' +
        '</a>';
    }).join('');
  }

  // ─── Content Loading ───────────────────────────

  async function loadDoc(path) {
    setActiveItem('doc', path);
    try {
      var res = await fetch('/api/docs/' + encodeURIComponent(path));
      var text = await res.text();
      showContent(path, text);
    } catch (err) {
      showContent(path, '**Error loading document:** ' + String(err));
    }
  }

  async function loadExploration(name) {
    setActiveItem('exploration', name);
    try {
      var res = await fetch('/api/explorations/' + encodeURIComponent(name));
      var text = await res.text();
      // Strip YAML frontmatter for display
      var cleaned = text.replace(/^---[\s\S]*?---\n*/, '');
      showContent(name, cleaned);
    } catch (err) {
      showContent(name, '**Error loading exploration:** ' + String(err));
    }
  }

  function showContent(path, markdown) {
    document.getElementById('welcome').style.display = 'none';
    var view = document.getElementById('content-view');
    view.style.display = 'block';
    document.getElementById('content-path').textContent = path;
    document.getElementById('content-body').innerHTML = window.renderMarkdown
      ? window.renderMarkdown(markdown)
      : escHtml(markdown);
  }

  function setActiveItem(type, id) {
    // Remove all active states
    var actives = document.querySelectorAll('.doc-item.active, .exploration-item.active');
    for (var i = 0; i < actives.length; i++) {
      actives[i].classList.remove('active');
    }
    // Set new active
    var selector = type === 'doc'
      ? '.doc-item[data-path="' + escAttr(id) + '"]'
      : '.exploration-item[data-name="' + escAttr(id) + '"]';
    var el = document.querySelector(selector);
    if (el) el.classList.add('active');
    activeView = { type: type, path: id };
  }

  // ─── Utilities ─────────────────────────────────

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return escHtml(s).replace(/'/g, '&#39;');
  }

  function safeJs(s) {
    // Escape for safe embedding in onclick='...' attributes
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  // ─── Mobile Sidebar Toggle ────────────────────

  document.getElementById('sidebar-toggle').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Close sidebar when clicking content on mobile
  document.getElementById('content-panel').addEventListener('click', function() {
    var sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
    }
  });

  // ─── Expose Globals ───────────────────────────

  window.loadDoc = loadDoc;
  window.loadExploration = loadExploration;
  window.refreshExplorations = async function() {
    try {
      explorations = await fetch('/api/explorations').then(function(r) { return r.json(); }).catch(function() { return []; });
      renderExplorations();
      renderStats();
    } catch (err) {
      console.error('Failed to refresh explorations:', err);
    }
  };

  // ─── Start ────────────────────────────────────

  init();
})();
