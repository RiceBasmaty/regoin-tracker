"""Checks on the published search shards and the normaliser."""
import json
import subprocess
from functools import lru_cache

import config as C
from textnorm import normalize


def shard_name(prefix):
    return prefix if prefix.isascii() and prefix.isalnum() else "x" + prefix.encode("utf-8").hex()


def resolve(q, split):
    """Mirror of shardPrefixFor() in shared/search.js."""
    n = 2
    while len(q) > n and q[:n] in split:
        n += 1
    return q[:n]


def test_manifest(manifest):
    assert manifest["v"] == C.DATA_VERSION
    assert manifest["minChars"] == C.MIN_CHARS == 2
    assert manifest["score"]["weights"] == C.KEY_WEIGHTS
    assert C.HEAD_CITIES >= manifest["maxSuggestions"]


def test_shards_are_sorted_prefixed_and_small(search_dir, manifest):
    split = set(manifest["split"])
    biggest = 0
    for f in search_dir.glob("*.json"):
        if f.name == "manifest.json":
            continue
        raw = f.read_bytes()
        biggest = max(biggest, len(raw))
        d = json.loads(raw)
        assert f.name == shard_name(d["p"]) + ".json"
        keys = [k[0] for k in d["k"]]
        assert keys == sorted(keys), f"{f.name} keys not sorted"
        assert all(k.startswith(d["p"]) for k in keys), f.name
        assert all(0 <= k[1] < len(d["c"]) for k in d["k"])
        assert all(0 <= c[2] < len(d["r"]) for c in d["c"])
    # Budget: < 100 KB uncompressed (~30 KB over the wire) keeps suggestions fast on 4G.
    assert biggest < 100_000, f"largest shard is {biggest/1e3:.0f} KB"


def test_every_city_is_findable_by_its_name(cities, search_dir, manifest):
    split = set(manifest["split"])

    @lru_cache(maxsize=None)
    def load(prefix):
        p = search_dir / f"{shard_name(prefix)}.json"
        return json.loads(p.read_text("utf-8")) if p.exists() else None

    missing = []
    for gid, name in zip(cities.geonameid, cities.name):
        q = normalize(name)
        if len(q) < C.MIN_CHARS:
            continue
        d = load(resolve(q, split))
        ids = {d["c"][k[1]][0] for k in d["k"] if k[0] == q} if d else set()
        if gid not in ids:
            missing.append(name)
    assert not missing, f"{len(missing)} cities not findable, e.g. {missing[:10]}"


def test_normalizer_matches_javascript(cities):
    """The index is built with the Python normaliser and queried with the JS one."""
    sample = cities.name.sample(20_000, random_state=1).tolist() + [
        "Île-de-France", "Göteborg", "Łódź", "N'Djamena", "İstanbul", "Москва", "東京", "ゴ", "Ærøskøbing",
        "São Paulo", "Straße", "Đà Nẵng", "Þórshöfn", "‘Ajlūn", "  New   York ", "Zürich"]
    js = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {normalize} from './shared/normalize.js';"
         "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(normalize))));"],
        input=json.dumps(sample), capture_output=True, text=True, check=True, cwd=C.ROOT).stdout
    diffs = [(s, p, j) for s, p, j in zip(sample, map(normalize, sample), json.loads(js)) if p != j]
    assert not diffs, diffs[:10]
