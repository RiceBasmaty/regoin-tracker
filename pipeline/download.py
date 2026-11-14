"""Step 1: download pinned inputs into pipeline/cache (skips files already complete).

Overture: every parquet file of the pinned release's division_area type.
GeoNames: cities1000 + alternate names + country info.
Each file's size is checked against the server; partial files are resumed.
"""
import hashlib
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import config as C


def _remote_size(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Length"])


def fetch(url, dest, expected=None, attempts=5):
    dest.parent.mkdir(parents=True, exist_ok=True)
    expected = expected or _remote_size(url)
    for attempt in range(1, attempts + 1):
        have = dest.stat().st_size if dest.exists() else 0
        if have == expected:
            return
        if have > expected:
            dest.unlink()
            have = 0
        headers = {"Range": f"bytes={have}-"} if have else {}
        print(f"  {'resuming' if have else 'downloading'} {dest.name} ({expected/1e6:.0f} MB)", flush=True)
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "ab" if have else "wb") as out:
                while chunk := r.read(1 << 20):
                    out.write(chunk)
        except Exception as e:  # network hiccup: back off and resume
            print(f"  attempt {attempt} failed: {e}", flush=True)
            time.sleep(2 ** attempt)
    if dest.stat().st_size != expected:
        sys.exit(f"FAILED to download {url}")


def overture_keys(type_):
    prefix = f"release/{C.OVERTURE_RELEASE}/theme=divisions/type={type_}/"
    with urllib.request.urlopen(f"{C.OVERTURE_BUCKET}/?list-type=2&prefix={prefix}", timeout=60) as r:
        xml = r.read().decode()
    items = re.findall(r"<Key>([^<]+\.parquet)</Key>.*?<Size>(\d+)</Size>", xml)
    if not items:
        sys.exit(f"Overture release {C.OVERTURE_RELEASE} not found (type {type_})")
    return [(k, int(s)) for k, s in items]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def main():
    manifest = {"overture_release": C.OVERTURE_RELEASE, "downloaded_at": datetime.now(timezone.utc).isoformat(), "files": {}}
    for type_ in C.OVERTURE_TYPES:
        for key, size in overture_keys(type_):
            part = re.search(r"part-(\d+)", key).group(1)
            dest = C.OVERTURE_CACHE / f"{type_}-{part}.parquet"
            fetch(f"{C.OVERTURE_BUCKET}/{key}", dest, size)
            manifest["files"][f"overture/{dest.name}"] = {"source": key, "bytes": size}
    for name in C.GEONAMES_FILES:
        dest = C.GEONAMES_CACHE / name
        fetch(f"{C.GEONAMES_BASE}/{name}", dest)
        manifest["files"][f"geonames/{name}"] = {"source": f"{C.GEONAMES_BASE}/{name}", "bytes": dest.stat().st_size, "sha256": sha256(dest)}
    C.BUILD.mkdir(parents=True, exist_ok=True)
    (C.BUILD / "inputs.json").write_text(json.dumps(manifest, indent=2))
    print("inputs ready")


if __name__ == "__main__":
    main()
