// Small popup for a city tapped on the map: name, region · country, and Add or Remove (D35).
// Built with textContent only. Esc or the close button closes it.
import { Popup } from 'maplibre-gl';

const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

export function createCityPopup(map, { describe, isVisited, onAdd, onRemove }) {
  const popup = new Popup({ closeButton: true, closeOnClick: false, maxWidth: '280px', offset: 10, className: 'city-popup', focusAfterOpen: false });
  let current = null;

  function render() {
    const city = current;
    const { placeLine } = describe(city);
    const visited = isVisited(city.cityId);
    const root = el('div', 'city-popup__body');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', city.name);
    const title = el('p', 'city-popup__title', city.name);
    const place = el('p', 'city-popup__place', placeLine);
    const row = el('div', 'city-popup__row');
    if (visited) {
      const badge = el('span', 'city-popup__visited', 'Visited');
      const remove = el('button', 'button button--quiet', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => onRemove(city));
      row.append(badge, remove);
    } else {
      const add = el('button', 'button button--primary', 'Add to my cities');
      add.type = 'button';
      add.addEventListener('click', () => onAdd(city));
      row.append(add);
    }
    root.append(title, place, row);
    popup.setDOMContent(root);
    return root.querySelector('button');
  }

  return {
    open(city, { focus = true } = {}) {
      current = city;
      popup.setLngLat([city.lon, city.lat]);
      const btn = render();
      if (!popup.isOpen()) popup.addTo(map);
      if (focus) btn?.focus({ preventScroll: true });
    },
    /** Re-render after the city was added/removed (keeps it open). */
    refresh() { if (current && popup.isOpen()) render()?.focus({ preventScroll: true }); },
    close() { popup.remove(); current = null; },
    get open_() { return popup.isOpen(); },
    get city() { return popup.isOpen() ? current : null; },
  };
}
