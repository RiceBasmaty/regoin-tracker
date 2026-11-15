"""Data checks: is every city in the right region? Are regions/countries consistent?"""
import re

import pytest

# (GeoNames id, city, expected region key). Ids avoid ambiguity (there are 9 Parises).
KNOWN = [
    (2988507, "Paris", "FR-IDF"), (2673730, "Stockholm", "SE-AB"), (5128581, "New York City", "US-NY"),
    (1850147, "Tokyo", "JP-13"), (2950159, "Berlin", "DE-BE"),
    (2867714, "Munich", "DE-BY"), (3128760, "Barcelona", "ES-CT"), (3169070, "Rome", "IT-62"),
    (2147714, "Sydney", "AU-NSW"), (3451190, "Rio de Janeiro", "BR-RJ"), (6167865, "Toronto", "CA-ON"),
    (524901, "Moscow", "RU-MOW"), (1275339, "Mumbai", "IN-MH"), (1816670, "Beijing", "CN-BJ"),
    (3369157, "Cape Town", "ZA-WC"), (745044, "Istanbul", "TR-34"), (2711537, "Gothenburg", "SE-O"),
    (3530597, "Mexico City", "MX-CMX"), (3435910, "Buenos Aires", "AR-C"), (2990440, "Nice", "FR-PAC"),
    (2759794, "Amsterdam", "NL-NH"), (2800866, "Brussels", "BE-BRU"), (2618425, "Copenhagen", "DK-84"),
    (703448, "Kyiv", "UA-30"), (360630, "Cairo", "EG-C"), (3646738, "Caracas", "VE-A"),   # via city override
    # islands and coasts (snapping / small polygons)
    (5856195, "Honolulu", "US-HI"), (4160812, "Key West", "US-FL"), (3164603, "Venice", "IT-34"),
    (3413829, "Reykjavík", "IS-1"),
    # next to a border
    (2660646, "Geneva", "CH-GE"), (2661604, "Basel", "CH-BS"), (2973783, "Strasbourg", "FR-GES"),
    (4990729, "Detroit", "US-MI"), (5520993, "El Paso", "US-TX"),
    # countries without regions -> the whole country is one region keyed by its code
    (6691831, "Vatican City", "VA"),
]


@pytest.mark.parametrize("gid,name,expected", KNOWN, ids=[k[1] for k in KNOWN])
def test_known_city_region(cities, gid, name, expected):
    row = cities[cities.geonameid == gid]
    assert len(row) == 1, f"{name} missing from index"
    assert row.iloc[0]["name"] == name
    assert row.iloc[0]["rid"] == expected


# Per-country levels (D36). Keys of grouped regions are pinned on purpose: saved cities refer to
# regions by key, so a change in how keys are made must never happen silently.
GROUPED = [
    (2643743, "London", "GB-XF82478", "Greater London"), (2640729, "Oxford", "GB-X383397", "Oxfordshire"),
    (2644688, "Leeds", "GB-X9F92C0", "West Yorkshire"), (2643123, "Manchester", "GB-X30F227", "Greater Manchester"),
    (2639577, "Reading", "GB-XB410A0", "Berkshire"), (2650225, "Edinburgh", "GB-EDH", "City of Edinburgh"),
    (2653822, "Cardiff", "GB-CRF", "Cardiff"), (2655984, "Belfast", "GB-BFS", "Belfast"),
    (3196359, "Ljubljana", "SI-X0F217A", "Central Slovenia"), (3195506, "Maribor", "SI-XDA71BF", "Drava"),
    (785842, "Skopje", "MK-X890D0D", "Skopje Region"), (792578, "Bitola", "MK-X313FDD", "Pelagonia Region"),
    (2562305, "Valletta", "MT-X4BD54E", "Port Region"), (2562619, "Victoria", "MT-X6BD47D", "Gozo Region"),
    (792680, "Belgrade", "RS-00", "Belgrade"), (3194360, "Novi Sad", "RS-06", "South Bačka District"),
]


@pytest.mark.parametrize("gid,name,key,region", GROUPED, ids=[g[1] for g in GROUPED])
def test_per_country_levels(cities, regions_meta, gid, name, key, region):
    row = cities[cities.geonameid == gid].iloc[0]
    assert row["name"] == name
    assert row["rid"] == key
    assert regions_meta[key]["name"] == region


def test_every_city_has_a_known_region(cities, regions_meta):
    assert cities.rid.notna().all()
    unknown = set(cities.rid) - set(regions_meta)
    assert not unknown, f"cities point at regions that do not exist: {sorted(unknown)[:10]}"


def test_city_country_matches_its_region(cities, regions_meta):
    bad = cities[cities.cc != cities.rid.map(lambda r: regions_meta[r]["cc"])]
    assert bad.empty, bad[["name", "cc", "rid"]].head()


def test_almost_all_cities_inside_a_polygon(cities):
    """Snapping is for ports/islands; if it grows, boundaries or the join broke."""
    inside = (cities.how == "inside").mean()
    assert inside > 0.99, f"only {inside:.2%} of cities are inside a region polygon"


def test_no_duplicate_cities(cities):
    assert cities.geonameid.is_unique


def test_city_count_is_plausible(cities):
    assert 150_000 < len(cities) < 200_000


ISO_OR_FALLBACK = re.compile(r"^[A-Z]{2}(-[A-Z0-9]{1,3}|-X[0-9A-F]{6})?$")


def test_region_keys_are_iso_or_documented_fallback(regions_meta):
    bad = [r for r in regions_meta if not ISO_OR_FALLBACK.match(r)]
    assert not bad, bad[:20]


def test_region_key_prefix_is_its_country(regions_meta):
    # ISO 3166-2 codes start with the country code; fallback keys are built the same way.
    bad = {r: m["cc"] for r, m in regions_meta.items() if r.split("-")[0] != m["cc"]}
    assert not bad, list(bad.items())[:20]


def test_every_country_has_regions(regions_meta, countries_meta):
    from collections import Counter
    counts = Counter(m["cc"] for m in regions_meta.values())
    for cc, meta in countries_meta.items():
        assert counts[cc] >= 1, f"{cc} has no regions"
        assert meta["regions"] == counts[cc]


def test_region_counts_for_known_countries(countries_meta):
    # Official first-level subdivision counts (ISO 3166-2). Guards against
    # a new Overture release silently merging/splitting regions.
    # ES: 17 communities + Ceuta + Melilla + "Plazas de Soberanía" islets (no ISO code -> fallback key).
    # GB: 47 English ceremonial counties (City of London in Greater London) + 32 + 22 + 11 (D36).
    # RS: 24 districts + Belgrade (Kosovo's districts are in Kosovo, D8).
    expected = {"FR": 13, "SE": 21, "DE": 16, "JP": 47, "IT": 20, "ES": 20,
                "GB": 112, "SI": 12, "MK": 8, "MT": 6, "RS": 25}
    got = {cc: countries_meta[cc]["regions"] for cc in expected}
    assert got == expected


def test_un_member_states(countries_meta):
    un = [cc for cc, m in countries_meta.items() if m["un"]]
    assert len(un) == 193
    assert countries_meta["FR"]["un"] and not countries_meta["PR"]["un"] and not countries_meta["XK"]["un"]
    assert not countries_meta["VA"]["un"]   # observer state, not a member


def test_region_names_present(regions_meta):
    assert all(m.get("name") for m in regions_meta.values())
    assert regions_meta["FR-IDF"]["name"] == "Île-de-France"
