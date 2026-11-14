"""Step 5: finalise dist/data/v<VERSION>/ — the folder that gets uploaded to the CDN (R2).

Every file name carries the data version, so it can be cached "forever" (immutable);
a new Overture release produces new names instead of overwriting old ones.
Writes manifest.json with sizes, checksums, input provenance and licences.
"""
import hashlib
import json
import shutil
from datetime import datetime, timezone

import config as C

ATTRIBUTION = [
    {"data": "Region and country boundaries", "source": "Overture Maps Foundation, divisions theme (from OpenStreetMap and others)",
     "release": C.OVERTURE_RELEASE, "licence": "ODbL 1.0", "notice": "© OpenStreetMap contributors, Overture Maps Foundation",
     "url": "https://docs.overturemaps.org/attribution/"},
    {"data": "Cities and city names", "source": "GeoNames (cities1000, alternateNamesV2)", "licence": "CC BY 4.0",
     "notice": "City data © GeoNames (geonames.org), CC BY 4.0", "url": "https://www.geonames.org/"},
]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    shutil.copy(C.BUILD / "regions.meta.json", C.DIST / f"regions.v{C.DATA_VERSION}.json")
    shutil.copy(C.BUILD / "countries.meta.json", C.DIST / f"countries.v{C.DATA_VERSION}.json")
    files = {}
    for f in sorted(C.DIST.iterdir()):
        if f.is_file() and f.name != "manifest.json":
            files[f.name] = {"bytes": f.stat().st_size, "sha256": sha256(f)}
    search = sorted((C.DIST / "search").glob("*.json"))
    files["search/"] = {"files": len(search), "bytes": sum(p.stat().st_size for p in search)}
    inputs = json.loads((C.BUILD / "inputs.json").read_text()) if (C.BUILD / "inputs.json").exists() else {}
    manifest = {
        "dataVersion": C.DATA_VERSION,
        "overtureRelease": C.OVERTURE_RELEASE,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "inputs": inputs.get("files", {}),
        "files": files,
        "attribution": ATTRIBUTION,
        "reports": {n: json.loads((C.BUILD / f"{n}.report.json").read_text()).get("counts")
                    for n in ["regions"] if (C.BUILD / f"{n}.report.json").exists()},
    }
    (C.DIST / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    for k, v in files.items():
        print(f"  {k:32} {v.get('bytes', 0) / 1e6:8.1f} MB" + (f"  ({v['files']} files)" if "files" in v else ""))


if __name__ == "__main__":
    main()
