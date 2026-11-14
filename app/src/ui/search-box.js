// City search box: an accessible combobox (WAI-ARIA 1.2 pattern).
// Keys: ↑/↓ move, Enter picks (the first suggestion if none highlighted), Esc closes, then clears.
// "/" anywhere focuses the box. Text is always set with textContent.
const SLOW_MS = 150;

export function createSearchBox(root, { index, isVisited, onPick }) {
  const input = root.querySelector('input');
  const list = root.querySelector('[role="listbox"]');
  const status = root.querySelector('.search__status');
  const clearBtn = root.querySelector('.search__clear');
  let results = [];
  let active = -1;
  let seq = 0;
  let minChars = 2;   // updated from the search manifest once it has loaded (on first focus)

  const setExpanded = (open) => {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
  };
  const announce = (text) => { status.textContent = text; };

  function setActive(i) {
    active = i;
    for (const [n, li] of [...list.children].entries()) li.setAttribute('aria-selected', String(n === i));
    const li = list.children[i];
    if (li?.getAttribute('role') === 'option') {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function message(text, kind) {
    results = [];
    list.replaceChildren(Object.assign(document.createElement('li'), { className: `search__message search__message--${kind}`, textContent: text }));
    list.firstChild.setAttribute('role', 'presentation');
    setActive(-1);
    setExpanded(true);
    announce(text);
  }

  function render(items) {
    results = items;
    if (!items.length) return message(`No places found for “${input.value.trim()}”`, 'empty');
    list.replaceChildren(...items.map((s, i) => {
      const li = document.createElement('li');
      li.id = `search-opt-${i}`;
      li.setAttribute('role', 'option');
      li.className = 'search__option';
      const text = document.createElement('span');
      text.className = 'search__text';
      const name = Object.assign(document.createElement('span'), { className: 'search__name', textContent: s.name });
      if (s.matchedName) name.append(Object.assign(document.createElement('span'), { className: 'search__alt', textContent: ` (${s.matchedName})` }));
      const place = Object.assign(document.createElement('span'), { className: 'search__place', textContent: s.label.slice(s.name.length + 2) });
      text.append(name, place);
      li.append(text);
      if (isVisited(s.cityId)) {
        li.classList.add('is-visited');
        li.append(Object.assign(document.createElement('span'), { className: 'search__visited', textContent: 'Visited' }));
      }
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => pick(i));
      return li;
    }));
    setActive(-1);
    setExpanded(true);
    announce(`${items.length} suggestion${items.length === 1 ? '' : 's'}. Use up and down arrows to choose.`);
  }

  function close() { setExpanded(false); setActive(-1); }

  function pick(i) {
    const s = results[i];
    if (!s) return;
    input.value = '';
    clearBtn.hidden = true;
    close();
    announce('');
    onPick(s);
  }

  async function update() {
    const q = input.value;
    clearBtn.hidden = !q;
    const mine = ++seq;
    if (Array.from(q.trim()).length < minChars) { close(); return; }
    performance.mark('rt:keystroke');
    const slow = setTimeout(() => { if (mine === seq) message('Searching…', 'loading'); }, SLOW_MS);
    try {
      const items = await index.search(q);
      if (mine !== seq) return;              // a newer keystroke already answered
      render(items);
      list.dataset.query = q;                // which query the list answers (tests, debugging)
      performance.measure('rt:suggest', 'rt:keystroke');
    } catch (err) {
      if (mine !== seq) return;
      console.warn('[search]', err);
      list.dataset.query = q;
      message(navigator.onLine ? 'Search isn’t available right now. Please try again.' : 'You’re offline, so search isn’t available.', 'error');
    } finally {
      clearTimeout(slow);
    }
  }

  input.addEventListener('input', update);
  input.addEventListener('focus', () => {
    index.minChars().then((n) => { minChars = n; }).catch(() => {});   // also warms the manifest
    if (input.value) update();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    const n = results.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); if (list.hidden) setExpanded(true); setActive((active + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive(active <= 0 ? n - 1 : active - 1); }
    else if (e.key === 'Enter') { if (n && !list.hidden) { e.preventDefault(); pick(active >= 0 ? active : 0); } }
    else if (e.key === 'Escape') {
      e.preventDefault();                       // browsers clear type="search" on Esc by default
      e.stopPropagation();                      // don't also close the region card
      if (!list.hidden) close();
      else if (input.value) { input.value = ''; clearBtn.hidden = true; announce(''); }
      else input.blur();
    }
  });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; close(); input.focus(); });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); input.focus(); }
  });

  return {
    focus: () => input.focus(),
    /** Re-draw (e.g. "Visited" tags changed) without losing the keyboard highlight. */
    refresh: () => {
      if (list.hidden || !results.length) return;
      const keep = active;
      render(results);
      if (keep >= 0) setActive(Math.min(keep, results.length - 1));
    },
  };
}
