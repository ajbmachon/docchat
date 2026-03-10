/**
 * docchat — Zero-dependency Markdown Renderer
 *
 * Converts markdown text to HTML. XSS-safe via HTML escaping.
 * Supports: headings, bold, italic, strikethrough, inline code,
 * fenced code blocks, links, images, lists, blockquotes, tables, hr.
 */
(function() {
  'use strict';

  /**
   * Escape HTML entities to prevent XSS.
   */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Process inline markdown formatting within a line.
   * Order matters: code first (to protect from other processing),
   * then images, links, bold, italic, strikethrough.
   */
  function processInline(text) {
    // Inline code (must be first to protect contents)
    text = text.replace(/`([^`]+?)`/g, function(_, code) {
      return '<code>' + escapeHtml(code) + '</code>';
    });

    // Images: ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(_, alt, url) {
      return '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '">';
    });

    // Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, linkText, url) {
      var escaped = escapeHtml(url);
      var isExternal = /^https?:\/\//.test(url);
      var target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + escaped + '"' + target + '>' + linkText + '</a>';
    });

    // Bold: **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_ (but not inside words for underscore)
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    return text;
  }

  /**
   * Render a markdown string to HTML.
   * @param {string} text - Raw markdown text
   * @returns {string} HTML string
   */
  function renderMarkdown(text) {
    if (!text) return '';

    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Extract fenced code blocks first to protect them from processing
    var codeBlocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
      var index = codeBlocks.length;
      var langLabel = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
      codeBlocks.push(
        '<pre><code class="language-' + escapeHtml(lang || 'text') + '">' +
        langLabel + escapeHtml(code.replace(/\n$/, '')) +
        '</code></pre>'
      );
      return '\n%%CODEBLOCK_' + index + '%%\n';
    });

    var lines = text.split('\n');
    var html = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Code block placeholder
      var codeMatch = line.match(/^%%CODEBLOCK_(\d+)%%$/);
      if (codeMatch) {
        html.push(codeBlocks[parseInt(codeMatch[1], 10)]);
        i++;
        continue;
      }

      // Horizontal rule: --- or *** or ___ (3+ chars, possibly with spaces)
      if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
        html.push('<hr>');
        i++;
        continue;
      }

      // Headings: # H1 through ###### H6
      var headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var headingText = processInline(escapeHtml(headingMatch[2]));
        html.push('<h' + level + '>' + headingText + '</h' + level + '>');
        i++;
        continue;
      }

      // Table: lines starting with |
      if (/^\|/.test(line)) {
        var tableLines = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          tableLines.push(lines[i]);
          i++;
        }
        html.push(renderTable(tableLines));
        continue;
      }

      // Blockquote: > text
      if (/^>\s?/.test(line)) {
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        var quoteContent = quoteLines.map(function(l) {
          return '<p>' + processInline(escapeHtml(l)) + '</p>';
        }).join('');
        html.push('<blockquote>' + quoteContent + '</blockquote>');
        continue;
      }

      // Unordered list: - item or * item
      if (/^[\s]*[-*]\s+/.test(line)) {
        var listItems = [];
        while (i < lines.length && /^[\s]*[-*]\s+/.test(lines[i])) {
          var itemText = lines[i].replace(/^[\s]*[-*]\s+/, '');
          listItems.push('<li>' + processInline(escapeHtml(itemText)) + '</li>');
          i++;
        }
        html.push('<ul>' + listItems.join('') + '</ul>');
        continue;
      }

      // Ordered list: 1. item
      if (/^[\s]*\d+\.\s+/.test(line)) {
        var olItems = [];
        while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
          var olText = lines[i].replace(/^[\s]*\d+\.\s+/, '');
          olItems.push('<li>' + processInline(escapeHtml(olText)) + '</li>');
          i++;
        }
        html.push('<ol>' + olItems.join('') + '</ol>');
        continue;
      }

      // Empty line
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // Paragraph: collect consecutive non-special lines
      var paraLines = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !/^\|/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^[\s]*[-*]\s+/.test(lines[i]) &&
        !/^[\s]*\d+\.\s+/.test(lines[i]) &&
        !/^(\s*[-*_]\s*){3,}$/.test(lines[i]) &&
        !/^%%CODEBLOCK_\d+%%$/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        var paraText = paraLines.join(' ');
        html.push('<p>' + processInline(escapeHtml(paraText)) + '</p>');
      }
    }

    return html.join('\n');
  }

  /**
   * Render a markdown table from an array of lines.
   */
  function renderTable(lines) {
    if (lines.length < 2) return '';

    function parseCells(line) {
      return line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(function(cell) { return cell.trim(); });
    }

    var headers = parseCells(lines[0]);

    // Check if second line is separator (---|----|---)
    var hasSeparator = /^[\s|:-]+$/.test(lines[1]);
    var startRow = hasSeparator ? 2 : 1;

    var out = '<table><thead><tr>';
    for (var h = 0; h < headers.length; h++) {
      out += '<th>' + processInline(escapeHtml(headers[h])) + '</th>';
    }
    out += '</tr></thead><tbody>';

    for (var r = startRow; r < lines.length; r++) {
      var cells = parseCells(lines[r]);
      // Skip separator rows
      if (/^[\s|:-]+$/.test(lines[r])) continue;
      out += '<tr>';
      for (var c = 0; c < cells.length; c++) {
        out += '<td>' + processInline(escapeHtml(cells[c])) + '</td>';
      }
      out += '</tr>';
    }

    out += '</tbody></table>';
    return out;
  }

  // Expose globally
  window.renderMarkdown = renderMarkdown;
})();
