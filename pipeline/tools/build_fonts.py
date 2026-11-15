"""Build the map's label fonts: Noto Sans Regular / Medium / Bold as MapLibre glyph files.

Sources (all pinned, all allow commercial use):
  * Noto Sans from @fontsource/noto-sans@5.3.0 (SIL Open Font License 1.1)
  * fontTools (MIT) converts the web fonts (woff2) to TTF
  * @kartore/glyphore@0.2.0 (MIT OR Apache-2.0, dev dependency) renders TTF -> glyph PBF ranges
Fontsource splits each weight by alphabet (latin, latin-ext, cyrillic, greek, vietnamese); for
every 256-character range we keep the subset file that covers it best (the largest output).
Output: app/public/fonts/Noto Sans <Weight>/<start>-<end>.pbf  (committed; run this only to update).

Usage (from the project root):  .venv/bin/python pipeline/tools/build_fonts.py
"""
import io
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "app" / "public" / "fonts"
TARBALL = "https://registry.npmjs.org/@fontsource/noto-sans/-/noto-sans-5.3.0.tgz"
WEIGHTS = {"Regular": 400, "Medium": 500, "Bold": 700}
SUBSETS = ["latin", "latin-ext", "cyrillic", "greek", "vietnamese"]
GLYPHORE = ROOT / "node_modules" / "@kartore" / "glyphore" / "dist" / "cli.js"


def main():
    with urllib.request.urlopen(TARBALL, timeout=120) as r:
        tar = tarfile.open(fileobj=io.BytesIO(r.read()), mode="r:gz")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for style, weight in WEIGHTS.items():
            best = {}   # range file name -> bytes
            for subset in SUBSETS:
                member = tar.getmember(f"package/files/noto-sans-{subset}-{weight}-normal.woff2")
                font = TTFont(io.BytesIO(tar.extractfile(member).read()))
                font.flavor = None
                src = tmp / f"{subset}-{weight}" / "font.ttf"
                src.parent.mkdir(parents=True)
                font.save(src)
                out = tmp / f"out-{subset}-{weight}"
                subprocess.run(["node", str(GLYPHORE), "build", str(src.parent), "-o", str(out)], check=True,
                               stdout=subprocess.DEVNULL)
                for pbf in out.rglob("*.pbf"):
                    data = pbf.read_bytes()
                    if len(data) > len(best.get(pbf.name, b"")):
                        best[pbf.name] = data
            dest = OUT / f"Noto Sans {style}"
            shutil.rmtree(dest, ignore_errors=True)
            dest.mkdir(parents=True)
            for name, data in best.items():
                (dest / name).write_bytes(data)
            print(f"Noto Sans {style}: {len(best)} ranges, {sum(map(len, best.values())) // 1024} KB")


if __name__ == "__main__":
    main()
