// "Map | Globe" segmented control. Remembers the choice on this device.
const KEY = 'rt.projection';

export function savedProjection(fallback = 'globe') {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'globe' || v === 'mercator' ? v : fallback;
  } catch { return fallback; }
}

export function createProjectionToggle(root, { value, onChange }) {
  const options = [['mercator', 'Map'], ['globe', 'Globe']];
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Map view');
  const buttons = options.map(([v, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segmented__option';
    b.textContent = label;
    b.dataset.value = v;
    b.addEventListener('click', () => set(v, true));
    root.append(b);
    return b;
  });
  function set(v, fromUser) {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
    if (fromUser) {
      try { localStorage.setItem(KEY, v); } catch { /* private mode: fine */ }
      onChange(v);
    }
  }
  set(value, false);
  return { set };
}
