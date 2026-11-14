// Polite, visible messages (offline, data failed to load). One message per key.
export function createNotices(root) {
  const items = new Map();
  return {
    show(key, { text, tone = 'warning', action } = {}) {
      let item = items.get(key);
      if (!item) {
        item = document.createElement('div');
        item.className = `notice notice--${tone}`;
        item.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
        items.set(key, item);
        root.append(item);
      }
      item.replaceChildren();
      const p = document.createElement('p');
      p.textContent = text;
      item.append(p);
      if (action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'notice__action';
        b.textContent = action.label;
        b.addEventListener('click', action.onClick);
        item.append(b);
      }
    },
    hide(key) {
      items.get(key)?.remove();
      items.delete(key);
    },
    has: (key) => items.has(key),
  };
}
