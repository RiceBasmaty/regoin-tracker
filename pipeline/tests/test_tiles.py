"""Checks on the PMTiles map files."""
import json
from collections import defaultdict

import pytest

import config as C


def open_tiles(name):
    from pmtiles.reader import MmapSource, Reader
    path = C.DIST / f"{name}.v{C.DATA_VERSION}.pmtiles"
    if not path.exists():
        pytest.skip("tiles not built")
    f = open(path, "rb")
    return Reader(MmapSource(f)), f


@pytest.mark.parametrize("name,meta_file", [("regions", "regions"), ("countries", "countries")])
def test_layer_and_feature_count(name, meta_file):
    r, f = open_tiles(name)
    with f:
        meta = r.metadata()
        layers = {l["id"] for l in meta["vector_layers"]}
        assert layers == {name}
        stats = meta["tilestats"]["layers"][0]
        expected = len(json.loads((C.DIST / f"{meta_file}.v{C.DATA_VERSION}.json").read_text("utf-8")))
        assert stats["count"] == expected, "every region/country must be in the tiles"
        assert "OpenStreetMap" in meta.get("attribution", "")


def test_low_zoom_tiles_fit_first_frame_budget():
    """World view (zoom 0-2) must stay small for the first map frame (< 2 s on 4G)."""
    from pmtiles.reader import all_tiles
    for name in ["regions", "countries"]:
        r, f = open_tiles(name)
        with f:
            sizes = defaultdict(int)
            for (z, x, y), data in all_tiles(r.get_bytes):
                if z <= 2:
                    sizes[z] = max(sizes[z], len(data))
                else:
                    break   # tiles are ordered by zoom
            assert max(sizes.values()) < 250_000, (name, dict(sizes))
