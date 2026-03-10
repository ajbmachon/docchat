/**
 * docchat — Chat Panel with SSE Streaming
 *
 * Handles: message sending, SSE stream parsing for token/done/error events,
 * auto-resizing textarea, keyboard shortcuts, and streaming cursor display.
 */
(function() {
  'use strict';

  var sessionId = crypto.randomUUID();
  var input = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send');
  var messages = document.getElementById('chat-messages');
  var streaming = false;

  // ─── Utilities ─────────────────────────────────

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addMessage(role, html) {
    var div = document.createElement('div');
    div.className = 'chat-message ' + role;
    div.innerHTML = '<div class="message-content">' + html + '</div>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  // ─── Auto-resize Textarea ─────────────────────

  input.addEventListener('input', function() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Enter to send, Shift+Enter for newline
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ─── Send Message with SSE Streaming ──────────

  async function sendMessage() {
    var question = input.value.trim();
    if (!question || streaming) return;

    streaming = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    // Add user message
    addMessage('user', escHtml(question));

    // Create assistant message with cursor
    var assistantDiv = addMessage('assistant', '');
    var contentEl = assistantDiv.querySelector('.message-content');
    var cursor = document.createElement('span');
    cursor.className = 'chat-cursor';
    contentEl.appendChild(cursor);

    var fullText = '';

    try {
      var resp = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question, sessionId: sessionId }),
      });

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

            if (currentEvent === 'token' && data.text) {
              fullText += data.text;
              cursor.remove();
              contentEl.innerHTML = window.renderMarkdown
                ? window.renderMarkdown(fullText)
                : escHtml(fullText);
              contentEl.appendChild(cursor);
              messages.scrollTop = messages.scrollHeight;
            } else if (currentEvent === 'done') {
              var finalText = data.fullText || fullText;
              cursor.remove();
              contentEl.innerHTML = window.renderMarkdown
                ? window.renderMarkdown(finalText)
                : escHtml(finalText);
              messages.scrollTop = messages.scrollHeight;
            } else if (currentEvent === 'error') {
              cursor.remove();
              contentEl.innerHTML = '<span class="error-text">' +
                escHtml(data.message || 'An error occurred') + '</span>';
            }
            currentEvent = '';
          }
        }
      }

      // If stream ended without a done event, finalize with what we have
      if (fullText && contentEl.querySelector('.chat-cursor')) {
        cursor.remove();
        contentEl.innerHTML = window.renderMarkdown
          ? window.renderMarkdown(fullText)
          : escHtml(fullText);
      }

    } catch (err) {
      cursor.remove();
      contentEl.innerHTML = '<span class="error-text">' +
        escHtml('Failed to get response: ' + String(err)) + '</span>';
    } finally {
      streaming = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
})();
