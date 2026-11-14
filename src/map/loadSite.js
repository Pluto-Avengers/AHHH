import { createGrid } from './router.js'

const base = import.meta.env.BASE_URL
const cache = new Map()

/** Loads a site's exported terrain (see scripts/export_sites.py). Cached, so each site downloads once. */
export function loadSite(id) {
  if (!cache.has(id)) {
    const promise = fetchSite(id)
    promise.catch(() => cache.delete(id)) // allow a retry after a failed download
    cache.set(id, promise)
  }
  return cache.get(id)
}

async function fetchSite(id) {
  const dir = `${base}sites/${id}/`
  const [terrain, height, slope] = await Promise.all([
    fetch(`${dir}terrain.json`).then((r) => {
      if (!r.ok) throw new Error(`Missing terrain for ${id}`)
      return r.json()
    }),
    fetch(`${dir}height.bin`).then((r) => r.arrayBuffer()),
    fetch(`${dir}slope.bin`).then((r) => r.arrayBuffer()),
  ])
  return {
    grid: createGrid(terrain, new Float32Array(height), new Uint8Array(slope)),
    textureUrl: `${dir}texture.jpg`,
  }
}
