"""Step 4: region and country polygons -> PMTiles (one file each), via tippecanoe.

The map (Phase 1) colours regions with MapLibre `feature-state`, using the `id`
property as feature id (`promoteId: "id"`), so tiles stay tiny: id + country only.
--detect-shared-borders keeps neighbouring regions' simplified edges identical
(no slivers or gaps between regions at low zoom).
"""
import json
import shutil
import subprocess
import sys

import config as C

POLYGON_FLAGS = [
    "--detect-shared-borders",          # shared edges simplify identically
    "--no-tiny-polygon-reduction",      # never drop a small region (it might be visited)
    "--simplification=4",
    # Zoomed-out tiles use a coarser grid (2^10 instead of 2^12 units per tile): invisible at
    # that scale, but the world-view tiles get ~2x smaller, which matters for the first frame.
    "--low-detail=10", "--full-detail=12",
]
LAYERS = {
    # name: (max zoom, flags)
    "regions": (10, POLYGON_FLAGS),
    "countries": (8, POLYGON_FLAGS),
    # City points: each feature carries its own minzoom (build_places.py); keep every point.
    "places": (10, ["-r1", "--no-feature-limit"]),
    # Lakes, rivers, lake names (build_water.py): three layers in one file.
    "water": (8, ["-r1", "--no-feature-limit", "--simplification=4", "--low-detail=10", "--full-detail=12",
                  "-L", "lakes:{build}/water-lakes.geojsonl", "-L", "rivers:{build}/water-rivers.geojsonl",
                  "-L", "water_labels:{build}/water-labels.geojsonl"]),
}


def main():
    if not C.TIPPECANOE.exists():
        sys.exit(f"tippecanoe not found at {C.TIPPECANOE}; run pipeline/setup.sh")
    C.DIST.mkdir(parents=True, exist_ok=True)
    tmp = C.BUILD / "tiles"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    out = {}
    for name, (maxzoom, flags) in LAYERS.items():
        dest = C.DIST / f"{name}.v{C.DATA_VERSION}.pmtiles"
        cmd = [str(C.TIPPECANOE), "-o", str(tmp / dest.name), "--force", "--quiet",
               *(["-l", name] if name != "water" else []), "-Z", "0", "-z", str(maxzoom),
               "--maximum-tile-bytes=750000",
               "--attribution", "© OpenStreetMap contributors, Overture Maps Foundation (ODbL)",
               "--name", f"Region Tracker {name} {C.DATA_VERSION}",
               *[f.replace("{build}", str(C.BUILD)) for f in flags],
               *([str(C.BUILD / f"{name}.geojsonl")] if name != "water" else [])]
        subprocess.run(cmd, check=True)
        shutil.move(tmp / dest.name, dest)
        out[name] = {"file": dest.name, "mb": round(dest.stat().st_size / 1e6, 1), "maxzoom": maxzoom}
        print(name, out[name], flush=True)
    (C.BUILD / "tiles.report.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
