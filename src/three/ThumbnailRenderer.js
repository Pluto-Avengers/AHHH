import * as THREE from 'three'
import { siteLoader } from '../core/SiteLoader.js'
import TerrainProjection from './TerrainProjection.js'

/**
 * Renders each site's terrain once into a small transparent image for the world-map markers,
 * using one shared WebGL renderer that is freed afterwards.
 */
export default class ThumbnailRenderer {
  static WIDTH = 208 // rendered at 2x the on-map size for sharp edges
  static HEIGHT = 156
  static EXAGGERATION = 6 // relief reads better at this size

  #renderer = null
  #loader = new THREE.TextureLoader()

  /** Renders every site in turn, calling onThumb(id, dataUrl) as each finishes. */
  async renderAll(siteIds, onThumb) {
    const { WIDTH, HEIGHT } = ThumbnailRenderer
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.#renderer.setSize(WIDTH, HEIGHT)
    this.#renderer.setClearColor(0x000000, 0)
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace
    try {
      for (const id of siteIds) onThumb(id, await this.#render(id))
    } finally {
      this.#renderer.dispose()
      this.#renderer.forceContextLoss()
      this.#renderer = null
    }
  }

  async #render(id) {
    const { WIDTH, HEIGHT, EXAGGERATION } = ThumbnailRenderer
    const { grid, textureUrl } = await siteLoader.load(id)
    const texture = await this.#loader.loadAsync(textureUrl)
    texture.colorSpace = THREE.SRGBColorSpace

    const proj = new TerrainProjection(grid, EXAGGERATION)
    const terrain = proj.buildMesh(texture)
    const scene = new THREE.Scene()
    scene.add(terrain, new THREE.AmbientLight(0xffffff, 1.7))
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(-1, 1, -1)
    scene.add(sun)

    // Angled view from the south-east, framed to the terrain's size.
    const { span } = proj
    const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, span * 0.01, span * 10)
    const angle = THREE.MathUtils.degToRad(30)
    camera.position.set(Math.sin(angle) * span * 1.45, span * 0.95, Math.cos(angle) * span * 1.45)
    camera.lookAt(0, 0, 0)
    this.#renderer.render(scene, camera)

    // Bake the drop shadow into the image (a CSS filter on map markers can leave
    // ghost frames during zoom animations on some GPUs).
    const out = document.createElement('canvas')
    out.width = WIDTH
    out.height = HEIGHT
    const ctx = out.getContext('2d')
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 10
    ctx.drawImage(this.#renderer.domElement, 0, 0)

    terrain.geometry.dispose()
    terrain.material.dispose()
    texture.dispose()
    return out.toDataURL('image/png')
  }
}
