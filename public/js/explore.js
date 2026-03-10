/**
 * docchat — Exploration Trigger and Progress UI
 *
 * Handles: triggering explorations via POST, streaming progress/status/done
 * events via SSE, displaying live progress in the content area, and refreshing
 * the sidebar exploration list on completion.
 */
(function() {
  'use strict';

  var exploreBtn = document.getElementById('explore-btn');
  var exploring = false;

  async function triggerExplore() {
    if (exploring) return;
    exploring = true;
    exploreBtn.disabled = true;
    exploreBtn.textContent = '\u27f3 Exploring...';

    // Show progress in content area
    document.getElementById('welcome').style.display = 'none';
    var view = document.getElementById('content-view');
    view.style.display = 'block';
    document.getElementById('content-path').textContent = 'Exploration in progress...';
    var body = document.getElementById('content-body');
    body.innerHTML = '<div class="explore-progress" id="explore-progress">' +
      '<div class="progress-text">Starting exploration...</div></div>';

    var progressEl = document.getElementById('explore-progress');
    var fullContent = '';

    try {
      var resp = await fetch('/api/explore', { method: 'POST' });

      if (!resp.ok) {
        throw new Error('Server returned ' + resp.status);
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var currentEvent = '';

      while (true) {
        var result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];

          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            var data;
            try {
              data = JSON.parse(line.slice(5).trim());
            } catch (e) {
              continue;
            }

            if (currentEvent === 'progress' && data.text) {
              fullContent += data.text;
              body.innerHTML = window.renderMarkdown
                ? window.renderMarkdown(fullContent)
                : fullContent;
            } else if (currentEvent === 'status' && data.message) {
              // Status updates like "Starting agent 1..."
              var statusEl = document.createElement('div');
              statusEl.className = 'progress-status';
              statusEl.textContent = data.message;
              if (progressEl) {
                progressEl.appendChild(statusEl);
              }
            } else if (currentEvent === 'done') {
              document.getElementById('content-path').textContent =
                data.filename || 'Exploration complete';
              var finalContent = data.content || fullContent;
              body.innerHTML = window.renderMarkdown
                ? window.renderMarkdown(finalContent)
                : finalContent;
              // Refresh sidebar explorations
              if (window.refreshExplorations) {
                window.refreshExplorations();
              }
            } else if (currentEvent === 'error') {
              body.innerHTML = '<div class="error-text">' +
                (data.message || 'Exploration failed') + '</div>';
            }
            currentEvent = '';
          }
        }
      }
    } catch (err) {
      body.innerHTML = '<div class="error-text">Exploration failed: ' +
        String(err) + '</div>';
    } finally {
      exploring = false;
      exploreBtn.disabled = false;
      exploreBtn.textContent = '\u25b6 Run Exploration';
    }
  }

  // Expose globally for onclick handlers
  window.triggerExplore = triggerExplore;
})();
