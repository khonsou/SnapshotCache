import { parse, serialize } from 'parse5';

const forbiddenTags = new Set(['base', 'link', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'portal', 'template']);
const urlAttributes = new Set(['src', 'srcset', 'href', 'action', 'formaction', 'poster', 'data', 'background', 'ping', 'manifest']);

// web/1 P1 profile: one HTML entry with inline CSS/classic JS; data through the host binding.
// This checks declared markup. CSP + the parent's frame-src remain essential for dynamic JS.
export function inspectHTML(html) {
  const errors = [];
  const doc = parse(html, { onParseError: error => errors.push(error.code) });
  if (errors.length) throw new Error('Invalid HTML: ' + errors[0]);
  const scripts = [];
  let head;
  function walk(node) {
    if (node.tagName) {
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || forbiddenTags.has(node.tagName)) throw new Error('Unsupported HTML element: ' + node.tagName);
      if (node.tagName === 'head') head = node;
      for (const attr of node.attrs || []) {
        if (attr.name.startsWith('on') || urlAttributes.has(attr.name) || attr.name === 'http-equiv' || attr.name === 'is' || attr.name === 'srcdoc') throw new Error('External or active HTML attribute: ' + attr.name);
        if (attr.name === 'style') inspectCSS(attr.value);
      }
      if (node.tagName === 'style') inspectCSS((node.childNodes || []).map(n => n.value || '').join(''));
      if (node.tagName === 'script') {
        const type = node.attrs.find(a => a.name === 'type')?.value;
        if (type && !['text/javascript', 'application/javascript'].includes(type)) throw new Error('Only classic inline scripts supported');
        scripts.push((node.childNodes || []).map(n => n.value || '').join(''));
      }
    }
    for (const child of node.childNodes || []) walk(child);
  }
  walk(doc);
  if (!head) throw new Error('HTML head missing');
  return { doc, head, scripts };
}

function inspectCSS(css) {
  // Reject escaped/comment-obfuscated URL syntax as well. No external style dependencies in P1.
  if (/\\|\/\*|@(?!media\b|supports\b|keyframes\b)|url\s*\(/i.test(css)) throw new Error('External or unsupported CSS dependency');
}

export function prependRuntime(inspected, csp, bootstrap, nonce = '') {
  const prefix = parse(`<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><script>${bootstrap}</script></head><body></body></html>`);
  const nodes = prefix.childNodes.find(n => n.tagName === 'html').childNodes.find(n => n.tagName === 'head').childNodes;
  for (const node of nodes) node.parentNode = inspected.head;
  inspected.head.childNodes.unshift(...nodes);
  const nonceScripts = node => {
    if (node.tagName === 'script') {
      node.attrs = node.attrs.filter(a => a.name !== 'nonce');
      if (nonce) node.attrs.push({ name: 'nonce', value: nonce });
    }
    for (const child of node.childNodes || []) nonceScripts(child);
  };
  nonceScripts(inspected.doc);
  return serialize(inspected.doc);
}
