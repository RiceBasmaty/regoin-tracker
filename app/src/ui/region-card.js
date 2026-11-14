// Region card: name, country, visited status, visited cities. Desktop: floating card;
// phone: bottom sheet (CSS). Text is always set with textContent, never as HTML.
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function createRegionCard(root, { onClose }) {
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'region-card-title');

  function render(model) {
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
    const close = el('button', 'icon-button card__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    close.addEventListener('click', onClose);
    header.append(titles, close);

    const status = el('p', `card__status${model.visited ? ' is-visited' : ''}`);
    status.append(el('span', 'status-dot'), document.createTextNode(model.status));
    root.append(header, status);

    if (model.cities.length) {
      const list = el('ul', 'card__cities');
      list.setAttribute('aria-label', `Visited cities in ${model.name}`);
      for (const c of model.cities) list.append(el('li', null, c.name));
      root.append(list);
    } else {
      root.append(el('p', 'card__hint', 'Add a city in this region to mark it as visited.'));
    }
  }

  return {
    show(model, { focus = false } = {}) {
      render(model);
      root.hidden = false;
      if (focus) root.querySelector('#region-card-title')?.focus();
    },
    update(model) { if (!root.hidden) render(model); },
    hide() { root.hidden = true; root.replaceChildren(); },
    get open() { return !root.hidden; },
  };
}
