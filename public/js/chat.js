(function() {
  'use strict';

  var sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send');
  var messages = document.getElementById('chat-messages');
  var clearBtn = document.getElementById('clear-chat');
  var streaming = false;

  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', function(event) {
    event.preventDefault();
    sendMessage();
  });

  clearBtn.addEventListener('click', function() {
    messages.innerHTML = '<div class="chat-message assistant"><div class="message-content">Fresh thread. The atlas stays loaded.</div></div>';
  });

  async function sendMessage() {
    var prompt = input.value.trim();
    if (!prompt || streaming) return;

    streaming = true;
    sendBtn.disabled = true;
    input.value = '';
    resizeInput();
    addMessage('user', esc(prompt));

    var assistant = addMessage('assistant', '');
    var contentEl = assistant.querySelector('.message-content');
    var cursor = document.createElement('span');
    cursor.className = 'chat-cursor';
    contentEl.appendChild(cursor);
    var fullText = '';

    try {
      var resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt, sessionId: sessionId }),
      });
      if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var read = await reader.read();
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (var i = 0; i < parts.length; i++) handleSseBlock(parts[i]);
      }
      if (buffer.trim()) handleSseBlock(buffer);
    } catch (err) {
      cursor.remove();
      contentEl.innerHTML = '<span class="error-text">' + esc(String(err)) + '</span>';
    } finally {
      streaming = false;
      sendBtn.disabled = false;
      input.focus();
    }

    function handleSseBlock(block) {
      var event = 'message';
      var data = {};
      block.split('\n').forEach(function(line) {
        if (line.indexOf('event:') === 0) event = line.slice(6).trim();
        if (line.indexOf('data:') === 0) {
          try { data = JSON.parse(line.slice(5).trim()); } catch {}
        }
      });

      if (event === 'meta') {
        var provider = document.getElementById('chat-provider');
        if (provider && data.provider) provider.textContent = data.provider;
      }

      if (event === 'token') {
        fullText += data.text || '';
        cursor.remove();
        contentEl.innerHTML = renderText(fullText);
        contentEl.appendChild(cursor);
        scrollMessages();
      }

      if (event === 'action') {
        window.DocChat?.applyAction(data);
      }

      if (event === 'done') {
        cursor.remove();
        contentEl.innerHTML = renderText(data.fullText || fullText);
        scrollMessages();
      }

      if (event === 'error') {
        cursor.remove();
        contentEl.innerHTML = '<span class="error-text">' + esc(data.error || data.message || 'Chat failed') + '</span>';
      }
    }
  }

  function addMessage(role, html) {
    var node = document.createElement('div');
    node.className = 'chat-message ' + role;
    node.innerHTML = '<div class="message-content">' + html + '</div>';
    messages.appendChild(node);
    scrollMessages();
    return node;
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  }

  function scrollMessages() {
    messages.scrollTop = messages.scrollHeight;
  }

  function renderText(text) {
    return window.renderMarkdown ? window.renderMarkdown(text || '') : esc(text || '');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
