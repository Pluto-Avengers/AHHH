import TerrainGrid from './TerrainGrid.js'

/**
 * Downloads the terrain exported for each landing site (see scripts/export_sites.py).
 * Each site downloads once; a failed download can be retried.
 */
export class SiteLoader {
  #cache = new Map()

  /** @param {string} baseUrl where the site folders are served (the app's BASE_URL) */
  constructor(baseUrl) {
    this.baseUrl = baseUrl
  }

  /** Resolves to { grid: TerrainGrid, textureUrl }. */
  load(id) {
    if (!this.#cache.has(id)) {
      const promise = this.#fetch(id)
      promise.catch(() => this.#cache.delete(id)) // allow a retry after a failed download
      this.#cache.set(id, promise)
    }
    return this.#cache.get(id)
  }

  async #fetch(id) {
    const dir = `${this.baseUrl}sites/${id}/`
    const [terrain, height, slope, sky] = await Promise.all([
      fetch(`${dir}terrain.json`).then((r) => {
        if (!r.ok) throw new Error(`Missing terrain for ${id}`)
        return r.json()
      }),
      fetch(`${dir}height.bin`).then((r) => r.arrayBuffer()),
      fetch(`${dir}slope.bin`).then((r) => r.arrayBuffer()),
      // radiation shielding; a site exported before it existed counts as open sky everywhere
      fetch(`${dir}sky.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null),
    ])
    const slopes = new Uint8Array(slope)
    const skyView = sky && sky.byteLength === slopes.length ? new Uint8Array(sky) : undefined
    return {
      grid: new TerrainGrid(terrain, new Float32Array(height), slopes, skyView),
      textureUrl: `${dir}texture.jpg`,
    }
  }
}

/** The app's one loader, shared by the Map and VR pages. */
export const siteLoader = new SiteLoader(import.meta.env.BASE_URL)
