#!/usr/bin/env bash
# Rebuilds all published data from scratch and tests it.
#   pipeline/run_all.sh            full run (downloads are cached in pipeline/cache/)
#   pipeline/run_all.sh --clean    also delete previous build output first
set -euo pipefail   # stop at the first failing step
cd "$(dirname "$0")/.."
ROOT=$PWD
step() { printf '\n== %s ==  (%s)\n' "$1" "$(date +%H:%M:%S)"; }

if [ "${1:-}" = "--clean" ]; then rm -rf build dist; fi

step "1/7 tools";       pipeline/setup.sh
cd pipeline
PY="$ROOT/.venv/bin/python"
step "2/7 download";    $PY download.py
step "3/7 regions";     $PY build_regions.py
step "4/7 cities";      $PY build_cities.py > /dev/null
                        echo "report: build/cities.report.json"
                        $PY build_places.py
                        $PY build_water.py
step "5/7 map tiles";   $PY build_tiles.py
step "6/7 publish";     $PY publish.py
cd "$ROOT"
step "7/7 tests";       $PY -m pytest -q pipeline/tests
                        npm test --silent
echo; echo "Done. Upload-ready files: dist/data/"
