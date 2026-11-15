// Region card: name, country, visited status, visited cities (with remove), and ways to add a
// city here: one-tap buttons for the largest cities and a search within the region (D35).
// Desktop: floating card; phone: bottom sheet (CSS). Text is always set with textContent.
import { filterPlaces } from './region-model.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (cls, text, label) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

export function createRegionCard(root, { onClose, onAdd, onRemove }) {
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'region-card-title');
  let model = null;
  let query = '';

  function cityButtons(list) {
    const wrap = el('div', 'chips');
    for (const p of list) {
      const b = button('chip', null, `Add ${p.name}`);
      b.append(el('span', 'chip__plus', '+'), document.createTextNode(p.name));
      b.addEventListener('click', () => onAdd(p));
      wrap.append(b);
    }
    return wrap;
  }

  function render() {
    // keep the region-search box focused while the card re-renders
    const active = document.activeElement;
    const searchFocused = active?.classList.contains('card__search');
    const caret = searchFocused ? active.selectionStart : null;
    root.replaceChildren();

    const header = el('div', 'card__header');
    const titles = el('div', 'card__titles');
    if (model.placeLine || model.isTerritory) {
      const eyebrow = el('p', 'card__eyebrow', model.placeLine ?? '');
      if (model.isTerritory) eyebrow.append(el('span', 'tag', 'Territory'));
      titles.append(eyebrow);
    }
    const h = el('h2', 'card__title', model.name);
    h.id = 'region-card-title';
    h.tabIndex = -1;
    titles.append(h);
    if (model.localName) titles.append(el('p', 'card__subtitle', model.localName));
    const close = button('icon-button card__close', null, 'Close');
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    close.addEventListener('click', onClose);
    header.append(titles, close);

    const status = el('p', `card__status${model.visited ? ' is-visited' : ''}`);
    status.append(el('span', 'status-dot'), document.createTextNode(model.status));
    root.append(header, status);

    if (model.cities.length) {
      const list = el('ul', 'card__cities');
      list.setAttribute('aria-label', `Visited cities in ${model.name}`);
      for (const c of model.cities) {
        const li = el('li', null);
        li.append(el('span', null, c.name));
        const rm = button('icon-button card__remove', null, `Remove ${c.name}`);
        rm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        rm.addEventListener('click', () => onRemove(c));
        li.append(rm);
        list.append(li);
      }
      root.append(list);
    }

    // ---- add a city here ----
    const add = el('section', 'card__add');
    add.setAttribute('aria-label', `Add a city in ${model.name}`);
    add.append(el('h3', 'card__section-title', model.cities.length ? 'Add another city here' : 'Add a city here'));
    if (model.places == null) {
      add.append(el('p', 'card__hint', 'Loading cities…'));
    } else if (!model.places.length) {
      add.append(el('p', 'card__hint', 'There are no cities in our list for this region yet.'));
    } else {
      const input = el('input', 'card__search');
      input.type = 'search';
      input.placeholder = `Search cities in ${model.name}`;
      input.setAttribute('aria-label', `Search cities in ${model.name}`);
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = query;
      const results = el('div', 'card__results');
      results.setAttribute('aria-live', 'polite');
      const showResults = () => {
        query = input.value;
        results.replaceChildren();
        if (!query.trim()) { results.append(cityButtons(model.quickAdd)); return; }
        const found = filterPlaces(model.places, query).filter((p) => !model.cities.some((c) => c.cityId === p.cityId));
        if (found.length) results.append(cityButtons(found));
        else results.append(el('p', 'card__hint', `No city called “${query.trim()}” in ${model.name}`));
      };
      input.addEventListener('input', showResults);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; showResults(); }
        if (e.key === 'Enter') { e.preventDefault(); results.querySelector('.chip')?.click(); }
      });
      add.append(input, results);
      showResults();
      if (searchFocused) { input.focus(); if (caret != null) input.setSelectionRange(caret, caret); }
    }
    root.append(add);
  }

  return {
    show(m, { focus = false } = {}) {
      if (m.id !== model?.id) query = '';
      model = m;
      render();
      root.hidden = false;
      if (focus) root.querySelector('#region-card-title')?.focus();
    },
    update(m) { if (!root.hidden && m.id === model?.id) { model = m; render(); } },
    hide() { root.hidden = true; root.replaceChildren(); model = null; query = ''; },
    get open() { return !root.hidden; },
    get regionId() { return root.hidden ? null : model?.id; },
  };
}
