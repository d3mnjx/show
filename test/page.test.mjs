// Tests for scripts/page.mjs. Run them with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'show');
const SCRIPT = join(SKILL, 'scripts', 'page.mjs');
const TEMPLATE = join(SKILL, 'assets', 'template.html');
const dir = mkdtempSync(join(tmpdir(), 'show-'));

const run = (...args) => JSON.parse(execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }));
const runFail = (...args) => {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 1, 'the command must exit with code 1');
  return result.stderr;
};
// A content file with the frame of a page and the given body.
function content(name, body) {
  const file = join(dir, name);
  writeFileSync(file, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Test</title></head>
<body><div class="page">${body}</div></body></html>`);
  return file;
}
const ask = (id, inner) => `<fieldset class="ask" data-q="${id}"><legend>Question ${id}?</legend>${inner}</fieldset>`;
const option = (name, value, type = 'radio') => `<label class="opt"><input type="${type}" name="${name}" value="${value}"><b>Answer ${value}. <span class="tag rec">recommended</span></b><span class="d">Result.</span></label>`;
const NOTE = '<label class="field"><span class="lab">Your note</span><textarea></textarea></label>';

test('build makes one file that loads nothing from another site', () => {
  const out = join(dir, 'template.page.html');
  const result = run('build', TEMPLATE, `--out=${out}`);
  assert.deepEqual(result.questions, ['keep-time', 'trash-place', 'trash-actions', 'trash-name', 'next']);
  assert.deepEqual(result.warnings, []);
  const html = readFileSync(out, 'utf8');
  assert.equal(html.match(/<style data-kit="show">/g).length, 1);
  assert.equal(html.match(/<script data-kit="show">/g).length, 1);
  assert.equal(html.match(/@font-face\{/g).length, 8);
  assert.match(html, /<html lang="en" nc:autosave nc:edit-gate="always" nc:runtime-owner="off">/);
  // The same expression that `artifact create` uses to refuse a page.
  assert.equal(/<(?:script|link|img|iframe|video|audio|source)\b[^>]*?\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i.test(html), false);
  assert.ok(result.bytes < 400_000, 'the page is uploaded on each save, so it must stay small');
});

test('build --no-fonts leaves the fonts out', () => {
  const out = join(dir, 'nofonts.html');
  const result = run('build', TEMPLATE, `--out=${out}`, '--no-fonts');
  assert.equal(readFileSync(out, 'utf8').includes('@font-face{'), false);
  assert.ok(result.bytes < 40_000);
});

test('build refuses a page that it cannot read back', () => {
  const cases = [
    [ask('a', option('a', 'x') + NOTE) + ask('a', option('a', 'y') + NOTE), /Two questions have data-q="a"/],
    [ask('a', option('b', 'x') + NOTE), /needs name="a"/],
    [ask('a', option('a', 'x') + option('a', 'x') + NOTE), /two options with value="x"/],
    [ask('a b', option('a b', 'x')), /needs data-q with a short id/],
    [ask('a', ''), /no option and no <textarea>/],
    [ask('a', '<textarea></textarea>'), /placeholder attribute/],
    [ask('a', '<div class="shot"><input type="text"></div>' + option('a', 'x') + NOTE), /Draw a control of a mockup with a <span>/],
    [ask('a', option('a', 'x') + NOTE + NOTE), /has 2 <textarea> tags/],
    ['<fieldset class="ask" data-q="a"><legend>Open?</legend>', /only 0 are complete/],
  ];
  cases.forEach(([body, message], index) => assert.match(runFail('build', content(`bad${index}.html`, body)), message));
  assert.match(runFail('build', join(dir, 'missing.html')), /does not exist/);
});

test('build --css adds a stylesheet file after the stylesheet of the kit', () => {
  const css = join(dir, 'mock.css');
  writeFileSync(css, '.mock.app { --mock-w: 20; }');
  const out = join(dir, 'withcss.html');
  run('build', content('withcss.src.html', '<p>Text.</p>'), `--out=${out}`, `--css=${css}`, '--no-fonts');
  const html = readFileSync(out, 'utf8');
  assert.ok(html.indexOf('.mock.app { --mock-w: 20; }') > html.indexOf('.answers-text'), 'the file comes after the kit rules');
  assert.equal(html.match(/<style/g).length, 2);
});

test('build of a built page replaces the parts of the kit and keeps the answers', () => {
  const css = join(dir, 'mock2.css');
  writeFileSync(css, '.mock.app { --mock-w: 20; }');
  const first = join(dir, 'again1.html');
  run('build', content('again.src.html', ask('a', option('a', 'x') + NOTE)), `--out=${first}`, `--css=${css}`, '--no-fonts');
  // An old kit, an answer and a comment of the runtime, as in a page that a person saved.
  writeFileSync(first, readFileSync(first, 'utf8')
    .replace(/(<style data-kit="show">)[\s\S]*?(<\/style>)/, '$1.old-kit{}$2')
    .replace(/(<script data-kit="show">)[\s\S]*?(<\/script>)/, '$1/* old kit */$2')
    .replace('value="x"', 'value="x" checked=""')
    .replace('</body>', '<aside nc:comments hidden><article nc:comment="c1">Text</article></aside></body>'));
  const second = join(dir, 'again2.html');
  const result = run('build', first, `--out=${second}`, '--no-fonts');
  const html = readFileSync(second, 'utf8');
  assert.deepEqual(result.questions, ['a']);
  assert.equal(html.includes('old-kit'), false);
  assert.equal(html.includes('old kit'), false);
  assert.equal(html.match(/<style data-kit="show">/g).length, 1);
  assert.equal(html.match(/<script data-kit="show">/g).length, 1);
  assert.ok(html.includes('.mock.app { --mock-w: 20; }'), 'the stylesheet of --css stays');
  assert.ok(html.includes('<article nc:comment="c1">'), 'the comment stays');
  assert.equal(run('answers', second).questions[0].picks[0].value, 'x');
});

test('build colors the code of a block that names its language', () => {
  const code = (lang, text) => `<pre><code class="language-${lang}">${text}</code></pre>`;
  const out = join(dir, 'code.html');
  const result = run('build', content('code.src.html',
    code('js', `// a &lt;note&gt; "x"\nconst url = 'https://a.b/c'; // end\nif (n &gt; 10) return \`t\${n}\`;`) +
    code('sql', 'SELECT id FROM notes WHERE deleted_at IS NULL -- live') +
    code('sh', 'curl -s "$URL#part" # get it') +
    code('html', '&lt;!-- c --&gt;&lt;a href="x"&gt;T&lt;/a&gt;') +
    code('js', 'const a = <mark nc:c="c1">1</mark>;') +
    code('cobol', 'MOVE 1 TO A.') +
    '<pre><code>const plain = 1;</code></pre>'), `--out=${out}`, '--no-fonts');
  const html = readFileSync(out, 'utf8');
  for (const part of [
    '<span class="tk-c">// a &lt;note&gt; "x"</span>',
    `<span class="tk-k">const</span> url = <span class="tk-s">'https://a.b/c'</span>; <span class="tk-c">// end</span>`,
    '<span class="tk-k">if</span> (n &gt; <span class="tk-n">10</span>) <span class="tk-k">return</span> <span class="tk-s">`t${n}`</span>;',
    '<span class="tk-k">SELECT</span> id <span class="tk-k">FROM</span> notes',
    '<span class="tk-c">-- live</span>',
    'curl -s <span class="tk-s">"$URL#part"</span> <span class="tk-c"># get it</span>',
    '<span class="tk-c">&lt;!-- c --&gt;</span><span class="tk-k">&lt;a</span> href=<span class="tk-s">"x"</span><span class="tk-k">&gt;</span>T<span class="tk-k">&lt;/a</span><span class="tk-k">&gt;</span>',
    'const a = <mark nc:c="c1">1</mark>;',   // a block with markup stays as it is
    'MOVE 1 TO A.',
    '<pre><code>const plain = 1;</code></pre>',
  ]) assert.ok(html.includes(part), `the page must contain ${part}`);
  assert.match(result.warnings.join(' '), /no colors for the language "cobol"/);
  // A second build finds the colored blocks and does not color them again.
  const again = join(dir, 'code2.html');
  run('build', out, `--out=${again}`, '--no-fonts');
  assert.equal(readFileSync(again, 'utf8'), html);
});

test('build reports a question without a note field and a page without questions', () => {
  assert.match(run('build', content('nonote.html', ask('a', option('a', 'x')))).warnings[0], /no <textarea> for a note/);
  assert.match(run('build', content('report.html', '<p>Text.</p>')).warnings[0], /no question/);
});

test('answers reads the picks and the notes from a saved page', () => {
  const built = join(dir, 'answered.html');
  run('build', content('answered.src.html',
    ask('one', option('one', 'x') + option('one', 'y') + NOTE) +
    ask('many', option('many', 'p', 'checkbox') + option('many', 'q', 'checkbox') + option('many', 'r', 'checkbox') + NOTE) +
    ask('text', '<label class="field"><span class="lab">Your answer</span><textarea placeholder="Name"></textarea></label>') +
    ask('open', option('open', 'x') + NOTE) +
    // An option card: a drawing, then the option, then the good and the cost.
    ask('card', '<div class="choices"><label class="opt"><div class="shot" aria-hidden="true"><div class="mock"><b>App</b></div></div>' +
      '<input type="radio" name="card" value="tabs"><b>Two tabs.</b><ul class="pc"><li><b class="good">Good</b><span>Text.</span></li></ul></label></div>' + NOTE)), `--out=${built}`);
  // The browser saves a selection as checked="" and the text of a <textarea> as escaped content.
  const saved = readFileSync(built, 'utf8')
    .replace('name="one" value="y"', 'name="one" value="y" checked=""')
    .replace('name="many" value="p"', 'name="many" value="p" checked=""')
    .replace('value="r"', 'checked="" value="r"')
    .replace('<textarea placeholder="Name">', '<textarea placeholder="Name">Bin &amp; "Trash" &lt;ok&gt;\n')
    .replace('<textarea></textarea>', '<textarea>Only on Monday.</textarea>')
    .replace('name="card" value="tabs"', 'name="card" value="tabs" checked=""');
  writeFileSync(built, saved);
  const result = run('answers', built);
  assert.equal(result.title, 'Test');
  assert.equal(result.answered, 4);
  assert.equal(result.total, 5);
  const [one, many, text, open, card] = result.questions;
  assert.deepEqual(card.picks, [{ value: 'tabs', label: 'Two tabs.' }]);
  assert.deepEqual(one, { n: 1, id: 'one', question: 'Question one?', picks: [{ value: 'y', label: 'Answer y.' }], note: 'Only on Monday.' });
  assert.deepEqual(many.picks.map(pick => pick.value), ['p', 'r']);
  assert.deepEqual(text, { n: 3, id: 'text', question: 'Question text?', picks: [], note: 'Bin & "Trash" <ok>' });
  assert.deepEqual(open.picks, []);
});
