// "Map display" control: a button on the map that opens a small panel with two switches,
//   City dots - other cities' dots and names (your visited cities always stay)
//   Names     - every name on the map, for a clean map
// Both are remembered on this device.
const KEYS = { places: 'rt.places', labels: 'rt.labels' };

export function savedDisplay() {
  const read = (k) => { try { return localStorage.getItem(KEYS[k]) !== 'hidden'; } catch { return true; } };
  return { places: read('places'), labels: read('labels') };
}

const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4l8 4-8 4-8-4 8-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

export class MapDisplayControl {
  constructor({ value, onChange }) { this.value = { ...value }; this.onChange = onChange; }

  onAdd() {
    const c = this.container = document.createElement('div');
    c.className = 'maplibregl-ctrl map-display';
    const toggle = this.button = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'map-display__button maplibregl-ctrl-group';
    toggle.setAttribute('aria-label', 'Map display');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'map-display-panel');
    toggle.title = 'Map display';
    toggle.innerHTML = ICON;
    const panel = this.panel = document.createElement('div');
    panel.id = 'map-display-panel';
    panel.className = 'map-display__panel';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Map display');
    panel.append(this.switch('places', 'City dots', 'Other cities on the map'), this.switch('labels', 'Names', 'Countries, regions, cities, water'));
    toggle.addEventListener('click', () => this.setOpen(panel.hidden));
    c.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); this.setOpen(false); toggle.focus(); } });
    this.onDocClick = (e) => { if (!c.contains(e.target)) this.setOpen(false); };
    document.addEventListener('pointerdown', this.onDocClick);
    c.append(panel, toggle);
    return c;
  }

  switch(key, label, hint) {
    const row = document.createElement('label');
    row.className = 'map-display__row';
    const text = document.createElement('span');
    text.className = 'map-display__text';
    text.append(Object.assign(document.createElement('span'), { className: 'map-display__label', textContent: label }),
                Object.assign(document.createElement('span'), { className: 'map-display__hint', textContent: hint }));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.className = 'switch';
    input.checked = this.value[key];
    input.dataset.key = key;
    input.addEventListener('change', () => {
      this.value[key] = input.checked;
      try { localStorage.setItem(KEYS[key], input.checked ? 'shown' : 'hidden'); } catch { /* private mode */ }
      this.onChange({ ...this.value });
    });
    row.append(text, input);
    return row;
  }

  setOpen(open) {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.panel.querySelector('input')?.focus();
  }

  onRemove() { document.removeEventListener('pointerdown', this.onDocClick); this.container.remove(); }
}
