#!/usr/bin/env node
// show: builds one self-contained HTML file from a content file, and reads the answers
// from a page that a person filled in.
//
//   node page.mjs build <content.html> [--out=<file>] [--css=<file>] [--no-fonts]
//   node page.mjs answers <saved.html>
//
// Each command prints one JSON object. On a failure it prints one sentence on stderr and exits
// with code 1. The script works on files only. Publishing is the job of the nsite-artifacts skill.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// The font files in assets/fonts. A published page can load nothing from another site, so the
// build writes each file into the page as a data: URL.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const FONTS = [
  ['IBM Plex Sans', 400, 'ibm-plex-sans'],
  ['IBM Plex Sans', 600, 'ibm-plex-sans'],
  ['IBM Plex Sans Condensed', 600, 'ibm-plex-sans-condensed'],
  ['IBM Plex Mono', 400, 'ibm-plex-mono'],
];

class Failure extends Error {}
const fail = message => { throw new Failure(message); };

function fontCss() {
  const rules = [];
  for (const [family, weight, file] of FONTS) {
    for (const [subset, range] of [['latin-ext', LATIN_EXT], ['latin', LATIN]]) {
      const data = readFileSync(join(ASSETS, 'fonts', `${file}-${subset}-${weight}-normal.woff2`)).toString('base64');
      rules.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;` +
        `src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range}}`);
    }
  }
  return rules.join('\n');
}

// ---- reading the markup ----
// The script reads its own page format with regular expressions, so it needs no HTML parser and
// no install step. The checks in build() keep the markup inside what these expressions can read.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? all;
  return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
});
const textOf = markup => decode(markup.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function attributes(tag) {
  const found = {};
  for (const m of tag.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    found[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return found;
}

// The questions of a page, in the order of the page.
function questions(html) {
  const found = [];
  for (const m of html.matchAll(/<fieldset\b([^>]*)>([\s\S]*?)<\/fieldset>/gi)) {
    const attrs = attributes(m[1]);
    if (!/(^|\s)ask(\s|$)/.test(attrs.class ?? '')) continue;
    const body = m[2];
    const options = [];
    let otherControls = 0;
    // An option is an <input> and the <b> label that follows it.
    for (const o of body.matchAll(/<input\b([^>]*)>\s*(?:<b\b[^>]*>([\s\S]*?)<\/b>)?/gi)) {
      const input = attributes(o[1]);
      if (input.type !== 'radio' && input.type !== 'checkbox') { otherControls++; continue; }
      options.push({
        type: input.type, name: input.name, value: input.value, checked: 'checked' in input,
        // The label without its tags, for example without "recommended".
        label: textOf((o[2] ?? '').replace(/<span\b[^>]*\bclass="[^"]*\btag\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')),
      });
    }
    const note = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/i.exec(body);
    found.push({
      id: attrs['data-q'],
      question: textOf(/<legend\b[^>]*>([\s\S]*?)<\/legend>/i.exec(body)?.[1] ?? ''),
      options,
      otherControls: otherControls + (body.match(/<(?:select|button)\b/gi) ?? []).length,
      textareas: (body.match(/<textarea\b/gi) ?? []).length,
      hasNote: !!note,
      notePlaceholder: note ? 'placeholder' in attributes(note[1]) : false,
      note: note ? decode(note[2]).trim() : '',
    });
  }
  return found;
}

// ---- syntax highlighting ----
// The build colors the code of each <pre><code class="language-xx"> block. It does this at build
// time and writes plain <span> tags, because the page saves its own markup: a script that colors
// the code in the browser would change that markup and could remove the mark of a comment.

const KEYWORDS = {
  js: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  cs: 'abstract as async await base bool break case catch class const continue default do else enum false finally for foreach get if in int interface internal is lock long namespace new null out override private protected public readonly record ref return sealed set static string struct switch this throw true try using var virtual void while',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
  sql: 'add alter and as by column create default delete distinct from group having index inner insert into join key left limit not null on or order outer primary references right select set table union update values where',
  sh: 'case cd do done echo elif else esac exit export fi for function if in local return then while',
  json: 'false null true',
  css: '',
  html: '',
};
const ALIAS = { javascript: 'js', mjs: 'js', ts: 'js', typescript: 'js', csharp: 'cs', python: 'py', bash: 'sh', shell: 'sh', xml: 'html' };
const BLOCK_COMMENT = new Set(['js', 'cs', 'css', 'sql']);
const LINE_COMMENT = { js: String.raw`\/\/`, cs: String.raw`\/\/`, sql: '--', py: String.raw`(?<![\w$&])#`, sh: String.raw`(?<![\w$&])#` };

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One expression finds the next comment, string, number or word. A comment or a string that
// starts first wins, so "//" inside a string is not a comment.
function tokens(lang) {
  if (lang === 'html') return new RegExp(String.raw`(?<c><!--[\s\S]*?-->)|(?<k><\/?[A-Za-z][\w-]*|\/?>)|(?<s>"[^"\n]*"|'[^'\n]*')`, 'g');
  const comments = [];
  if (BLOCK_COMMENT.has(lang)) comments.push(String.raw`\/\*[\s\S]*?\*\/`);
  if (LINE_COMMENT[lang]) comments.push(LINE_COMMENT[lang] + String.raw`[^\n]*`);
  const strings = [String.raw`"(?:\\.|[^"\\\n])*"`, String.raw`'(?:\\.|[^'\\\n])*'`];
  if (lang === 'js') strings.push('`(?:\\\\.|[^`\\\\])*`');
  return new RegExp((comments.length ? `(?<c>${comments.join('|')})|` : '') +
    `(?<s>${strings.join('|')})|` + String.raw`(?<n>\b\d+(?:\.\d+)?\b)|(?<w>[A-Za-z_$][\w$]*)`, 'g');
}

function highlight(code, lang) {
  const keywords = new Set(KEYWORDS[lang].split(' '));
  let out = '';
  let last = 0;
  for (const m of code.matchAll(tokens(lang))) {
    const text = m[0];
    const kind = m.groups.c !== undefined ? 'c' : m.groups.s !== undefined ? 's' : m.groups.n !== undefined ? 'n'
      : m.groups.k !== undefined || keywords.has(lang === 'sql' ? text.toLowerCase() : text) ? 'k' : '';
    out += escape(code.slice(last, m.index)) + (kind ? `<span class="tk-${kind}">${escape(text)}</span>` : escape(text));
    last = m.index + text.length;
  }
  return out + escape(code.slice(last));
}

function highlightAll(html, warnings) {
  return html.replace(/(<pre\b[^>]*>\s*<code\b[^>]*\bclass="[^"]*\blanguage-([\w-]+)[^"]*"[^>]*>)([\s\S]*?)(<\/code>)/gi, (all, open, name, body, close) => {
    const lang = ALIAS[name.toLowerCase()] ?? name.toLowerCase();
    if (!(lang in KEYWORDS)) { warnings.push(`The build has no colors for the language "${name}". The languages are: ${Object.keys(KEYWORDS).join(', ')}.`); return all; }
    // Markup inside the code means that the block has its colors already, or that it carries the
    // mark of a comment. Both must stay as they are.
    if (/<[a-z\/!]/i.test(body)) return all;
    return open + highlight(decode(body), lang) + close;
  });
}

// ---- build ----

function build(file, flags) {
  if (!file) fail('Give the content file: node page.mjs build <content.html> [--out=<file>] [--css=<file>].');
  let html = readFileSync(file, 'utf8');
  const warnings = [];

  if (!/<html\b[^>]*\blang=/i.test(html)) fail('The <html> tag needs a lang attribute, for example <html lang="en">.');
  if (!/<meta\b[^>]*\bcharset=/i.test(html)) fail('The <head> needs <meta charset="utf-8"> as its first tag.');
  if (!/<meta\b[^>]*\bname=["']?viewport/i.test(html)) fail('The <head> needs <meta name="viewport" content="width=device-width, initial-scale=1">.');
  if (!/<title\b[^>]*>\s*[^<\s]/i.test(html)) fail('The page needs a <title> with text. The title is the name of the page in the list of pages.');
  if (!/<\/body>/i.test(html)) fail('The file needs a </body> tag.');

  const asks = questions(html);
  const opened = (html.match(/<fieldset\b[^>]*\bclass="[^"]*\bask\b/gi) ?? []).length;
  if (opened !== asks.length) fail(`The file has ${opened} <fieldset class="ask"> tags, but only ${asks.length} are complete. Give each one a closing </fieldset>, and do not put one inside another.`);
  const ids = new Set();
  for (const ask of asks) {
    const where = `The question "${ask.id ?? ask.question}"`;
    if (!/^[a-z][a-z0-9-]*$/i.test(ask.id ?? '')) fail(`${where} needs data-q with a short id, for example data-q="storage". Use letters, digits and "-".`);
    if (ids.has(ask.id)) fail(`Two questions have data-q="${ask.id}". Give each question its own id.`);
    ids.add(ask.id);
    if (!ask.question) fail(`${where} needs a <legend> with the text of the question.`);
    // A mockup inside a question must not contain a real control: the page would save its state,
    // and the answer would be unclear.
    if (ask.otherControls) fail(`${where} contains an <input>, <select> or <button> that is not an option. Draw a control of a mockup with a <span>.`);
    if (ask.textareas > 1) fail(`${where} has ${ask.textareas} <textarea> tags. A question has one <textarea>.`);
    const values = new Set();
    for (const option of ask.options) {
      // The browser groups radio buttons by name. A different name would let a person select two answers.
      if (option.name !== ask.id) fail(`${where} has an option with name="${option.name ?? ''}". Each option of a question needs name="${ask.id}".`);
      if (!option.value) fail(`${where} has an option without a value attribute.`);
      if (values.has(option.value)) fail(`${where} has two options with value="${option.value}".`);
      values.add(option.value);
      if (!option.label) fail(`${where} has an option without a <b> label directly after its <input>.`);
    }
    if (!ask.options.length && !ask.hasNote) fail(`${where} has no option and no <textarea>, so a person cannot answer it.`);
    // CSS shows a text question as answered with :placeholder-shown, and that needs a placeholder attribute.
    if (!ask.options.length && !ask.notePlaceholder) fail(`${where} has only a <textarea>. Give that <textarea> a placeholder attribute, for example placeholder="Your answer".`);
    if (!ask.hasNote) warnings.push(`The question "${ask.id}" has no <textarea> for a note.`);
  }
  if (!asks.length) warnings.push('The page has no question. A person can read it and comment on it, but cannot answer in it.');

  // The settings of the nsite-clay runtime: save after each change, let each person with the edit
  // link change the form, and do not offer runtime upgrades inside the page.
  html = html.replace(/<html\b[^>]*>/i, tag => {
    for (const [name, value] of [['nc:autosave', ''], ['nc:edit-gate', 'always'], ['nc:runtime-owner', 'off']]) {
      if (!tag.includes(name)) tag = tag.slice(0, -1) + ` ${name}${value ? `="${value}"` : ''}>`;
    }
    return tag;
  });

  html = highlightAll(html, warnings);

  // The parts of the kit carry data-kit. A file that has them is a built page, for example a page
  // that a person answered and that `artifact read --as=html` returned. The build then replaces
  // these parts with the current ones and keeps all other markup, with the answers and comments.
  const kitStyle = /<style data-kit="show">[\s\S]*?<\/style>/;
  const extraStyle = /\n?<style data-kit="show-css">[\s\S]*?<\/style>/;
  const kitScript = /<script data-kit="show">[\s\S]*?<\/script>/;
  const css = (flags['no-fonts'] ? '' : fontCss() + '\n') + readFileSync(join(ASSETS, 'page.css'), 'utf8');
  const js = readFileSync(join(ASSETS, 'page.js'), 'utf8');
  // --css adds a stylesheet file in a <style> of its own, for example the mockup styles of an app
  // that a project keeps for all its pages. A later build without --css keeps that <style>.
  let style = `<style data-kit="show">\n${css}</style>`;
  if (flags.css) {
    html = html.replace(extraStyle, '');
    style += `\n<style data-kit="show-css">\n${readFileSync(flags.css, 'utf8')}</style>`;
  }
  const script = `<script data-kit="show">\n${js}</script>`;
  // A function as the replacement keeps "$" characters of the inserted text as they are.
  if (kitStyle.test(html)) html = html.replace(kitStyle, () => style);
  // The style goes directly after the charset tag: the charset stays at the start of the file, and
  // a <style> of the content file comes later, so it can change a rule of this stylesheet.
  else html = html.replace(/<meta\b[^>]*\bcharset=[^>]*>/i, tag => `${tag}\n${style}`);
  if (kitScript.test(html)) html = html.replace(kitScript, () => script);
  else html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${script}\n</body>`);

  const out = resolve(flags.out ?? file.replace(/(\.html?)?$/i, '.page.html'));
  if (out === resolve(file)) fail('The output file is the content file. Give a different file with --out=<file>.');
  writeFileSync(out, html);
  return { file: out, bytes: Buffer.byteLength(html), questions: asks.map(ask => ask.id), warnings };
}

// ---- answers ----

function answers(file) {
  if (!file) fail('Give the saved page: node page.mjs answers <saved.html>.');
  const html = readFileSync(file, 'utf8');
  const list = questions(html).map((ask, index) => ({
    n: index + 1,
    id: ask.id,
    question: ask.question,
    picks: ask.options.filter(option => option.checked).map(({ value, label }) => ({ value, label })),
    note: ask.note,
  }));
  return {
    title: textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''),
    answered: list.filter(ask => ask.picks.length || ask.note).length,
    total: list.length,
    questions: list,
  };
}

// ---- command line ----

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const files = [];
for (const arg of rest) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  if (m) flags[m[1]] = m[2] ?? true; else files.push(arg);
}
try {
  const result = command === 'build' ? build(files[0], flags)
    : command === 'answers' ? answers(files[0])
    : fail('Commands: build <content.html> [--out=<file>] [--css=<file>] [--no-fonts], answers <saved.html>.');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof Failure) && error.code !== 'ENOENT') throw error;
  console.error(error instanceof Failure ? error.message : `The file ${error.path} does not exist.`);
  process.exit(1);
}
