import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # import config, textnorm
import config as C  # noqa: E402


def _need(path):
    if not path.exists():
        pytest.skip(f"{path} missing - run pipeline/run_all.sh first")
    return path


@pytest.fixture(scope="session")
def cities():
    import pandas as pd
    return pd.read_parquet(_need(C.BUILD / "cities.parquet"))


@pytest.fixture(scope="session")
def regions_meta():
    return json.loads(_need(C.DIST / f"regions.v{C.DATA_VERSION}.json").read_text("utf-8"))


@pytest.fixture(scope="session")
def countries_meta():
    return json.loads(_need(C.DIST / f"countries.v{C.DATA_VERSION}.json").read_text("utf-8"))


@pytest.fixture(scope="session")
def search_dir():
    return _need(C.DIST / "search")


@pytest.fixture(scope="session")
def manifest(search_dir):
    return json.loads((search_dir / "manifest.json").read_text("utf-8"))
