"""Search-text normaliser. MUST stay identical to shared/normalize.js.

The city index is built with this function and the browser queries it with the
JavaScript twin; pipeline/tests/test_normalize_parity.py checks they agree.
"""
import json
import re
import unicodedata
from pathlib import Path

_FOLD = json.loads((Path(__file__).resolve().parent.parent / "shared" / "fold-map.json").read_text("utf-8"))["map"]
_STRIP_MARKS = re.compile("[̀-ًͯ-ٰٟ]")
_SPACES = re.compile(" +")


def normalize(text: str) -> str:
    if not isinstance(text, str):
        return ""
    s = unicodedata.normalize("NFD", text).lower()
    s = unicodedata.normalize("NFC", _STRIP_MARKS.sub("", s))
    s = "".join(_FOLD.get(ch, ch) for ch in s)
    # Anything that is not a letter, digit or (kept) mark becomes a space.
    s = "".join(ch if unicodedata.category(ch)[0] in "LNM" else " " for ch in s)
    return _SPACES.sub(" ", s).strip()
