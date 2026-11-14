"""Single place for every pinned input and output path of the data pipeline.

Bumping OVERTURE_RELEASE (and DATA_VERSION) and re-running `run_all.sh`
rebuilds everything from scratch under new, versioned file names, so a CDN
can never mix old and new data.
"""
from pathlib import Path

# ---- Pinned inputs ---------------------------------------------------------
OVERTURE_RELEASE = "2026-10-21.0"
OVERTURE_BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
OVERTURE_TYPES = ["division_area"]          # all we need for regions/countries

GEONAMES_BASE = "https://download.geonames.org/export/dump"
GEONAMES_FILES = ["cities1000.zip", "alternateNamesV2.zip", "countryInfo.txt"]
# GeoNames has no versioned releases; the download date + SHA-256 of each file
# is written to build/manifest.json so any build can be traced to its inputs.

# ---- Output versioning -----------------------------------------------------
DATA_VERSION = "2026-10"                    # appears in every published file name

# ---- Paths -----------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
PIPELINE = ROOT / "pipeline"
CACHE = PIPELINE / "cache"
OVERTURE_CACHE = CACHE / "overture" / OVERTURE_RELEASE
GEONAMES_CACHE = CACHE / "geonames"
BUILD = ROOT / "build"                       # intermediate files (not published)
DIST = ROOT / "dist" / "data" / f"v{DATA_VERSION}"   # files to upload to R2
OVERRIDES = ROOT / "data" / "region-overrides.csv"
CITY_OVERRIDES = ROOT / "data" / "city-overrides.csv"
UN_MEMBERS = ROOT / "data" / "un-member-states.txt"
TIPPECANOE = ROOT / ".tools" / "env" / "bin" / "tippecanoe"

# ---- Tunables --------------------------------------------------------------
CITY_MIN_POPULATION = 0          # cities1000 already means pop >= 1000 (or seat of admin)
COASTAL_SNAP_KM = 25             # a city just off the land polygon (port, island) snaps to the nearest region
SHARD_MAX_ENTRIES = 600          # a search shard with more keys than this is split by one more letter
SHARD_MAX_PREFIX = 12            # ...but never deeper than 12 letters
HEAD_CITIES = 40                 # cities kept in a "head" shard (query == split prefix); must be >= MAX_SUGGESTIONS
MAX_SUGGESTIONS = 8
MIN_CHARS = 2                    # suggestions start at this many (normalised) characters; 2 so 東京 / "Ub" work
# Ranking: score = population x SCORE_EXACT (query equals the whole name) x KEY_WEIGHTS[kind of name matched].
#   kinds: 0 main/English name, 1 local-language alternate, 2 foreign-language name, 3 match starts at a later word,
#          4 alternate without a language tag (variants, old romanisations)
# Examples: "paris" -> Paris FR (2.1M) before Paris TX (25k); "bath" -> Bath GB (exact, 101k x 20)
# before Bathinda (285k); "york" -> New York (8.8M x 20 x 0.2 = 35M) before York GB (156k x 20 = 3.1M).
SCORE_EXACT = 20
KEY_WEIGHTS = [1.0, 0.3, 0.1, 0.2, 0.1]
