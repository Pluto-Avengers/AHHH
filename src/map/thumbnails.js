import * as THREE from 'three'
import { loadSite } from './loadSite.js'
import { buildTerrain, makeProjection } from './terrainMesh.js'

const WIDTH = 208 // rendered at 2x the on-map size for sharp edges
const HEIGHT = 156
const THUMB_EXAGGERATION = 6 // relief reads better at this size

/**
 * Renders each site's terrain once into a small transparent image, using one
 * shared WebGL renderer, then frees it. Calls onThumb(id, dataUrl) as each finishes.
 */
export async function renderThumbnails(siteIds, onThumb) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(WIDTH, HEIGHT)
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const loader = new THREE.TextureLoader()

  try {
    for (const id of siteIds) {
      const { grid, textureUrl } = await loadSite(id)
      const texture = await loader.loadAsync(textureUrl)
      texture.colorSpace = THREE.SRGBColorSpace

      const proj = makeProjection(grid, THUMB_EXAGGERATION)
      const terrain = buildTerrain(grid, proj, texture)
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

      renderer.render(scene, camera)
      // Bake the drop shadow into the image (a CSS filter on map markers can leave
      // ghost frames during zoom animations on some GPUs).
      const out = document.createElement('canvas')
      out.width = WIDTH
      out.height = HEIGHT
      const ctx = out.getContext('2d')
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
      ctx.shadowBlur = 12
      ctx.shadowOffsetY = 10
      ctx.drawImage(renderer.domElement, 0, 0)
      onThumb(id, out.toDataURL('image/png'))

      terrain.geometry.dispose()
      terrain.material.dispose()
      texture.dispose()
    }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
