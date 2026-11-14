#!/usr/bin/env bash
# Installs the pipeline's tools at pinned versions. Safe to re-run.
#   - Python packages from pipeline/requirements.txt into .venv/
#   - tippecanoe (map tile builder) from conda-forge into .tools/env/
# Needs: python3 >= 3.11, node >= 22, curl, tar (bzip2).
set -euo pipefail
cd "$(dirname "$0")/.."

TIPPECANOE_VERSION=2.79.0
MICROMAMBA_URL=https://conda.anaconda.org/conda-forge/linux-64/micromamba-2.10.0-0.tar.bz2

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet --disable-pip-version-check -r pipeline/requirements.txt

if [ ! -x .tools/env/bin/tippecanoe ] || ! .tools/env/bin/tippecanoe --version 2>&1 | grep -q "v$TIPPECANOE_VERSION"; then
  mkdir -p .tools
  if [ ! -x .tools/bin/micromamba ]; then
    curl -sSL "$MICROMAMBA_URL" | tar -xj -C .tools bin/micromamba
  fi
  MAMBA_ROOT_PREFIX="$PWD/.tools/mamba" .tools/bin/micromamba create -y -q -p .tools/env -c conda-forge "tippecanoe=$TIPPECANOE_VERSION"
fi
echo "tools ready: $(.tools/env/bin/tippecanoe --version 2>&1), python $(.venv/bin/python --version | cut -d' ' -f2), node $(node --version)"
