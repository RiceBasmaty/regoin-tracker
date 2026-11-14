// One short confirmation at a time ("Added Paris · Undo"). Pauses while hovered or focused.
export function createToast(root) {
  let timer = null;
  let remaining = 0;
  let started = 0;
  const durationMs = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toast-duration')) * 1000 || 6000;

  function hide() { clearTimeout(timer); root.hidden = true; root.replaceChildren(); }
  function schedule(ms) { clearTimeout(timer); remaining = ms; started = Date.now(); timer = setTimeout(hide, ms); }
  const pause = () => { clearTimeout(timer); remaining -= Date.now() - started; };
  const resume = () => { if (!root.hidden) schedule(Math.max(remaining, 1500)); };
  root.addEventListener('mouseenter', pause);
  root.addEventListener('mouseleave', resume);
  root.addEventListener('focusin', pause);
  root.addEventListener('focusout', resume);

  return {
    show(text, action) {
      root.replaceChildren(Object.assign(document.createElement('span'), { textContent: text }));
      if (action) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast__action', textContent: action.label });
        b.addEventListener('click', () => { hide(); action.onClick(); });
        root.append(b);
      }
      root.hidden = false;
      schedule(durationMs());
    },
    hide,
  };
}
