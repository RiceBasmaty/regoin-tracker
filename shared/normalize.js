// Search-text normaliser. MUST stay identical to pipeline/textnorm.py:
// the index is built with the Python version and queried with this one.
// A parity test (pipeline/tests/test_normalize_parity.py) runs both on
// tens of thousands of real place names and fails on any difference.
//
// Steps: decompose accents -> lowercase -> drop Latin/Greek/Cyrillic/Arabic
// accent marks -> recompose -> fold special letters (ß->ss, ø->o, ...) ->
// any other punctuation becomes a space -> collapse spaces.
import foldMap from './fold-map.json' with { type: 'json' };

const FOLD = foldMap.map;
// Combining Diacritical Marks (Latin, Greek, Cyrillic) + Arabic vowel marks.
// Japanese voicing marks etc. are deliberately kept: removing them changes the word.
const STRIP_MARKS = /[̀-ًͯ-ٰٟ]/g;
const NOT_WORD = /[^\p{L}\p{N}\p{M}]+/gu;

export function normalize(input) {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFD').toLowerCase().replace(STRIP_MARKS, '').normalize('NFC');
  let out = '';
  for (const ch of s) out += Object.hasOwn(FOLD, ch) ? FOLD[ch] : ch;
  return out.replace(NOT_WORD, ' ').trim();
}
