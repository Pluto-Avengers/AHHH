import { MAX_SLOPE } from './router.js'

/** Canvas (one pixel per grid cell) tinting steep ground: amber over 15°, red over the 25° limit. */
export function hazardCanvas(grid) {
  const { rows, cols, slope } = grid
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)
  for (let i = 0; i < rows * cols; i++) {
    const s = slope[i]
    if (s === 255 || s <= 15) continue
    img.data.set(s > MAX_SLOPE ? [255, 60, 40, 170] : [255, 190, 60, 110], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
