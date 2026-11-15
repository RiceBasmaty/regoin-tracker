import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import versions from '../data/data-version.json' with { type: 'json' };

export const DATA_VERSION = versions.dataVersion;
export const DIST_DIR = new URL(`../dist/data/v${DATA_VERSION}/`, import.meta.url).pathname;
export const SEARCH_DIR = `${DIST_DIR}search/`;
export const indexBuilt = existsSync(join(SEARCH_DIR, 'manifest.json'));

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadShardFromDisk(file) {
  try {
    return await readJson(join(SEARCH_DIR, file));
  } catch (e) {
    if (e.code === 'ENOENT') e.notFound = true;
    throw e;
  }
}

export async function allShards() {
  const files = (await readdir(SEARCH_DIR)).filter((f) => f !== 'manifest.json');
  // Read one at a time: there are ~20k shards and parallel reads exhaust file handles.
  return files.map((f) => JSON.parse(readFileSync(join(SEARCH_DIR, f), 'utf8')));
}
