"""City places: map tiles and per-region city lists (D35)."""
import json

import pytest

import config as C


def test_every_city_has_a_place_in_its_region_file(cities):
    d = C.DIST / "places"
    if not d.exists():
        pytest.skip("places not built")
    seen = 0
    for f in d.glob("*.json"):
        doc = json.loads(f.read_text("utf-8"))
        assert doc["r"] == f.stem and doc["v"] == C.DATA_VERSION
        pops = [c[4] for c in doc["c"]]
        assert pops == sorted(pops, reverse=True), f"{f.name} not largest-first"
        seen += len(doc["c"])
    assert seen == len(cities)


def test_region_files_are_small():
    sizes = [f.stat().st_size for f in (C.DIST / "places").glob("*.json")]
    assert max(sizes) < 150_000


def test_places_tiles_hold_every_city(cities):
    from pmtiles.reader import MmapSource, Reader
    path = C.DIST / f"places.v{C.DATA_VERSION}.pmtiles"
    if not path.exists():
        pytest.skip("tiles not built")
    with open(path, "rb") as f:
        meta = Reader(MmapSource(f)).metadata()
    assert {l["id"] for l in meta["vector_layers"]} == {"places"}
    assert meta["tilestats"]["layers"][0]["count"] == len(cities)


def test_big_cities_show_when_zoomed_out():
    import sys
    sys.path.insert(0, str(C.PIPELINE))
    from build_places import minzoom
    from build_places import tier, CAPITAL, BIG, MEDIUM, TOWN, VILLAGE
    assert minzoom(10_000_000, "PPL") == 1
    assert minzoom(2_000, "PPL") == 10        # villages only at the closest zoom (D43)
    assert minzoom(200_000, "PPLC") == 3      # every capital by zoom 3
    assert minzoom(60_000, "PPL", is_centre=True) == 5   # region centres earlier than their size alone
    assert [tier(9e6, "PPLC", False), tier(2e6, "PPL", False), tier(50_000, "PPLA", True),
            tier(300_000, "PPL", False), tier(30_000, "PPL", False), tier(3_000, "PPL", False)] == [CAPITAL, BIG, BIG, MEDIUM, TOWN, VILLAGE]
