// show: counts the answers, reports the save state, and gives the answers as text.
//
// This script stores nothing. The answers are the form controls of the page. The nsite-clay runtime
// (window.nc) writes the page with its form controls back to its servers after each change, and the
// agent reads them from there. Each element that this script adds has the attribute nc:chrome, so
// the runtime does not save it and does not count it as an edit.
(() => {
  const asks = [...document.querySelectorAll('fieldset.ask[data-q]')];
  if (!asks.length) return;   // a page without questions needs no status bar

  const root = document.documentElement;
  const nc = window.nc;
  const COPY_HINT = 'Copy the text at the end of the page into the chat.';

  function make(tag, className, text) {
    const el = document.createElement(tag);
    el.setAttribute('nc:chrome', '');
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  // ---- the status bar ----
  const bar = make('div', 'bar');
  bar.setAttribute('role', 'status');
  const count = make('span', 'count');
  const state = make('span', 'state');
  const inner = make('div', 'in');
  inner.append(count, state);
  bar.append(inner);

  // ---- the answers as text: the way to give the answers when the page cannot save them ----
  const section = make('section', 'answers-text');
  const label = make('label', 'field');
  const summary = make('textarea');
  summary.readOnly = true;
  summary.setAttribute('nc:no-persist', '');
  label.append(make('span', 'lab', 'Your answers as text'), summary);
  const copy = make('button', '', 'Copy the answers');
  copy.type = 'button';
  // An option is recommended when its label contains <span class="tag rec">.
  const recommended = set => [...set.querySelectorAll('label.opt:has(.tag.rec) input')];
  const useRec = make('button', 'use-rec', 'Use the recommended answers for the rest');
  useRec.type = 'button';
  const actions = make('div', 'actions');
  if (asks.some(set => recommended(set).length)) actions.append(useRec);
  actions.append(copy);
  section.append(label, actions);

  (document.querySelector('.page') ?? document.body).append(section);
  document.body.prepend(bar);

  function setState(text, kind) {
    state.textContent = text;
    state.className = 'state' + (kind ? ' ' + kind : '');
  }

  // One line for each question. scripts/page.mjs reads the same data from the saved markup.
  function render() {
    let done = 0;
    const lines = asks.map(set => {
      const picks = [...set.querySelectorAll('input:checked')].map(input => input.value);
      const note = set.querySelector('textarea')?.value.trim() ?? '';
      if (picks.length || note) done++;
      // A question without options has its answer in the text field.
      if (!set.querySelector('input')) return `${set.dataset.q}: ${note || '(no answer)'}`;
      return `${set.dataset.q}: ${picks.join(', ') || '(no answer)'}${note ? ' | note: ' + note : ''}`;
    });
    count.textContent = `${done} of ${asks.length} questions have an answer`;
    summary.value = [document.title, ...lines].join('\n');
  }

  for (const set of asks) {
    set.addEventListener('change', render);
    set.addEventListener('input', render);
  }
  useRec.addEventListener('click', () => {
    // Only a question without a selection gets the recommended answer. A question with a note
    // and no selection gets it too, and the note stays.
    for (const set of asks) {
      if (!set.querySelector('input:checked')) for (const input of recommended(set)) input.click();
    }
    // The selections came from a script, so the runtime needs a signal that the page changed.
    if (nc) { nc.dirty = true; nc.dispatchEvent(new CustomEvent('nsiteclay:autosave-now')); }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(summary.value); copy.textContent = 'Copied'; }
    catch { summary.focus(); summary.select(); }   // no clipboard permission: the person copies the selection
  });
  render();

  // ---- the save state ----
  if (!nc) {
    // The file is open from a disk, or the runtime did not load.
    setState('This page cannot save your answers. ' + COPY_HINT, 'bad');
    return;
  }
  // The runtime sets nc:ready on <html> when it is ready, and nc:owner-here="true" when the key in
  // the link can save. For a read link it sets no nc:owner-here at all. The attributes can arrive
  // after this script runs, so an observer watches for them.
  let saved = false;
  function showAccess() {
    if (saved) return;   // a later change of the attribute must not hide "Saved at ..."
    const here = root.getAttribute('nc:owner-here');
    if (here === 'true') setState('The page saves each answer.', 'ok');
    else if (root.getAttribute('nc:ready') === 'true') setState('This link can only read the page. It cannot save answers.');
    else setState('The page loads.');
  }
  new MutationObserver(showAccess).observe(root, { attributes: true, attributeFilter: ['nc:owner-here', 'nc:ready'] });
  showAccess();

  nc.addEventListener('nsiteclay:status', event => {
    const status = event.detail?.status;
    if (status === 'saving') setState('Saving…');
    else if (status === 'saved') { saved = true; setState('Saved at ' + new Date().toLocaleTimeString(), 'ok'); }
    else if (status === 'error') {
      const reason = String(event.detail.error ?? '').replace(/^Error: /, '');
      setState(`The page did not save the answers (${reason}). ${COPY_HINT}`, 'bad');
    }
  });
})();
