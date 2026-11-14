import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createMarsTexture } from '../lib/marsTexture.js'

/**
 * Rotating Mars globe rendered with three.js.
 * The surface texture is generated procedurally (no external image needed).
 * To use a real NASA texture later, swap `createMarsTexture()` for
 * `new THREE.TextureLoader().load('/textures/mars.jpg')`.
 */
export default function MarsGlobe() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    const width = mount.clientWidth
    const height = mount.clientHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
    camera.position.set(0, 0, 3.1)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    // Planet
    const texture = createMarsTexture()
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 96),
      new THREE.MeshStandardMaterial({
        map: texture,
        bumpMap: texture,
        bumpScale: 0.02,
        roughness: 1,
        metalness: 0,
      }),
    )
    planet.rotation.z = THREE.MathUtils.degToRad(25.2) // Mars axial tilt
    const spinner = new THREE.Group()
    spinner.add(planet)
    scene.add(spinner)

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.15))
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.6)
    sun.position.set(-4, 2, 3)
    scene.add(sun)

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      // Pull back on narrow/tall containers so the globe isn't clipped at the sides
      camera.position.z = Math.max(3.1, 3.0 / camera.aspect)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    resizeObserver.observe(mount)

    // Animation
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const speed = reduceMotion ? 0.02 : 0.12
    const clock = new THREE.Clock()
    let frameId
    const animate = () => {
      planet.rotation.y += clock.getDelta() * speed
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      scene.traverse((obj) => {
        obj.geometry?.dispose()
        obj.material?.dispose()
      })
      texture.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="mars-globe" aria-label="Rotating 3D model of Mars" role="img" />
}
