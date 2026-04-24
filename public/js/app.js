(function() {
  'use strict';

  var state = {
    info: null,
    atlas: null,
    docs: [],
    activeTab: 'atlas',
    activeDoc: null,
    currentDraft: null,
    audit: null,
    media: null,
    selectedTopicId: null,
    pinnedPath: null,
    loading: {},
  };

  var els = {};

  function init() {
    cacheEls();
    bindEvents();
    loadInitialData();
  }

  function cacheEls() {
    [
      'repo-name', 'top-metrics', 'rail-metrics', 'doc-search', 'doc-list',
      'workspace-tabs', 'pane-eyebrow', 'pane-title', 'pane-actions',
      'analysis-body', 'reader-path', 'reader-meta', 'content-body',
      'save-draft', 'pinned-path', 'compare-panel', 'chat-provider',
      'action-log', 'rail-toggle', 'atlas-rail', 'rebuild-atlas',
      'run-audit-top',
    ].forEach(function(id) {
      els[toCamel(id)] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.railToggle.addEventListener('click', function() {
      els.atlasRail.classList.toggle('open');
    });

    els.rebuildAtlas.addEventListener('click', rebuildAtlas);
    els.runAuditTop.addEventListener('click', runAudit);
    els.saveDraft.addEventListener('click', saveCurrentDraft);

    els.docSearch.addEventListener('input', renderDocList);
    els.docList.addEventListener('click', function(event) {
      var row = event.target.closest('[data-doc-path]');
      if (row) loadDoc(row.dataset.docPath);
    });

    els.workspaceTabs.addEventListener('click', function(event) {
      var tab = event.target.closest('[data-tab]');
      if (tab) setTab(tab.dataset.tab);
    });

    els.paneActions.addEventListener('click', handleCommandEvent);
    els.analysisBody.addEventListener('click', handleCommandEvent);

    els.contentBody.addEventListener('click', function(event) {
      var link = event.target.closest('a[data-local-doc-link]');
      if (!link) return;
      event.preventDefault();
      openLocalDocLink(link.getAttribute('href'));
    });
  }

  function handleCommandEvent(event) {
      var target = event.target.closest('[data-command]');
      if (!target) return;
      var command = target.dataset.command;
      if (command === 'draft') draftSynthesis(target.dataset.type, target.dataset.topicId, target.dataset.pathId);
      if (command === 'save-draft') saveCurrentDraft();
      if (command === 'open-doc') loadDoc(target.dataset.path);
      if (command === 'show-topic') showTopic(target.dataset.topicId);
      if (command === 'pin-path') pinReadingPath(target.dataset.pathId);
      if (command === 'compare') compareDocs((target.dataset.paths || '').split('|').filter(Boolean));
      if (command === 'run-audit') runAudit();
      if (command === 'generate-media') generateMedia();
      if (command === 'promote-media') promoteMedia(target.dataset.jobId);
  }

  async function loadInitialData() {
    try {
      var results = await Promise.all([
        apiJson('/api/info'),
        apiJson('/api/atlas'),
        apiJson('/api/media'),
      ]);
      state.info = results[0];
      state.atlas = results[1];
      state.docs = state.atlas.docs || [];
      state.media = results[2];
      document.title = 'DocChat - ' + (state.info.name || state.atlas.rootName || 'project');
      els.repoName.textContent = state.info.name || state.atlas.rootName || 'project';
      els.chatProvider.textContent = state.info.assistantProvider || 'local-guide';
      renderAll();
      var firstDoc = state.docs.find(function(doc) { return doc.path === 'README.md'; }) || state.docs[0];
      if (firstDoc) loadDoc(firstDoc.path);
    } catch (err) {
      renderError('Could not load DocChat data: ' + String(err));
    }
  }

  function renderAll() {
    renderMetrics();
    renderDocList();
    renderTabs();
    renderAnalysis();
  }

  function renderMetrics() {
    if (!state.atlas) return;
    var stats = state.atlas.stats;
    var metrics = [
      ['DOCS', stats.docs],
      ['TOPICS', stats.topics],
      ['CLUSTERS', stats.clusters],
      ['OVERLAP', stats.duplicates],
      ['SIZE', Math.round((stats.totalBytes || 0) / 1024) + 'KB'],
    ];
    els.topMetrics.innerHTML = metrics.map(function(item) {
      return '<div class="ticker-item"><span class="ticker-label">' + esc(item[0]) + '</span><span class="ticker-value">' + esc(item[1]) + '</span></div>';
    }).join('');

    els.railMetrics.innerHTML = metrics.slice(0, 4).map(function(item) {
      return '<div class="rail-metric"><span class="metric-value">' + esc(item[1]) + '</span><span class="metric-label">' + esc(item[0]) + '</span></div>';
    }).join('');
  }

  function renderDocList() {
    var query = (els.docSearch.value || '').toLowerCase().trim();
    var docs = state.docs.filter(function(doc) {
      if (!query) return true;
      return [doc.path, doc.title, doc.role, doc.cluster].join(' ').toLowerCase().includes(query);
    });
    if (!docs.length) {
      els.docList.innerHTML = '<div class="empty-state">No matching markdown files.</div>';
      return;
    }
    els.docList.innerHTML = docs.map(function(doc) {
      var active = state.activeDoc === doc.path ? ' active' : '';
      return [
        '<button class="doc-row' + active + '" type="button" data-doc-path="' + attr(doc.path) + '">',
          '<span>',
            '<span class="doc-title">' + esc(doc.title || doc.path) + '</span>',
            '<span class="doc-path">' + esc(doc.path) + '</span>',
          '</span>',
          '<span class="role-chip">' + esc(doc.role) + '</span>',
        '</button>',
      ].join('');
    }).join('');
  }

  function renderTabs() {
    var buttons = els.workspaceTabs.querySelectorAll('[data-tab]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.tab === state.activeTab);
    }
  }

  function renderAnalysis() {
    if (!state.atlas) return;
    renderTabs();
    els.paneEyebrow.textContent = state.activeTab;
    els.paneActions.innerHTML = '';
    if (state.activeTab === 'atlas') renderAtlasPane();
    if (state.activeTab === 'topics') renderTopicsPane();
    if (state.activeTab === 'paths') renderPathsPane();
    if (state.activeTab === 'audit') renderAuditPane();
    if (state.activeTab === 'media') renderMediaPane();
  }

  function renderAtlasPane() {
    els.paneTitle.textContent = 'Documentation Atlas';
    els.paneActions.innerHTML = '<button class="tool-button" type="button" data-command="draft" data-type="overview">Overview</button>';
    var stats = state.atlas.stats;
    var rows = [
      ['Generated', formatDate(state.atlas.generatedAt)],
      ['Root', state.atlas.rootName],
      ['Docs', stats.docs],
      ['Topics', stats.topics],
      ['Clusters', stats.clusters],
      ['Overlap', stats.duplicates],
    ];
    var html = [
      '<div class="ledger">',
      rows.map(function(row) {
        return '<div class="ledger-row"><div class="ledger-key">' + esc(row[0]) + '</div><div class="ledger-value">' + esc(row[1]) + '</div></div>';
      }).join(''),
      '</div>',
      '<div class="action-strip">',
        '<button class="tool-button" type="button" data-command="draft" data-type="overview">Draft overview</button>',
        '<button class="tool-button" type="button" data-command="draft" data-type="start-here">Draft start here</button>',
        '<button class="tool-button" type="button" data-command="draft" data-type="glossary">Draft glossary</button>',
        '<button class="tool-button" type="button" data-command="run-audit">Run audit</button>',
      '</div>',
      '<h2 class="section-title">Topic Tape</h2>',
      renderTopicRows(state.atlas.topics.slice(0, 6)),
      '<h2 class="section-title">Reading Paths</h2>',
      renderPathRows(state.atlas.readingPaths.slice(0, 3)),
      '<h2 class="section-title">Overlap Signals</h2>',
      renderDuplicateRows(),
    ].join('');
    els.analysisBody.innerHTML = html;
  }

  function renderTopicsPane() {
    els.paneTitle.textContent = 'Topics';
    els.paneActions.innerHTML = '<button class="tool-button" type="button" data-command="draft" data-type="topic-summary" data-topic-id="' + attr(state.selectedTopicId || state.atlas.topics[0]?.id || '') + '">Draft</button>';
    els.analysisBody.innerHTML = renderTopicRows(state.atlas.topics);
    if (state.selectedTopicId) {
      var selected = els.analysisBody.querySelector('[data-topic-row="' + cssEscape(state.selectedTopicId) + '"]');
      if (selected) selected.scrollIntoView({ block: 'center' });
    }
  }

  function renderPathsPane() {
    els.paneTitle.textContent = 'Reading Paths';
    els.paneActions.innerHTML = '<button class="tool-button" type="button" data-command="draft" data-type="start-here">Draft</button>';
    els.analysisBody.innerHTML = renderPathRows(state.atlas.readingPaths);
  }

  function renderAuditPane() {
    els.paneTitle.textContent = 'Coherence Audit';
    els.paneActions.innerHTML = '<button class="tool-button" type="button" data-command="run-audit">Run</button>';
    if (state.loading.audit) {
      els.analysisBody.innerHTML = '<div class="empty-state">Running audit...</div>';
      return;
    }
    if (!state.audit) {
      els.analysisBody.innerHTML = [
        '<div class="ledger">',
          '<div class="ledger-row"><div class="ledger-key">Duplicates</div><div class="ledger-value">' + esc(state.atlas.stats.duplicates) + '</div></div>',
          '<div class="ledger-row"><div class="ledger-key">Broken links</div><div class="ledger-value">pending</div></div>',
          '<div class="ledger-row"><div class="ledger-key">Contradictions</div><div class="ledger-value">pending</div></div>',
        '</div>',
        '<div class="action-strip"><button class="tool-button" type="button" data-command="run-audit">Run coherence audit</button></div>',
      ].join('');
      return;
    }
    els.analysisBody.innerHTML = renderFindings(state.audit.findings || []);
  }

  function renderMediaPane() {
    els.paneTitle.textContent = 'Guide Visuals';
    var availability = state.media?.availability || {};
    var status = availability.available ? 'available' : 'unavailable';
    els.paneActions.innerHTML = '<span class="status-chip">' + esc(status) + '</span>';
    var jobs = state.media?.jobs || [];
    els.analysisBody.innerHTML = [
      '<div class="ledger">',
        '<div class="ledger-row"><div class="ledger-key">Model</div><div class="ledger-value">' + esc(availability.model || 'nano-banana-pro') + '</div></div>',
        '<div class="ledger-row"><div class="ledger-key">Policy</div><div class="ledger-value">' + esc(availability.outputPolicy || 'preview-first') + '</div></div>',
        '<div class="ledger-row"><div class="ledger-key">Status</div><div class="ledger-value">' + esc(status) + '</div></div>',
      '</div>',
      '<h2 class="section-title">Generate</h2>',
      '<div class="form-stack">',
        '<label class="field-label">Workflow<span>diagram, taxonomy, timeline, comparison</span><select class="select-input" id="media-workflow">',
          '<option value="technical-diagram">Technical diagram</option>',
          '<option value="taxonomy">Taxonomy</option>',
          '<option value="timeline">Timeline</option>',
          '<option value="comparison">Comparison</option>',
        '</select></label>',
        '<label class="field-label">Prompt<span>draft output previews in Downloads</span><textarea class="prompt-input" id="media-prompt">Create a crisp Bloomberg editorial technical diagram that explains the main documentation map for ' + esc(state.atlas.rootName) + '.</textarea></label>',
        '<button class="tool-button" type="button" data-command="generate-media">Generate preview</button>',
      '</div>',
      '<h2 class="section-title">Jobs</h2>',
      renderMediaJobs(jobs),
    ].join('');
  }

  function renderTopicRows(topics) {
    if (!topics.length) return '<div class="empty-state">No topics detected.</div>';
    return '<div class="topic-grid">' + topics.map(function(topic) {
      var selected = state.selectedTopicId === topic.id ? ' style="border-color: var(--accent-2)"' : '';
      return [
        '<div class="topic-row" data-topic-row="' + attr(topic.id) + '"' + selected + '>',
          '<div>',
            '<div class="topic-name">' + esc(topic.label) + '</div>',
            '<div class="topic-meta">' + esc(topic.docPaths.length) + ' docs · ' + esc(topic.summary) + '</div>',
            '<div class="topic-keywords">' + topic.keywords.slice(0, 8).map(function(k) { return '<span class="keyword">' + esc(k) + '</span>'; }).join('') + '</div>',
          '</div>',
          '<div class="action-strip">',
            '<button class="tool-button" type="button" data-command="show-topic" data-topic-id="' + attr(topic.id) + '">Open</button>',
            '<button class="tool-button" type="button" data-command="draft" data-type="topic-summary" data-topic-id="' + attr(topic.id) + '">Draft</button>',
          '</div>',
        '</div>',
      ].join('');
    }).join('') + '</div>';
  }

  function renderPathRows(paths) {
    if (!paths.length) return '<div class="empty-state">No reading paths detected.</div>';
    return '<div class="path-list">' + paths.map(function(path) {
      return [
        '<div class="path-row">',
          '<div class="path-name">' + esc(path.title) + '</div>',
          '<div class="path-meta">' + esc(path.audience) + '</div>',
          '<div class="path-items">',
            path.items.map(function(item, index) {
              return [
                '<div class="path-item">',
                  '<div class="path-index">' + (index + 1) + '</div>',
                  '<div><button class="doc-row" type="button" data-command="open-doc" data-path="' + attr(item.path) + '"><span><span class="path-source">' + esc(item.path) + '</span><span class="path-reason">' + esc(item.reason) + '</span></span></button></div>',
                '</div>',
              ].join('');
            }).join(''),
          '</div>',
          '<div class="action-strip"><button class="tool-button" type="button" data-command="pin-path" data-path-id="' + attr(path.id) + '">Pin</button><button class="tool-button" type="button" data-command="draft" data-type="start-here" data-path-id="' + attr(path.id) + '">Draft</button></div>',
        '</div>',
      ].join('');
    }).join('') + '</div>';
  }

  function renderDuplicateRows() {
    var duplicates = state.atlas.duplicates || [];
    if (!duplicates.length) return '<div class="empty-state">No deterministic overlap candidates.</div>';
    return '<div class="finding-list">' + duplicates.slice(0, 8).map(function(dup) {
      return [
        '<div class="duplicate-row">',
          '<div class="finding-title">' + esc(dup.reason) + '</div>',
          '<div class="duplicate-meta">' + esc(dup.paths.join(' vs ')) + ' · ' + Math.round(dup.confidence * 100) + '%</div>',
          '<div class="action-strip"><button class="tool-button" type="button" data-command="compare" data-paths="' + attr(dup.paths.join('|')) + '">Compare</button></div>',
        '</div>',
      ].join('');
    }).join('') + '</div>';
  }

  function renderFindings(findings) {
    if (!findings.length) return '<div class="empty-state">No audit findings.</div>';
    return '<div class="finding-list">' + findings.map(function(finding) {
      return [
        '<div class="finding-row">',
          '<div><span class="severity-chip">' + esc(finding.severity) + '</span></div>',
          '<div class="finding-title">' + esc(finding.title) + '</div>',
          '<div class="finding-detail">' + esc(finding.detail) + '</div>',
          '<div class="finding-detail">' + esc(finding.recommendation) + '</div>',
          '<div class="topic-keywords">' + finding.paths.map(function(path) { return '<button class="tool-button" type="button" data-command="open-doc" data-path="' + attr(path) + '">' + esc(path) + '</button>'; }).join('') + '</div>',
        '</div>',
      ].join('');
    }).join('') + '</div>';
  }

  function renderMediaJobs(jobs) {
    if (!jobs.length) return '<div class="empty-state">No media jobs yet.</div>';
    return '<div class="media-list">' + jobs.map(function(job) {
      return [
        '<div class="media-row">',
          '<div><span class="status-chip">' + esc(job.status) + '</span></div>',
          '<div class="media-title">' + esc(job.workflow) + '</div>',
          '<div class="media-meta">' + esc(job.prompt) + '</div>',
          job.outputPath ? '<div class="media-meta">' + esc(job.outputPath) + '</div>' : '',
          job.error ? '<div class="error-text">' + esc(job.error) + '</div>' : '',
          job.status === 'complete' ? '<button class="tool-button" type="button" data-command="promote-media" data-job-id="' + attr(job.id) + '">Approve</button>' : '',
        '</div>',
      ].join('');
    }).join('') + '</div>';
  }

  async function loadDoc(path, options) {
    options = options || {};
    try {
      var res = await fetch('/api/docs/' + encodeURIComponent(path));
      if (!res.ok) throw new Error('Document not found');
      var markdown = await res.text();
      state.activeDoc = path;
      state.currentDraft = null;
      renderDocList();
      els.saveDraft.hidden = true;
      els.comparePanel.hidden = true;
      var doc = state.docs.find(function(item) { return item.path === path; });
      els.readerPath.textContent = path;
      els.readerMeta.textContent = doc ? [doc.role, doc.cluster, formatBytes(doc.size), doc.headings.length + ' headings'].join(' · ') : '';
      els.contentBody.innerHTML = renderMarkdownSafe(markdown);
      if (options.heading) {
        setTimeout(function() { jumpToHeading(options.heading); }, 40);
      }
      if (options.headings) {
        setTimeout(function() { highlightHeadings(options.headings); }, 40);
      }
    } catch (err) {
      showReaderError(String(err));
    }
  }

  async function compareDocs(paths) {
    if (!paths || paths.length < 2) return;
    var docs = await Promise.all(paths.map(async function(path) {
      try {
        var res = await fetch('/api/docs/' + encodeURIComponent(path));
        return { path: path, markdown: await res.text() };
      } catch (err) {
        return { path: path, markdown: 'Error: ' + String(err) };
      }
    }));
    els.comparePanel.hidden = false;
    els.comparePanel.innerHTML = [
      '<div class="section-title">Comparison</div>',
      '<div class="compare-grid">',
        docs.map(function(doc) {
          return '<div class="compare-doc"><div class="compare-doc-header">' + esc(doc.path) + '</div><div class="compare-doc-body">' + renderMarkdownSafe(doc.markdown.slice(0, 7000)) + '</div></div>';
        }).join(''),
      '</div>',
    ].join('');
  }

  function showTemporaryPage(title, markdown, draft) {
    state.currentDraft = draft || { title: title, markdown: markdown };
    state.activeDoc = null;
    els.saveDraft.hidden = false;
    els.comparePanel.hidden = true;
    els.readerPath.textContent = title;
    els.readerMeta.textContent = 'temporary synthesis · .docchat/summaries';
    els.contentBody.innerHTML = renderMarkdownSafe(markdown);
  }

  async function draftSynthesis(type, topicId, pathId) {
    try {
      var draft = await apiJson('/api/synthesis/draft', {
        method: 'POST',
        body: JSON.stringify({ type: type, topicId: topicId || undefined, pathId: pathId || undefined }),
      });
      showTemporaryPage(draft.title, draft.markdown, draft);
      logAction({ type: 'show_temporary_page', payload: { title: draft.title } });
    } catch (err) {
      showReaderError('Synthesis failed: ' + String(err));
    }
  }

  async function saveCurrentDraft() {
    if (!state.currentDraft) return;
    try {
      var saved = await apiJson('/api/synthesis/save', {
        method: 'POST',
        body: JSON.stringify({
          name: state.currentDraft.title || 'summary',
          markdown: state.currentDraft.markdown,
        }),
      });
      els.readerMeta.innerHTML = '<span class="success-text">saved</span> · ' + esc(saved.name);
      logAction({ type: 'save_summary', payload: { name: saved.name } });
    } catch (err) {
      showReaderError('Save failed: ' + String(err));
    }
  }

  async function runAudit() {
    state.activeTab = 'audit';
    state.loading.audit = true;
    renderAnalysis();
    try {
      state.audit = await apiJson('/api/audit/run', { method: 'POST' });
    } catch (err) {
      state.audit = { findings: [], error: String(err) };
    } finally {
      state.loading.audit = false;
      renderAnalysis();
      logAction({ type: 'audit', payload: { findings: state.audit.findings?.length || 0 } });
    }
  }

  async function generateMedia() {
    var prompt = document.getElementById('media-prompt')?.value || '';
    var workflow = document.getElementById('media-workflow')?.value || 'technical-diagram';
    if (!prompt.trim()) return;
    try {
      await apiJson('/api/media/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: prompt, workflow: workflow }),
      });
      await refreshMedia();
      setTab('media');
      logAction({ type: 'media_generate', payload: { workflow: workflow } });
    } catch (err) {
      state.media = state.media || { jobs: [], availability: {} };
      state.media.jobs = [{ status: 'failed', workflow: workflow, prompt: prompt, error: String(err), createdAt: new Date().toISOString() }].concat(state.media.jobs || []);
      renderAnalysis();
    }
  }

  async function promoteMedia(jobId) {
    try {
      await apiJson('/api/media/promote', {
        method: 'POST',
        body: JSON.stringify({ jobId: jobId }),
      });
      await refreshMedia();
      logAction({ type: 'media_promote', payload: { jobId: jobId } });
    } catch (err) {
      alert('Could not approve media: ' + String(err));
    }
  }

  async function refreshMedia() {
    state.media = await apiJson('/api/media');
    if (state.activeTab === 'media') renderAnalysis();
  }

  async function rebuildAtlas() {
    state.loading.atlas = true;
    els.rebuildAtlas.disabled = true;
    try {
      state.atlas = await apiJson('/api/atlas/rebuild', { method: 'POST' });
      state.docs = state.atlas.docs || [];
      state.audit = null;
      renderAll();
      logAction({ type: 'atlas_rebuild', payload: { docs: state.atlas.stats.docs } });
    } finally {
      state.loading.atlas = false;
      els.rebuildAtlas.disabled = false;
    }
  }

  function setTab(tab) {
    state.activeTab = tab;
    renderAnalysis();
  }

  function showTopic(topicId) {
    state.selectedTopicId = topicId;
    setTab('topics');
  }

  function pinReadingPath(pathIdOrPath) {
    var path = typeof pathIdOrPath === 'string'
      ? state.atlas.readingPaths.find(function(item) { return item.id === pathIdOrPath; })
      : pathIdOrPath;
    if (!path) return;
    state.pinnedPath = path;
    els.pinnedPath.hidden = false;
    els.pinnedPath.innerHTML = [
      '<div class="path-name">' + esc(path.title) + '</div>',
      '<div class="path-items">',
        path.items.map(function(item, index) {
          return '<div class="path-item"><div class="path-index">' + (index + 1) + '</div><div><button class="doc-row" type="button" data-doc-path="' + attr(item.path) + '"><span><span class="path-source">' + esc(item.path) + '</span><span class="path-reason">' + esc(item.reason || '') + '</span></span></button></div></div>';
        }).join(''),
      '</div>',
    ].join('');
    els.pinnedPath.querySelectorAll('[data-doc-path]').forEach(function(button) {
      button.addEventListener('click', function() { loadDoc(button.dataset.docPath); });
    });
  }

  function applyAction(action) {
    if (!action || !action.type) return;
    var payload = action.payload || {};
    logAction(action);
    if (action.type === 'open_doc') loadDoc(payload.path);
    if (action.type === 'jump_to_heading') loadDoc(payload.path, { heading: payload.heading });
    if (action.type === 'show_topic') showTopic(payload.topicId);
    if (action.type === 'compare_docs') compareDocs(payload.paths || []);
    if (action.type === 'highlight_ranges') loadDoc(payload.path, { headings: payload.headings || [] });
    if (action.type === 'pin_reading_path') pinReadingPath(payload.pathId || payload);
    if (action.type === 'show_temporary_page') showTemporaryPage('Assistant Draft', payload.markdown || '');
    if (action.type === 'set_focus') focusMode(payload.mode);
  }

  function focusMode(mode) {
    if (mode === 'topics' || mode === 'paths' || mode === 'audit' || mode === 'media') setTab(mode);
    if (mode === 'files') els.docSearch.focus();
    if (mode === 'chat') document.getElementById('chat-input')?.focus();
  }

  function logAction(action) {
    if (!els.actionLog) return;
    var pill = document.createElement('div');
    pill.className = 'action-pill';
    pill.textContent = action.type + ' ' + summarizePayload(action.payload || {});
    els.actionLog.prepend(pill);
    while (els.actionLog.children.length > 5) els.actionLog.lastChild.remove();
  }

  function jumpToHeading(heading) {
    if (!heading) return;
    var target = findHeadingElement(heading);
    if (target) {
      target.classList.add('is-highlighted');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function highlightHeadings(headings) {
    clearHighlights();
    (headings || []).forEach(function(heading) {
      var target = findHeadingElement(heading);
      if (target) target.classList.add('is-highlighted');
    });
  }

  function findHeadingElement(heading) {
    var wanted = String(heading).toLowerCase();
    var candidates = els.contentBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < candidates.length; i++) {
      var text = candidates[i].textContent.trim().toLowerCase();
      if (text === wanted || candidates[i].id === slugify(wanted)) return candidates[i];
    }
    return null;
  }

  function clearHighlights() {
    els.contentBody.querySelectorAll('.is-highlighted').forEach(function(node) {
      node.classList.remove('is-highlighted');
    });
  }

  function openLocalDocLink(href) {
    if (!href) return;
    var pieces = href.split('#');
    var target = pieces[0];
    var heading = pieces[1] || '';
    if (!target && heading) {
      jumpToHeading(heading.replace(/-/g, ' '));
      return;
    }
    var normalized = normalizeDocPath(state.activeDoc, target);
    if (!state.docs.some(function(doc) { return doc.path === normalized; })) return;
    loadDoc(normalized, heading ? { heading: heading.replace(/-/g, ' ') } : undefined);
  }

  function normalizeDocPath(fromPath, target) {
    if (!fromPath || target.charAt(0) === '/') return target.replace(/^\/+/, '');
    var base = fromPath.split('/').slice(0, -1);
    target.split('/').forEach(function(part) {
      if (!part || part === '.') return;
      if (part === '..') base.pop();
      else base.push(part);
    });
    return base.join('/');
  }

  function showReaderError(message) {
    els.readerPath.textContent = 'Error';
    els.readerMeta.textContent = '';
    els.contentBody.innerHTML = '<div class="error-text">' + esc(message) + '</div>';
  }

  function renderError(message) {
    els.analysisBody.innerHTML = '<div class="error-text">' + esc(message) + '</div>';
  }

  function renderMarkdownSafe(markdown) {
    return window.renderMarkdown ? window.renderMarkdown(markdown || '') : esc(markdown || '');
  }

  async function apiJson(url, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var res = await fetch(url, options);
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) {
    return esc(value);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function toCamel(id) {
    return id.replace(/-([a-z])/g, function(_, ch) { return ch.toUpperCase(); });
  }

  function formatBytes(bytes) {
    if (!bytes) return '0B';
    if (bytes < 1024) return bytes + 'B';
    return Math.round(bytes / 1024) + 'KB';
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section';
  }

  function summarizePayload(payload) {
    if (!payload) return '';
    if (payload.path) return payload.path;
    if (payload.topicId) return payload.topicId;
    if (payload.pathId) return payload.pathId;
    if (payload.paths) return payload.paths.join(' vs ');
    if (payload.name) return payload.name;
    return '';
  }

  window.DocChat = {
    state: state,
    applyAction: applyAction,
    logAction: logAction,
    loadDoc: loadDoc,
    compareDocs: compareDocs,
    runAudit: runAudit,
    draftSynthesis: draftSynthesis,
    refreshMedia: refreshMedia,
    focusMode: focusMode,
  };

  init();
})();
