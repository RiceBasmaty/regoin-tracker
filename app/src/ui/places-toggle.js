// Map control: show / hide other cities' dots and names. Your visited cities always stay.
// Remembered on this device.
const KEY = 'rt.places';

export function savedPlacesVisible() {
  try { return localStorage.getItem(KEY) !== 'hidden'; } catch { return true; }
}

const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="7" cy="8" r="2.2" fill="currentColor"/><circle cx="16" cy="6.5" r="1.8" fill="currentColor"/><circle cx="12.5" cy="13" r="2.6" fill="currentColor"/><circle cx="6.5" cy="17" r="1.6" fill="currentColor"/><circle cx="17.5" cy="17.5" r="2" fill="currentColor"/></svg>';

export class PlacesToggleControl {
  constructor({ visible, onChange }) { this.visible = visible; this.onChange = onChange; }
  onAdd() {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group places-toggle';
    const b = this.button = document.createElement('button');
    b.type = 'button';
    b.className = 'places-toggle__button';
    b.innerHTML = ICON;
    b.addEventListener('click', () => this.set(!this.visible, true));
    this.container.append(b);
    this.set(this.visible, false);
    return this.container;
  }
  set(visible, fromUser) {
    this.visible = visible;
    const label = visible ? 'Hide other cities on the map' : 'Show other cities on the map';
    this.button.setAttribute('aria-pressed', String(visible));
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
    if (fromUser) {
      try { localStorage.setItem(KEY, visible ? 'shown' : 'hidden'); } catch { /* private mode */ }
      this.onChange(visible);
    }
  }
  onRemove() { this.container.remove(); }
}
