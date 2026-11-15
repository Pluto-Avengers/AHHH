import * as THREE from 'three'

/** Small seeded 3D value noise, so a texture wraps seamlessly around a sphere. */
export class ValueNoise3D {
  #perm = new Uint8Array(512)

  constructor(seed = 1337) {
    const p = Array.from({ length: 256 }, (_, i) => i)
    let s = seed
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647
      const j = s % (i + 1)
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    for (let i = 0; i < 512; i++) this.#perm[i] = p[i & 255]
  }

  #rand(x, y, z) {
    const perm = this.#perm
    return perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255
  }

  /** Smooth noise in 0..1 at a 3D point. */
  sample(x, y, z) {
    const fade = (t) => t * t * (3 - 2 * t)
    const lerp = (a, b, t) => a + (b - a) * t
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const xf = fade(x - xi)
    const yf = fade(y - yi)
    const zf = fade(z - zi)
    const c = (dx, dy, dz) => this.#rand(xi + dx, yi + dy, zi + dz)
    return lerp(
      lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
      zf,
    )
  }

  /** Fractal sum of `octaves` layers of noise. */
  fbm(x, y, z, octaves = 5) {
    let v = 0
    let amp = 0.5
    let f = 1
    for (let i = 0; i < octaves; i++) {
      v += amp * this.sample(x * f, y * f, z * f)
      amp *= 0.5
      f *= 2
    }
    return v
  }
}

const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t)
const clamp01 = (t) => Math.min(1, Math.max(0, t))

/** A procedurally generated Mars-like surface: the globe's fallback when the real texture can't load. */
export default class MarsTexture {
  static COLORS = { dust: [196, 98, 52], light: [222, 140, 84], dark: [92, 44, 28], ice: [240, 236, 230] }

  #noise = new ValueNoise3D()

  /** Colour of the surface at latitude/longitude (radians). */
  colorAt(lat, lon) {
    const { dust, light, dark, ice } = MarsTexture.COLORS
    const nx = Math.cos(lat) * Math.cos(lon)
    const ny = Math.sin(lat)
    const nz = Math.cos(lat) * Math.sin(lon)

    const base = this.#noise.fbm(nx * 2 + 5, ny * 2, nz * 2)
    const detail = this.#noise.fbm(nx * 9, ny * 9, nz * 9, 4)

    let col = mix(dust, light, clamp01((base - 0.45) * 3))
    col = mix(col, dark, clamp01((0.42 - base) * 4)) // dark albedo regions
    col = mix(col, dark, (detail - 0.5) * 0.35 + 0.1) // fine grain

    const pole = Math.abs(ny) + (detail - 0.5) * 0.08 // polar caps
    return mix(col, ice, clamp01((pole - 0.9) * 18))
  }

  /** Equirectangular canvas texture of the whole planet. */
  toTexture(width = 1024, height = 512) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(width, height)
    for (let y = 0; y < height; y++) {
      const lat = (y / height - 0.5) * Math.PI
      for (let x = 0; x < width; x++) {
        const col = this.colorAt(lat, (x / width) * Math.PI * 2)
        const i = (y * width + x) * 4
        img.data[i] = col[0]
        img.data[i + 1] = col[1]
        img.data[i + 2] = col[2]
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return texture
  }
}
