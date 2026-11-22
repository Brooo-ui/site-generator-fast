// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
//
// Returns exactly what makefun-site's build() returns for every input, but
// without its costs: no per-character regex escaping, no token objects, no
// string-concat rendering, no full-text splits. Every rule below is the
// reference's rule (vendor/makefun-site/README.md + lib/*.js); where the
// README and the code differ, this follows the code, exactly as the
// reference does.

export function run(input) {
  return build(input);
}

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HAS_ESC = /[&<>"']/;
const ESC_ALL = /[&<>"']/g;

/** `text` with & < > " and ' escaped. Fast path: no special char, no work. */
function escapeHtml(text) {
  return HAS_ESC.test(text) ? text.replace(ESC_ALL, (c) => ESCAPES[c]) : text;
}

export const SLUG_MAX = 64;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone. */
function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * The slug of `text`, exactly as the reference's slugify: NFKD, combining
 * marks dropped, A-Z lowered, every run of characters other than a-z and 0-9
 * one "-", none at either end, at most 64 characters (a "-" left at the cut
 * dropped), "untitled" when nothing is left. Pure-ASCII input is already in
 * NFKD form with no combining marks, so the normalise + mark-strip pass is
 * skipped for it; any non-ASCII character falls back to the reference path.
 */
function slugify(text) {
  let out = '';
  let gap = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) return slugifySlow(text);
    const c = text[i];
    let keep = null;
    if (c >= 'A' && c <= 'Z') keep = c.toLowerCase();
    else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) keep = c;
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

function slugifySlow(text) {
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

/** `slug` made unique against `taken` (and added to it). */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
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

/** One key's value, or why it is refused. */
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

/**
 * A source's front matter and body: { data, body }, or { error } with the
 * first reason it is refused. `text` has "\n" line ends. Unlike the
 * reference, this never splits the whole text: it walks the front-matter
 * lines only, and the body is one slice.
 */
function parseFrontMatter(text) {
  const firstNl = text.indexOf('\n');
  const first = firstNl === -1 ? text : text.slice(0, firstNl);
  if (first !== '---') return { error: 'no front matter' };
  // Collect the front-matter lines while looking for the closing '---'
  // line. fm[k] is the file's line k+2 (1-based): the '---' opener is line 1.
  const fm = [];
  let pos = firstNl === -1 ? text.length : firstNl + 1;
  let bodyStart = -1;
  for (;;) {
    const eol = text.indexOf('\n', pos);
    const line = eol === -1 ? text.slice(pos) : text.slice(pos, eol);
    if (line === '---') {
      bodyStart = eol === -1 ? text.length : eol + 1;
      break;
    }
    fm.push(line);
    if (eol === -1) return { error: 'the front matter is not closed' };
    pos = eol + 1;
  }
  const data = {};
  for (let k = 0; k < fm.length; k++) {
    const i = k + 1;
    const line = fm[k];
    if (/^[ \t]*$/.test(line) || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${i + 1} is not "key: value"` };
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
  return { data, body: text.slice(bodyStart) };
}

// ---------------------------------------------------------------- markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** Count the words (runs of non-whitespace) of the whole `src`. */
function countWordsWhole(src) {
  let words = 0;
  let inW = false;
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    let ws;
    if (code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13) ws = true;
    else if (code < 128) ws = false;
    else ws = /\s/.test(src[i]);
    if (ws) inW = false;
    else if (!inW) {
      inW = true;
      words++;
    }
  }
  return words;
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
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

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
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

const INLINE_RE = /[\\`*[&<>"']/g;

/**
 * `s` rendered inline; `env.link(target)` is a link's href. One regex pass
 * finds constructs AND the five HTML specials, so plain text is scanned once
 * instead of once for constructs and once for escaping: a plain run holds no
 * special by construction and is pushed raw. Pieces go into one array and are
 * joined once (string += on many pieces flattens its rope again and again);
 * a string with no construct or special returns itself after the single scan.
 * The constructs (escapes, code, strong, emphasis, links) match the reference
 * exactly, including every no-closer fallback: a construct that fails stays in
 * the plain run.
 */
function inline(s, env) {
  const out = [];
  const n = s.length;
  let i = 0;
  let start = 0;
  for (;;) {
    // Next construct or HTML special at or after i.
    INLINE_RE.lastIndex = i;
    const rm = INLINE_RE.exec(s);
    if (rm === null) break;
    const j = rm.index;
    const c = s[j];
    if (c === '&') {
      if (j > start) out.push(s.slice(start, j));
      out.push('&amp;');
      i = j + 1;
      start = i;
      continue;
    }
    if (c === '<') {
      if (j > start) out.push(s.slice(start, j));
      out.push('&lt;');
      i = j + 1;
      start = i;
      continue;
    }
    if (c === '>') {
      if (j > start) out.push(s.slice(start, j));
      out.push('&gt;');
      i = j + 1;
      start = i;
      continue;
    }
    if (c === '"') {
      if (j > start) out.push(s.slice(start, j));
      out.push('&quot;');
      i = j + 1;
      start = i;
      continue;
    }
    if (c === "'") {
      if (j > start) out.push(s.slice(start, j));
      out.push('&#39;');
      i = j + 1;
      start = i;
      continue;
    }
    if (c === '\\' && j + 1 < n && ESCAPABLE.has(s[j + 1])) {
      if (j > start) out.push(s.slice(start, j));
      out.push(s[j + 1]);
      i = j + 2;
      start = i;
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        if (j > start) out.push(s.slice(start, j));
        out.push('<code>', escapeHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
        start = i;
      } else i = j + 1;
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          if (j > start) out.push(s.slice(start, j));
          out.push('<strong>', inline(s.slice(j + 2, k), env), '</strong>');
          i = k + 2;
          start = i;
        } else i = j + 2;
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        if (j > start) out.push(s.slice(start, j));
        out.push('<em>', inline(s.slice(j + 1, k), env), '</em>');
        i = k + 1;
        start = i;
      } else i = j + 1;
      continue;
    }
    // c === '[' (any other character at j, e.g. a backslash before a
    // non-escapable character, stays in the plain run).
    if (c !== '[') {
      i = j + 1;
      continue;
    }
    const k = findUnescaped(s, ']', j + 1);
    const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
    const target = m === -1 ? '' : s.slice(k + 2, m);
    if (target !== '' && !/\s/.test(target)) {
      if (j > start) out.push(s.slice(start, j));
      out.push('<a href="', escapeHtml(env.link(target)), '">', inline(s.slice(j + 1, k), env), '</a>');
      i = m + 1;
      start = i;
    } else i = j + 1;
  }
  if (out.length === 0) return s;
  if (n > start) out.push(s.slice(start, n));
  return out.join('');
}

const isLangChar = (c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-';
const isSpaceTab = (c) => c === ' ' || c === '\t';

/** A line of only spaces/tabs. */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) if (!isSpaceTab(line[i])) return false;
  return true;
}

/** `line` trimmed of spaces and tabs at both ends (the same string back when nothing trims). */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && isSpaceTab(line[a])) a++;
  while (b > a && isSpaceTab(line[b - 1])) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/**
 * A fence-open line's language, or null: '```' + [A-Za-z0-9_+-]* + spaces/tabs.
 * With `allowLang` false (a fence close) the language must be empty.
 */
function fenceLang(line, allowLang) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3;
  let langEnd = 3;
  if (allowLang) {
    while (i < line.length && isLangChar(line[i])) i++;
    langEnd = i;
  }
  while (i < line.length && isSpaceTab(line[i])) i++;
  return i === line.length ? line.slice(3, langEnd) : null;
}

/** A heading line's { depth, text }, or null. */
function headingOf(line) {
  let d = 0;
  while (d < 6 && line[d] === '#') d++;
  if (d === 0) return null;
  if (line[d] === '#') return null; // 7 or more '#'
  let i = d;
  while (isSpaceTab(line[i])) i++;
  if (i === d) return null; // no space or tab after the hashes
  let end = line.length;
  while (end > i && isSpaceTab(line[end - 1])) end--;
  const text = line.slice(i, end);
  if (text === '') return null;
  return { depth: d, text };
}

/** Whether `line` is a thematic break: '---' or '***' + spaces/tabs only. */
function isHr(line) {
  const m = line === '---' || line === '***';
  if (m) return true;
  if (!line.startsWith('---') && !line.startsWith('***')) return false;
  let i = 3;
  while (i < line.length && isSpaceTab(line[i])) i++;
  return i === line.length;
}

/** Whether `line` ends a paragraph: blank, fence, heading or thematic break. */
function endsParagraph(line) {
  return isBlank(line) || fenceLang(line, true) !== null || headingOf(line) !== null || isHr(line);
}

/**
 * `src` rendered in one pass over its lines: its HTML (each block on its own
 * lines, a "\n" after the last), its table of contents and its excerpt.
 * `st.words` accumulates the body's word count. No token objects, no
 * intermediate arrays of lines, no intermediate block strings: pieces are
 * pushed into one array and joined once. Lines are sliced on demand.
 */
function renderMarkdown(src, env, slugMemo) {
  const ids = new Set();
  const parts = [];
  const toc = [];
  let excerpt = null;
  // The lines partition the body and '\n' is whitespace, so the body's word
  // count is the whole body's count: one pass, not one call per line.
  const st = { words: countWordsWhole(src) };
  const n = src.length;
  let pos = 0;
  // Next line (without its '\n'), or null at the end.
  const nextLine = () => {
    if (pos >= n) return null;
    const eol = src.indexOf('\n', pos);
    const line = eol === -1 ? src.slice(pos) : src.slice(pos, eol);
    pos = eol === -1 ? n : eol + 1;
    return line;
  };

  let line = nextLine();
  while (line !== null) {
    if (isBlank(line)) {
      line = nextLine();
      continue;
    }
    const lang = fenceLang(line, true);
    if (lang !== null) {
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      parts.push('<pre><code', cls, '>');
      for (;;) {
        const l = nextLine();
        if (l === null) break;
        if (fenceLang(l, false) !== null) break;
        parts.push(escapeHtml(l), '\n');
      }
      parts.push('</code></pre>', '\n');
      line = nextLine();
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugifyMemo(heading.text, slugMemo), ids);
      const html = inline(heading.text, env);
      parts.push('<h', heading.depth, ' id="', id, '">', html, '</h', heading.depth, '>', '\n');
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      line = nextLine();
      continue;
    }
    if (isHr(line)) {
      parts.push('<hr>', '\n');
      line = nextLine();
      continue;
    }
    if (line[0] === '>') {
      const qlines = [];
      while (line !== null && line[0] === '>') {
        qlines.push(trimLine(line[0] === '>' && line[1] === ' ' ? line.slice(2) : line.slice(1)));
        line = nextLine();
      }
      const kept = qlines.filter((l) => l !== '');
      if (kept.length === 0) parts.push('<blockquote>\n</blockquote>', '\n');
      else parts.push('<blockquote>\n<p>', inline(kept.join('\n'), env), '</p>\n</blockquote>', '\n');
      continue;
    }
    const bullet = line.startsWith('- ') || line.startsWith('* ');
    let ordered = null;
    if (!bullet) {
      // /^(\d{1,9})\. (.*)$/
      let d = 0;
      while (d < 9 && line[d] >= '0' && line[d] <= '9') d++;
      if (d > 0 && line[d] === '.' && line[d + 1] === ' ') ordered = { start: Number(line.slice(0, d)), rest: line.slice(d + 2) };
    }
    if (bullet || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [];
      while (line !== null) {
        let m = null;
        if (isOrdered) {
          let d = 0;
          while (d < 9 && line[d] >= '0' && line[d] <= '9') d++;
          if (d > 0 && line[d] === '.' && line[d + 1] === ' ') m = line.slice(d + 2);
        } else if (line.startsWith('- ') || line.startsWith('* ')) m = line.slice(2);
        if (m !== null) {
          items.push([trimLine(m)]);
          line = nextLine();
        } else if (/^ {2,}\S/.test(line)) {
          items[items.length - 1].push(trimLine(line));
          line = nextLine();
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      parts.push(isOrdered && ordered.start !== 1 ? `<ol start="${ordered.start}">` : `<${tag}>`, '\n');
      for (const item of items) parts.push('<li>', inline(item.join('\n'), env), '</li>\n');
      parts.push('</', tag, '>', '\n');
      continue;
    }
    // Paragraph: this line and the following ones until a paragraph-ender.
    // Each following line is consumed once; an ender is held as the next
    // line for the outer loop instead of being peeked (and re-sliced).
    const plines = [trimLine(line)];
    for (;;) {
      const l2 = nextLine();
      if (l2 === null) {
        line = null;
        break;
      }
      if (endsParagraph(l2)) {
        line = l2;
        break;
      }
      plines.push(trimLine(l2));
    }
    const html = inline(plines.join('\n'), env);
    if (excerpt === null) excerpt = html;
    parts.push('<p>', html, '</p>', '\n');
    continue;
  }
  return { html: parts.join(''), toc, excerpt: excerpt ?? '', words: st.words };
}

/** Memoised slugify (per build; tag names and headings repeat). */
function slugifyMemo(text, memo) {
  let s = memo.get(text);
  if (s === undefined) {
    s = slugify(text);
    memo.set(text, s);
  }
  return s;
}

// ---------------------------------------------------------------- templates

/** The deepest an include nests: one past it renders nothing. */
const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
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

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
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

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
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

/** The value at `path` in a scope stack (outermost first, innermost last). */
function lk(scopes, path) {
  for (let s = scopes.length - 1; s >= 0; s--) {
    const vars = scopes[s];
    if (Object.hasOwn(vars, path[0])) {
      let v = vars[path[0]];
      for (let k = 1; k < path.length; k++) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
        v = v[path[k]];
      }
      return v;
    }
  }
  return undefined;
}

/**
 * Compile a parsed template's nodes to a function
 * (lk, textOf, escapeHtml, truthy, TPL, scopes, depth, out) => void, by
 * emitting straight-line pushes instead of walking the node tree per render.
 * TPL is the map of every template's compiled function, for includes.
 */
function compileNodes(nodes, uid) {
  let src = '';
  const emit = (ns) => {
    for (const nd of ns) {
      switch (nd.kind) {
        case 'text':
          src += `out.push(${JSON.stringify(nd.text)});`;
          break;
        case 'var':
          src += `out.push(escapeHtml(textOf(lk(scopes,${JSON.stringify(nd.path)}))));`;
          break;
        case 'raw':
          src += `out.push(textOf(lk(scopes,${JSON.stringify(nd.path)})));`;
          break;
        case 'if': {
          src += `if(truthy(lk(scopes,${JSON.stringify(nd.path)}))!==${nd.not}){`;
          emit(nd.then);
          src += '}';
          if (nd.else !== null) {
            src += 'else{';
            emit(nd.else);
            src += '}';
          }
          break;
        }
        case 'for': {
          const u = uid.next++;
          src += `var xs${u}=lk(scopes,${JSON.stringify(nd.path)});if(Array.isArray(xs${u})){for(var k${u}=0;k${u}<xs${u}.length;k${u}++){scopes.push({${JSON.stringify(nd.name)}:xs${u}[k${u}],loop:{index:k${u}+1,first:k${u}===0,last:k${u}===xs${u}.length-1,length:xs${u}.length}});`;
          emit(nd.body);
          src += 'scopes.pop();}}';
          break;
        }
        case 'include': {
          const u = uid.next++;
          src += `if(depth<${INCLUDE_DEPTH}){var t${u}=TPL.get(${JSON.stringify(nd.name)});if(t${u}!==undefined)t${u}(lk,textOf,escapeHtml,truthy,TPL,scopes,depth+1,out);}`;
          break;
        }
      }
    }
  };
  emit(nodes);
  return src;
}

/**
 * Compile every parsed template, or null if any one fails (the interpreter
 * then renders everything, as before). Parsed nodes and compiled functions
 * are cached by template name + source: the cases of one run share most
 * templates, so a template is parsed and compiled once, not once per case.
 * A compiled function closes over nothing but its own code (every value it
 * needs arrives as a parameter), so sharing it across cases is exact; the
 * per-template uid restarts at 0, which only renumbers its own locals.
 */
const tplParseCache = new Map();
const tplCompileCache = new Map();

function compileAll(templates, sources) {
  try {
    const out = new Map();
    for (const [name, nodes] of templates) {
      const key = `${name}\0${sources[name]}`;
      let fn = tplCompileCache.get(key);
      if (fn === undefined) {
        const uid = { next: 0 };
        const body = compileNodes(nodes, uid);
        fn = new Function('lk', 'textOf', 'escapeHtml', 'truthy', 'TPL', 'scopes', 'depth', 'out', body);
        tplCompileCache.set(key, fn);
      }
      out.set(name, fn);
    }
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- build

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * `nodes` rendered in `scope` ({ vars, parent }) into `out` (an array of
 * strings, joined by the caller). Same walk as the reference's renderNodes,
 * but pieces are pushed, never concatenated one by one. Kept as the fallback
 * for any template the compiler below cannot take.
 */
function renderNodes(nodes, scope, ctx, depth, out) {
  for (const nd of nodes) {
    switch (nd.kind) {
      case 'text':
        out.push(nd.text);
        break;
      case 'var':
        out.push(escapeHtml(textOf(lookup(scope, nd.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scope, nd.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, nd.path));
        const branch = v !== nd.not ? nd.then : nd.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, nd.path);
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          const vars = { [nd.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
          renderNodes(nd.body, { vars, parent: scope }, ctx, depth, out);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(nd.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, out);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- build

const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** One site's output tree: path -> text. */
function build(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    const source = input.templates[name];
    const key = `${name}\0${source}`;
    let e = tplParseCache.get(key);
    if (e === undefined) {
      try {
        e = { nodes: parseTemplate(name, source) };
      } catch (err) {
        if (!(err instanceof TemplateError)) throw err;
        e = { error: err.message };
      }
      tplParseCache.set(key, e);
    }
    if ('error' in e) {
      report.push(e.error);
      continue;
    }
    templates.set(name, e.nodes);
  }
  const slugMemo = new Map();
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    slugMemo,
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

  // 1. The sources, in code-unit order of their paths; a source that is
  // not .md is static.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    // Line ends made "\n"; files with no '\r' keep their string as-is.
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }

  // 2. Each source's front matter: a refused source is reported and dropped,
  // and so is a draft. Checks in order: parse, own directory, post date,
  // layout, draft.
  {
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

  // 3. Each page's output directory and url: its slug made unique in its
  // directory, in source order.
  {
    const taken = new Map();
    const takenIn = (dir) => {
      if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
      return taken.get(dir);
    };
    for (const s of b.sources) {
      const dir = s.post ? 'posts' : dirOf(s.path);
      const slug = uniqueSlug(s.data.slug ?? slugifyMemo(s.data.title, slugMemo), takenIn(dir));
      s.slug = slug;
      s.outDir = dir === '' ? slug : `${dir}/${slug}`;
      s.url = `${b.base}/${s.outDir}/`;
      b.bySource.set(s.path, s);
    }
  }

  // 4. Each body's Markdown, its links resolved to the pages and static
  // files they name.
  {
    const staticPaths = new Set(b.statics.map((f) => f.path));
    for (const s of b.sources) {
      const dir = dirOf(s.path);
      const env = {
        link: (target) => {
          if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
          const hash = target.indexOf('#');
          const rel = hash === -1 ? target : target.slice(0, hash);
          const frag = hash === -1 ? '' : target.slice(hash);
          const path = rel === '' ? null : resolvePath(dir, rel);
          if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
          if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
          b.broken.add(`broken-link ${s.path} -> ${target}`);
          return target;
        },
      };
      const md = renderMarkdown(s.body, env, slugMemo);
      s.html = md.html;
      s.toc = md.toc;
      s.excerpt = md.excerpt;
      s.words = md.words;
    }
  }

  // 5. The posts, newest first and then by slug; each post's newer and
  // older neighbours.
  {
    const posts = b.sources.filter((s) => s.post);
    posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
    b.posts = posts;
    posts.forEach((p, k) => {
      p.newer = k === 0 ? null : posts[k - 1];
      p.older = k === posts.length - 1 ? null : posts[k + 1];
    });
  }

  // 6. The tags: grouped by their slug, each named as first met in the
  // posts' order, ordered by count and then slug.
  {
    const bySlug = new Map();
    const ownTags = (s) => {
      const seen = new Set();
      return (s.data.tags ?? []).filter((name) => {
        const slug = slugifyMemo(name, slugMemo);
        if (seen.has(slug)) return false;
        seen.add(slug);
        return true;
      });
    };
    for (const p of b.posts) {
      p.tagRefs = [];
      for (const name of ownTags(p)) {
        const slug = slugifyMemo(name, slugMemo);
        if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
        const tag = bySlug.get(slug);
        tag.posts.push(p);
        p.tagRefs.push(tag);
      }
    }
    for (const s of b.sources) {
      if (!s.post) {
        s.tagRefs = ownTags(s).map((name) => {
          const slug = slugifyMemo(name, slugMemo);
          return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
        });
      }
    }
    b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  }

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const pageOf = (s) => ({
    // The card fields first, in cardOf's order (the output's key order is
    // the insertion order), then the page's own fields — built directly
    // instead of spreading a card object that is then discarded.
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    slug: s.slug,
    content: s.html,
    toc: s.toc,
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  // 7. Every page through its layout, the index pages and the tag pages
  // through theirs.
  {
    b.cards = new Map(b.posts.map((p) => [p, cardOf(p)]));
    const site = { title: b.input.site.title, base_url: b.base };
    const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
    const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
    const ctx = { templates: b.templates, escape: escapeHtml };
    const compiled = compileAll(b.templates, input.templates);
    const render = (name, vars) => {
      const topVars = { site, tags: allTags, recent, ...vars };
      if (compiled !== null) {
        const fn = compiled.get(name);
        if (fn !== undefined) {
          const out = [];
          fn(lk, textOf, escapeHtml, truthy, compiled, [topVars], 0, out);
          return out.join('');
        }
      }
      const nodes = b.templates.get(name);
      if (nodes === undefined) return null;
      const out = [];
      renderNodes(nodes, { vars: topVars, parent: null }, ctx, 0, out);
      return out.join('');
    };
    for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
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
      const html = render('tag', { tag: tagOf(t) });
      if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
    }
    const tagsHtml = render('tags', {});
    if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
    for (const f of b.statics) {
      if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
      else b.output[f.path] = f.content;
    }
  }

  // 8. The report: every refusal, draft, broken link and template that did
  // not parse, sorted, then the counts.
  {
    const lines = [...b.report, ...b.broken].sort(byCodeUnits);
    const pages = b.sources.filter((s) => !s.post).length;
    lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
    b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
  }

  return b.output;
}
