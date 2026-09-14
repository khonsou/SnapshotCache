import DOMPurify from 'dompurify';
import { marked } from 'marked';

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const renderer = new marked.Renderer();

// Treat model-authored HTML as visible text. Markdown structure is rendered below,
// then sanitized again as a defense in depth boundary before it enters the chat DOM.
renderer.html = token => escapeHtml(token.text);
renderer.image = token => `<span class="markdown-image-alt">[图片：${escapeHtml(token.text || token.href || '未命名')}]</span>`;

const MARKDOWN_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'span',
];
const MARKDOWN_ATTRIBUTES = ['checked', 'class', 'disabled', 'href', 'start', 'title', 'type'];

export function renderAgentMarkdown(value) {
  const source = typeof value === 'string' ? value : '';
  const parsed = marked.parse(source, { breaks: true, gfm: true, renderer });
  const clean = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: MARKDOWN_TAGS,
    ALLOWED_ATTR: MARKDOWN_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style'],
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const link of template.content.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  for (const table of template.content.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table-wrap';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '可横向滚动的表格');
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  return template.innerHTML;
}
