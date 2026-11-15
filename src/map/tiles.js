// NASA Mars Trek Viking color mosaic. Trek tiles are equirectangular (EPSG:4326) and use {z}/{y}/{x}.
// Kept in its own file so the home page can preload tiles without pulling in Leaflet.
export const TILES =
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg'

/** Starts downloading the whole-planet tiles (zoom 1 and 2) so the map opens without gaps. */
export function preloadWorldTiles() {
  for (const z of [1, 2]) {
    for (let y = 0; y < 2 ** z; y++) {
      for (let x = 0; x < 2 ** (z + 1); x++) {
        new Image().src = TILES.replace('{z}', z).replace('{y}', y).replace('{x}', x)
      }
    }
  }
}
