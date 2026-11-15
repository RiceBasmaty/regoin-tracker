// Design tokens: WCAG 2.1 AA contrast for every text/background pair, in both themes,
// and the two copies of the dark theme (explicit + "follow device") must be identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/src/styles/tokens.css', import.meta.url), 'utf8');
const block = (selectorStart) => {
  const i = css.indexOf(selectorStart);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const lightRaw = block(':root {');
const darkOnly = block(':root[data-theme="dark"]');
const darkMedia = block(':root:not([data-theme="light"])');
// Resolve var(--palette-x) references, as the browser does.
const resolve = (tokens) => Object.fromEntries(Object.entries(tokens).map(([k, v]) => {
  let out = v;
  for (let i = 0; i < 5 && /var\(--/.test(out); i++) out = out.replace(/var\(--([\w-]+)\)/g, (_, n) => tokens[n] ?? lightRaw[n]);
  return [k, out];
}));
const light = resolve(lightRaw);
const dark = resolve({ ...lightRaw, ...darkOnly });

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// [text token, background token, minimum ratio]  4.5 = normal text, 3 = large text / UI parts
const PAIRS = [
  ['color-text', 'color-surface', 4.5], ['color-text', 'color-bg', 4.5],
  ['color-text-muted', 'color-surface', 4.5], ['color-text-muted', 'color-bg', 4.5],
  ['color-accent', 'color-surface', 4.5],          // "Visited · 2 cities"
  ['color-accent-text', 'color-accent', 4.5],      // selected toggle
  ['color-text', 'color-accent-soft', 4.5],        // city list items
  ['color-warning-text', 'color-warning-bg', 4.5], ['color-danger-text', 'color-danger-bg', 4.5],
  ['map-label-strong', 'map-land', 4.5], ['map-label', 'map-land', 4.5],
  ['map-country-line', 'map-land', 1.8],           // decorative borders: visible, not text
  ['color-toast-text', 'color-toast-bg', 4.5], ['color-toast-action', 'color-toast-bg', 4.5],
  ['map-city-dot', 'map-land', 3],                 // city dots are UI marks (3:1)
  ['map-label-city', 'map-land', 4.5], ['map-label-region', 'map-land', 4.5], ['map-place-label', 'map-land', 4.5],
  ['map-visited-label', 'map-land', 4.5], ['map-water-label', 'map-water', 4.5],
  ['map-river', 'map-land', 1.25],                 // decorative line: just visible
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    test(`${name}: ${fg} on ${bg} >= ${min}:1`, () => {
      const r = contrast(theme[fg], theme[bg]);
      assert.ok(r >= min, `${r.toFixed(2)}:1`);
    });
  }
}

test('dark theme is defined identically for "explicit" and "follow device"', () => {
  assert.deepEqual(darkMedia, darkOnly);
});

test('every map token used by the app exists in both themes', async () => {
  const { MAP_TOKENS } = await import('../app/src/map/tokens.js');
  for (const t of MAP_TOKENS) {
    assert.ok(light[`map-${t}`], `light --map-${t}`);
    // fonts and text sizes are the same in both themes; colours must be defined for dark too
    if (!/^(font|text)-/.test(t)) assert.ok(darkOnly[`map-${t}`], `dark --map-${t}`);
  }
});

test('roles use the palette (no raw hex outside the palette)', () => {
  for (const [name, tokens] of [['light', lightRaw], ['dark', darkOnly]]) {
    for (const [k, v] of Object.entries(tokens)) {
      if (k.startsWith('palette-')) continue;
      assert.doesNotMatch(v, /#[0-9a-f]{3,8}\b/i, `${name} --${k} should reference a --palette-* colour`);
    }
  }
});

test('components use roles only (no palette names or hex colours in app.css)', () => {
  const app = readFileSync(new URL('../app/src/styles/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /--palette-/);
  assert.doesNotMatch(app, /#[0-9a-f]{3,8}\b/i);
});
