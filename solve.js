// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Same answers as the reference, byte for byte; faster by avoiding re-work:
//  - front matter parsed by index search, body taken as a slice (no whole-text split)
//  - Markdown lexed by first-character dispatch, lines located by offsets
//  - inline rendering batched: plain runs escaped in one call, specials handled singly
//  - slugify with a per-case cache and a single-pass ASCII fast path
//  - templates rendered into a parts array (one join per render), same node semantics
// All semantics mirror vendor/makefun-site/ (the reference); where README and code
// differ the code rules, and this file follows the code.

export const REPORT_FILE = 'build-report.txt';
export const RESERVED = Object.freeze(['posts', 'tags', 'page']);

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export const SLUG_MAX = 64;

/** Per-case slug cache: cleared at the start of every run(). */
let slugCache = new Map();

function slugifyUnicode(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

export function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let out = '';
  let gap = false;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      ascii = false;
      break;
    }
    const ch = text[i];
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  if (!ascii) out = slugifyUnicode(text);
  else {
    out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
    if (out === '') out = 'untitled';
  }
  slugCache.set(text, out);
  return out;
}

export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ---------------------------------------------------------------- front matter

const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

export function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  // The close line: the first line exactly '---' after the opening one.
  let closeAt = -1;
  let q = 3;
  while (true) {
    q = text.indexOf('\n---', q);
    if (q === -1) break;
    const after = q + 4;
    if (after === text.length || text[after] === '\n') {
      closeAt = q + 1;
      break;
    }
    q += 1;
  }
  if (closeAt === -1) return { error: 'the front matter is not closed' };
  const fmText = text.slice(4, closeAt - 1);
  const fmLines = fmText === '' ? [] : fmText.split('\n');
  const data = {};
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k];
    if (/^[ \t]*$/.test(line) || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${k + 2} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const end = closeAt + 3;
  const body = end === text.length ? '' : text.slice(end + 1);
  return { data, body };
}

// ---------------------------------------------------------------- markdown

const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

function isBlankLine(line) {
  if (line === '') return true;
  const c0 = line.charCodeAt(0);
  if (c0 !== 32 && c0 !== 9) return false;
  return /^[ \t]+$/.test(line);
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  if (line === '') return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return /^[ \t]+$/.test(line);
  if (c0 === 96) return FENCE_OPEN.test(line);
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return HR.test(line);
  return false;
}

const trimLine = (line) => {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
};

export function lex(src) {
  const starts = [0];
  for (let p = src.indexOf('\n'); p !== -1; p = src.indexOf('\n', p + 1)) starts.push(p + 1);
  const L = starts.length;
  const get = (k) => {
    const s = starts[k];
    const e = k + 1 < L ? starts[k + 1] - 1 : src.length;
    return src.slice(s, e);
  };
  const tokens = [];
  let i = 0;
  while (i < L) {
    const line = get(i);
    if (isBlankLine(line)) {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 96) {
      const fence = FENCE_OPEN.exec(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < L && !FENCE_CLOSE.test(get(i))) body.push(get(i++));
        i++;
        tokens.push({ type: 'code', lang: fence[1], lines: body });
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        tokens.push({ type: 'heading', depth: heading.depth, text: heading.text });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (HR.test(line)) {
        tokens.push({ type: 'hr' });
        i++;
        continue;
      }
    }
    if (c0 === 62) {
      const body = [];
      while (i < L) {
        const l = get(i);
        if (l.charCodeAt(0) !== 62) break;
        body.push(l.replace(/^> ?/, ''));
        i++;
      }
      tokens.push({ type: 'blockquote', lines: body.map(trimLine).filter((l) => l !== '') });
      continue;
    }
    const bullet = c0 === 45 || c0 === 42 ? BULLET.exec(line) : null;
    const ordered = bullet === null && c0 >= 48 && c0 <= 57 ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? ORDERED : BULLET;
      const items = [];
      while (i < L) {
        const cur = get(i);
        const m = marker.exec(cur);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m[2] : m[1])]);
          i++;
        } else if (CONTINUED.test(cur)) {
          items[items.length - 1].push(trimLine(cur));
          i++;
        } else break;
      }
      tokens.push({ type: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: items.map((parts) => parts.join('\n')) });
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < L && !endsParagraph(get(i))) body.push(trimLine(get(i++)));
    tokens.push({ type: 'paragraph', text: body.join('\n') });
  }
  return tokens;
}

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** The inline specials and the escapable characters, in one scan: text between two matches holds neither, so it is appended verbatim. Built from char codes so no backslash literal is needed: the class is \ ` * [ & < > " '. */
const INLINE_RE = new RegExp(`[${String.fromCharCode(92, 92, 96, 42, 91, 38, 60, 62, 34, 39)}]`, 'g');
/** The escapable characters alone, for code-span content. */
const ESC_RE = /[&<>"']/g;

/** `s[a..b)` escaped, without building the slice first. */
function escapeRange(s, a, b) {
  let out = '';
  let i = a;
  while (i < b) {
    ESC_RE.lastIndex = i;
    const m = ESC_RE.exec(s);
    const j = m === null || m.index >= b ? b : m.index;
    if (j > i) out += s.slice(i, j);
    if (j >= b) break;
    out += ESCAPES[s[j]];
    i = j + 1;
  }
  return out;
}

export function inline(s, env) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    INLINE_RE.lastIndex = i;
    const m = INLINE_RE.exec(s);
    const j = m === null ? s.length : m.index;
    if (j > i) out += s.slice(i, j);
    if (j >= s.length) break;
    i = j;
    const c = s[i];
    if (c === '&') {
      out += '&amp;';
      i++;
      continue;
    }
    if (c === '<') {
      out += '&lt;';
      i++;
      continue;
    }
    if (c === '>') {
      out += '&gt;';
      i++;
      continue;
    }
    if (c === '"') {
      out += '&quot;';
      i++;
      continue;
    }
    if (c === "'") {
      out += '&#39;';
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', i + 1);
      if (k > i + 1) {
        out += `<code>${escapeRange(s, i + 1, k)}</code>`;
        i = k + 1;
      } else {
        out += '`';
        i++;
      }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const k = findUnescaped(s, '**', i + 2);
        if (k > i + 2) {
          out += `<strong>${inline(s.slice(i + 2, k), env)}</strong>`;
          i = k + 2;
        } else {
          out += '**';
          i += 2;
        }
        continue;
      }
      const k = findSingleStar(s, i + 1);
      if (k > i + 1) {
        out += `<em>${inline(s.slice(i + 1, k), env)}</em>`;
        i = k + 1;
      } else {
        out += '*';
        i++;
      }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m2 = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m2 === -1 ? '' : s.slice(k + 2, m2);
      if (target !== '' && !/\s/.test(target)) {
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s.slice(i + 1, k), env)}</a>`;
        i = m2 + 1;
        continue;
      }
      out += '[';
      i++;
      continue;
    }
    // A backslash before a character it does not escape: the backslash itself.
    out += '\\';
    i++;
  }
  return out;
}

export function renderMarkdown(src, env) {
  const ids = new Set();
  let html = '';
  const toc = [];
  let excerpt = null;
  for (const t of lex(src)) {
    switch (t.type) {
      case 'heading': {
        const id = uniqueSlug(slugify(t.text), ids);
        const h = inline(t.text, env);
        html += `<h${t.depth} id="${id}">${h}</h${t.depth}>\n`;
        if (t.depth === 2 || t.depth === 3) toc.push({ level: t.depth, id, html: h });
        break;
      }
      case 'code': {
        const cls = t.lang === '' ? '' : ` class="language-${escapeHtml(t.lang)}"`;
        const body = t.lines.length === 0 ? '' : `${escapeHtml(t.lines.join('\n'))}\n`;
        html += `<pre><code${cls}>${body}</code></pre>\n`;
        break;
      }
      case 'hr':
        html += '<hr>\n';
        break;
      case 'blockquote':
        html += t.lines.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(t.lines.join('\n'), env)}</p>\n</blockquote>\n`;
        break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul';
        const open = t.ordered && t.start !== 1 ? `<ol start="${t.start}">` : `<${tag}>`;
        html += `${open}\n`;
        for (const item of t.items) html += `<li>${inline(item, env)}</li>\n`;
        html += `</${tag}>\n`;
        break;
      }
      case 'paragraph': {
        const h = inline(t.text, env);
        if (excerpt === null) excerpt = h;
        html += `<p>${h}</p>\n`;
        break;
      }
    }
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

export const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

export class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

export function renderNodes(nodes, scope, ctx, depth, parts) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        parts.push(n.text);
        break;
      case 'var':
        parts.push(ctx.escape(textOf(lookup(scope, n.path))));
        break;
      case 'raw':
        parts.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, parts);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        xs.forEach((x, k) => {
          const vars = { [n.name]: x, loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
          renderNodes(n.body, { vars, parent: scope }, ctx, depth, parts);
        });
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, parts);
        break;
      }
    }
  }
}

/**
 * Compile every parsed template to a function (S, D, O): S the scope chain, D the
 * include depth, O the parts array it appends to. Same node semantics as
 * renderNodes, with the dispatch compiled away. Returns a null-prototype object
 * of name -> function, or null when compilation is unavailable (the caller then
 * uses renderNodes). Paths are shared through one table P, so no array is
 * allocated per lookup.
 */
function compileTemplates(templates, esc) {
  const paths = [];
  const pathIndex = new Map();
  const pIdx = (path) => {
    const key = path.join('\x00');
    let i = pathIndex.get(key);
    if (i === undefined) {
      i = paths.length;
      paths.push(path);
      pathIndex.set(key, i);
    }
    return i;
  };
  let uid = 0;
  const genNodes = (nodes, scopeVar) => {
    let src = '';
    for (const n of nodes) {
      switch (n.kind) {
        case 'text':
          src += `O.push(${JSON.stringify(n.text)});`;
          break;
        case 'var':
          src += `O.push(ESC(TX(LK(${scopeVar},P[${pIdx(n.path)}]))));`;
          break;
        case 'raw':
          src += `O.push(TX(LK(${scopeVar},P[${pIdx(n.path)}])));`;
          break;
        case 'if': {
          const pi = pIdx(n.path);
          src += `if(TR(LK(${scopeVar},P[${pi}]))!==${n.not}){`;
          src += genNodes(n.then, scopeVar);
          src += '}';
          if (n.else !== null) {
            src += 'else{';
            src += genNodes(n.else, scopeVar);
            src += '}';
          }
          break;
        }
        case 'for': {
          const pi = pIdx(n.path);
          const a = uid++;
          const b = uid++;
          const c = uid++;
          const d = uid++;
          const sv = `_s${c}`;
          const lv = `_l${d}`;
          // One scope and one loop object per render of this for, mutated per
          // element: rendering is synchronous and neither object outlives its
          // iteration, so reuse is exact. The element is bound before `loop`,
          // as the interpreter's literal does, so a loop variable named `loop`
          // still loses to the loop object.
          src += `{const _x${a}=LK(${scopeVar},P[${pi}]);if(Array.isArray(_x${a})){const ${sv}={vars:{},parent:${scopeVar}};const ${lv}={index:0,first:false,last:false,length:_x${a}.length};for(let _k${b}=0;_k${b}<_x${a}.length;_k${b}++){${sv}.vars[${JSON.stringify(n.name)}]=_x${a}[_k${b}];${sv}.vars.loop=${lv};${lv}.index=_k${b}+1;${lv}.first=_k${b}===0;${lv}.last=_k${b}===_x${a}.length-1;`;
          src += genNodes(n.body, sv);
          src += '}}}';
          break;
        }
        case 'include': {
          src += `INC(${scopeVar},D,O,${JSON.stringify(n.name)});`;
          break;
        }
      }
    }
    return src;
  };
  let src = '';
  for (const [name, nodes] of templates) src += `TPL[${JSON.stringify(name)}]=function(S,D,O){${genNodes(nodes, 'S')}};`;
  // Free-variable analysis + include caching (INC). A template's output is a
  // pure function of its include depth and the values of its free names (names
  // it reads that are not bound by one of its own fors, transitively through
  // its includes), so an include can be memoised on (name, depth, free values).
  // The `loop` object is mutated per iteration, so any template that reads it
  // freely is never cached. Include cycles make the analysis unsound, so any
  // cycle disables caching for the whole case.
  const fns = Object.create(null);
  const INC_NONE = {};
  let cacheable = true;
  const incEdges = new Map();
  const collectIncludes = (nodes, out) => {
    for (const n of nodes) {
      if (n.kind === 'include') out.add(n.name);
      else if (n.kind === 'if') {
        collectIncludes(n.then, out);
        if (n.else !== null) collectIncludes(n.else, out);
      } else if (n.kind === 'for') collectIncludes(n.body, out);
    }
  };
  for (const [name, nodes] of templates) {
    const s = new Set();
    collectIncludes(nodes, s);
    incEdges.set(name, [...s].filter((x) => templates.has(x)));
  }
  const color = new Map();
  const dfs = (name) => {
    color.set(name, 1);
    for (const m of incEdges.get(name) || []) {
      const c = color.get(m) || 0;
      if (c === 1) {
        cacheable = false;
        return;
      }
      if (c === 0) dfs(m);
    }
    color.set(name, 2);
  };
  for (const name of templates.keys()) if ((color.get(name) || 0) === 0) dfs(name);
  const info = new Map();
  if (cacheable) {
    const freeMemo = new Map();
    const freeOf = (name, bound) => {
      const key = `${name}\x00${[...bound].sort().join('\x00')}`;
      let out = freeMemo.get(key);
      if (out !== undefined) return out;
      out = new Set();
      freeMemo.set(key, out);
      const nodes = templates.get(name);
      if (nodes === undefined) return out;
      const walk = (ns, b) => {
        for (const n of ns) {
          switch (n.kind) {
            case 'var':
            case 'raw':
            case 'if': {
              if (!b.has(n.path[0])) out.add(n.path[0]);
              if (n.kind === 'if') {
                walk(n.then, b);
                if (n.else !== null) walk(n.else, b);
              }
              break;
            }
            case 'for': {
              if (!b.has(n.path[0])) out.add(n.path[0]);
              const b2 = new Set(b);
              b2.add(n.name);
              b2.add('loop');
              walk(n.body, b2);
              break;
            }
            case 'include': {
              const sub = freeOf(n.name, b);
              for (const f of sub) out.add(f);
              break;
            }
          }
        }
      };
      walk(nodes, bound);
      return out;
    };
    for (const name of templates.keys()) {
      const f = freeOf(name, new Set());
      if (!f.has('loop')) info.set(name, [...f]);
    }
  }
  const incCache = new Map();
  const INC = (S, D, O, name) => {
    if (D >= 8) return;
    const fn = fns[name];
    if (fn === undefined) return;
    if (!cacheable) {
      fn(S, D + 1, O);
      return;
    }
    const free = info.get(name);
    if (free === undefined) {
      fn(S, D + 1, O);
      return;
    }
    let top = incCache.get(name);
    if (top === undefined) {
      top = new Map();
      incCache.set(name, top);
    }
    let level = top.get(D);
    if (level === undefined) {
      level = new Map();
      top.set(D, level);
    }
    if (free.length === 0) {
      const hit = level.get(INC_NONE);
      if (hit !== undefined) {
        O.push(hit);
        return;
      }
      const parts = [];
      fn(S, D + 1, parts);
      const out = parts.join('');
      level.set(INC_NONE, out);
      O.push(out);
      return;
    }
    let node = level;
    for (let i = 0; i < free.length - 1; i++) {
      const v = lookup(S, [free[i]]);
      let next = node.get(v);
      if (next === undefined) {
        next = new Map();
        node.set(v, next);
      }
      node = next;
    }
    const v = lookup(S, [free[free.length - 1]]);
    const hit = node.get(v);
    if (hit !== undefined) {
      O.push(hit);
      return;
    }
    const parts = [];
    fn(S, D + 1, parts);
    const out = parts.join('');
    node.set(v, out);
    O.push(out);
  };
  try {
    const factory = new Function('ESC', 'TX', 'TR', 'LK', 'P', 'TPL', 'INC', src);
    factory(esc, textOf, truthy, lookup, paths, fns, INC);
    return fns;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the build

function isSpaceCode(c) {
  return c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isSpaceCode(text.charCodeAt(i))) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function readSources(b) {
  const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }
}

function frontMatter(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

function permalinks(b) {
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
}

function markdown(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const dirParts = dir === '' ? [] : dir.split('/');
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        let path = null;
        if (rel !== '') {
          const parts = dirParts.slice();
          let ok = true;
          for (const seg of rel.split('/')) {
            if (seg === '' || seg === '.') continue;
            if (seg === '..') {
              if (parts.length === 0) {
                ok = false;
                break;
              }
              parts.pop();
            } else parts.push(seg);
          }
          path = ok ? parts.join('/') : null;
        }
        if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
        b.broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }
}

function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });
}

function tags(b) {
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    return (s.data.tags ?? []).filter((name) => !seen.has(slugify(name)) && seen.add(slugify(name)));
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

const tagOf = (b, t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) });

function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

function pageOf(s, cachedCard) {
  return {
    ...(cachedCard ?? cardOf(s)),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

function layouts(b) {
  b.cards = new Map(b.posts.map((p) => [p, cardOf(p)]));
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
  const ctx = { templates: b.templates, escape: b.escCached };
  const compiled = b.compiled;
  // The root scope in two levels: the call's own vars over the build's shared
  // site/tags/recent, instead of spreading the three into every render's object.
  const baseScope = { vars: { site, tags: allTags, recent }, parent: null };
  const render = (name, vars) => {
    if (compiled) {
      const fn = compiled[name];
      if (fn === undefined) return null;
      const parts = [];
      fn({ vars, parent: baseScope }, 0, parts);
      return parts.join('');
    }
    const nodes = b.templates.get(name);
    if (nodes === undefined) return null;
    const parts = [];
    renderNodes(nodes, { vars, parent: baseScope }, ctx, 0, parts);
    return parts.join('');
  };
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s, s.post ? b.cards.get(s) : undefined) });
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(b, t) });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
}

function report(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pages = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

const PIPELINE = Object.freeze([readSources, frontMatter, permalinks, markdown, collections, tags, layouts, report]);

export function build(input) {
  slugCache = new Map();
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  // Template values (titles, urls, dates) are escaped over and over as the same
  // strings recur across pages, cards and lists: escape each once per case.
  const escCache = new Map();
  const escCached = (s) => {
    const hit = escCache.get(s);
    if (hit !== undefined) return hit;
    const e = escapeHtml(s);
    escCache.set(s, e);
    return e;
  };
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    compiled: compileTemplates(templates, escCached),
    escCached,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };
  for (const plugin of PIPELINE) plugin(b);
  return b.output;
}

export function run(input) {
  return build(input);
}
