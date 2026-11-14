import { useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { createMarsTexture } from '../lib/marsTexture.js'

// The same NASA Mars Trek Viking MDIM 2.1 colour mosaic the Map page uses, stitched into one
// equirectangular image by scripts/export_globe_texture.py.
const TEXTURE_URL = '/textures/mars.jpg'

const TILT = THREE.MathUtils.degToRad(25.2) // Mars axial tilt
const ZOOM_DISTANCE = 1.4 // camera distance from the centre at the end of the zoom (surface = 1)

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * Rotating Mars globe rendered with three.js.
 * `ref.current.zoomIn(ms)` turns the globe to 0°N 0°E (the centre of the Map page's view)
 * and flies the camera down to the surface; the returned promise resolves when it's done.
 */
export default function MarsGlobe({ ref }) {
  const mountRef = useRef(null)
  const zoomRef = useRef(null)

  useImperativeHandle(ref, () => ({ zoomIn: (ms) => zoomRef.current?.(ms) ?? Promise.resolve() }), [])

  useEffect(() => {
    const mount = mountRef.current
    const width = mount.clientWidth
    const height = mount.clientHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 100)
    let baseZ = 3.1
    camera.position.set(0, 0, baseZ)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.opacity = '0'
    renderer.domElement.style.transition = 'opacity 0.6s'
    mount.appendChild(renderer.domElement)

    // Planet: spins about its own axis inside a tilted group
    const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), material)
    const tilt = new THREE.Group()
    tilt.rotation.z = TILT
    tilt.add(planet)
    scene.add(tilt)

    let texture
    let disposed = false
    const applyTexture = (t) => {
      if (disposed) return t.dispose()
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = renderer.capabilities.getMaxAnisotropy()
      texture = t
      material.map = t
      material.bumpMap = t
      material.bumpScale = 0.015
      material.needsUpdate = true
      renderer.domElement.style.opacity = '1'
    }
    new THREE.TextureLoader().load(TEXTURE_URL, applyTexture, undefined, () => applyTexture(createMarsTexture()))

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.25))
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.6)
    sun.position.set(-4, 2, 3)
    scene.add(sun)

    // The canvas covers the whole hero; the globe sits at --globe-x across it (0-1) and is sized
    // as if it had --globe-w of the width. Moving it with the camera's view offset (instead of
    // resizing the canvas) keeps the zoom smooth.
    let size = { w: width, h: height, x: 0.5 }
    const placeGlobe = (x) => camera.setViewOffset(size.w, size.h, (0.5 - x) * size.w, 0, size.w, size.h)
    const resizeObserver = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      const css = getComputedStyle(mount)
      const x = parseFloat(css.getPropertyValue('--globe-x')) || 0.5
      const areaW = parseFloat(css.getPropertyValue('--globe-w')) || 1
      size = { w, h, x }
      camera.aspect = w / h
      // Pull back on narrow/tall areas so the globe isn't clipped at the sides
      baseZ = Math.max(3.1, 3.0 / ((w * areaW) / h))
      placeGlobe(x)
      renderer.setSize(w, h)
    })
    resizeObserver.observe(mount)

    // Zoom: turn 0°E to face the camera (shortest way round) and fly in
    let zoom = null
    zoomRef.current = (ms = 1600) =>
      new Promise((resolve) => {
        const from = planet.rotation.y
        const target = -Math.PI / 2 // puts longitude 0 (texture centre) towards the camera
        const delta = ((((target - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
        zoom = { start: performance.now(), ms, from, delta, tilt: tilt.rotation.z, resolve }
      })

    // Animation
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const speed = reduceMotion ? 0.02 : 0.12
    const clock = new THREE.Clock()
    let frameId
    const animate = () => {
      const dt = clock.getDelta()
      if (zoom) {
        const t = Math.min((performance.now() - zoom.start) / zoom.ms, 1)
        const e = easeInOut(t)
        planet.rotation.y = zoom.from + zoom.delta * Math.min(e * 1.6, 1)
        tilt.rotation.z = zoom.tilt * (1 - Math.min(e * 1.6, 1)) // level the equator, like the flat map
        camera.position.z = baseZ + (ZOOM_DISTANCE - baseZ) * e
        placeGlobe(size.x + (0.5 - size.x) * e) // slide to the middle of the screen
        if (t === 1 && zoom.resolve) {
          zoom.resolve()
          zoom.resolve = null
        }
      } else {
        planet.rotation.y += dt * speed
        camera.position.z = baseZ
      }
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      disposed = true
      zoomRef.current = null
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      scene.traverse((obj) => {
        obj.geometry?.dispose()
        obj.material?.dispose()
      })
      texture?.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="mars-globe" aria-label="Rotating 3D model of Mars" role="img" />
}
