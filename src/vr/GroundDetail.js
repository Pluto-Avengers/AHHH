import * as THREE from 'three'

/**
 * Fine world-space noise on the VR ground, so it isn't flat colour up close:
 * a tileable grey noise texture and a shader patch that multiplies it into a terrain material.
 */
export default class GroundDetail {
  /** @param {number} size texture size in pixels */
  constructor(size = 256) {
    this.texture = GroundDetail.#makeTexture(size)
  }

  /** Patches `material` so it shows this detail. */
  applyTo(material) {
    const detail = this.texture
    material.onBeforeCompile = (shader) => {
      shader.uniforms.detailMap = { value: detail }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vGroundPos;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
        float fine = texture2D(detailMap, vGroundPos.xz * 0.35).r;
        float mid = texture2D(detailMap, vGroundPos.xz * 0.04 + 0.37).r;
        diffuseColor.rgb *= 0.95 + 0.55 * (fine - 0.5) + 0.35 * (mid - 0.5);`,
        )
    }
    material.needsUpdate = true
  }

  dispose() {
    this.texture.dispose()
  }

  /** Tileable grey value noise: five octaves on a seeded random lattice. */
  static #makeTexture(size) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(size, size)
    let seed = 11
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const octave = (cells) => {
      const g = Array.from({ length: cells * cells }, rand)
      return (x, y) => {
        const fx = (x / size) * cells
        const fy = (y / size) * cells
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        const v = (i, j) => g[((j % cells) * cells + (i % cells)) | 0]
        const s = (t) => t * t * (3 - 2 * t)
        const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * s(tx)
        const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * s(tx)
        return top + (bot - top) * s(ty)
      }
    }
    const layers = [octave(4), octave(8), octave(16), octave(32), octave(64)]
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0
        let amp = 0.5
        for (const f of layers) {
          v += f(x, y) * amp
          amp *= 0.55
        }
        const g = Math.max(0, Math.min(255, Math.round(v * 255)))
        img.data.set([g, g, g, 255], (y * size + x) * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(canvas)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    return t
  }
}
