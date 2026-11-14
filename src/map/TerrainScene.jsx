import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { buildTerrain, makeProjection } from './terrainMesh.js'

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function routeCurve(grid, proj, cells, lift) {
  // Smooth the 8-connected staircase a little so the line reads as a path.
  const pts = cells.map((i) => [Math.floor(i / grid.cols), i % grid.cols])
  const smooth = pts.map((_, k) => {
    let r = 0
    let c = 0
    let n = 0
    for (let j = Math.max(0, k - 2); j <= Math.min(pts.length - 1, k + 2); j++) {
      r += pts[j][0]
      c += pts[j][1]
      n++
    }
    return proj.toWorld(r / n, c / n, lift)
  })
  if (smooth.length === 1) smooth.push(smooth[0].clone().add(new THREE.Vector3(0.1, 0, 0)))
  return new THREE.CatmullRomCurve3(smooth)
}

function label(text, className) {
  const el = document.createElement('div')
  el.className = className
  el.textContent = text
  return new CSS2DObject(el)
}

function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose()
    o.material?.dispose()
    if (o.isCSS2DObject) o.element.remove()
  })
  group.clear()
}

/**
 * 3D terrain of one landing site with routes, stations and click handling.
 * routes: [{ id, color, cells }]; draft: [[row, col]] points being placed.
 */
export default function TerrainScene({
  grid,
  textureUrl,
  routes,
  selectedId,
  stations,
  draft,
  drawing,
  onRouteClick,
  onTerrainClick,
  onEmptyClick,
  onReady,
}) {
  const mountRef = useRef(null)
  const ctxRef = useRef(null)
  const handlers = useRef({})
  handlers.current = { onRouteClick, onTerrainClick, onEmptyClick, drawing }

  // --- scene setup (once per site) ---------------------------------------
  useEffect(() => {
    const mount = mountRef.current
    const proj = makeProjection(grid)
    const { span } = proj

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const labels = new CSS2DRenderer()
    labels.setSize(mount.clientWidth, mount.clientHeight)
    labels.domElement.className = 'scene-labels'
    mount.appendChild(labels.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)
    scene.fog = new THREE.Fog(0x000000, span * 2, span * 5)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 1, span * 20)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.45
    controls.minDistance = span * 0.05
    controls.maxDistance = span * 2.5
    controls.enabled = false

    scene.add(new THREE.AmbientLight(0xffffff, 1.7))
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(-span, span, -span) // from the north-west, matching the texture's shading
    scene.add(sun)

    const texture = new THREE.TextureLoader().load(textureUrl, () => onReady?.())
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const terrain = buildTerrain(grid, proj, texture)
    scene.add(terrain)

    const routeGroup = new THREE.Group()
    const stationGroup = new THREE.Group()
    const draftGroup = new THREE.Group()
    scene.add(routeGroup, stationGroup, draftGroup)

    // Intro: drop from straight overhead to an angled view centred on the stations.
    const focus = new THREE.Vector3()
    for (const st of grid.stations) focus.add(proj.toWorld(st.rc[0], st.rc[1]))
    if (grid.stations.length) focus.divideScalar(grid.stations.length)
    const target = new THREE.Vector3(focus.x * 0.7, focus.y, focus.z * 0.7)
    const from = target.clone().add(new THREE.Vector3(0, span * 2.2, span * 0.01))
    const to = target.clone().add(new THREE.Vector3(0, span * 0.45, span * 0.6))
    let intro = { start: performance.now(), duration: 2400 }
    camera.position.copy(from)
    camera.lookAt(target)

    // --- picking: a click (not a drag) hits a route first, then the terrain
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let down = null
    const pick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const routeHit = raycaster.intersectObjects(routeGroup.children.filter((o) => o.userData.pick), false)[0]
      if (routeHit) return { routeId: routeHit.object.userData.routeId }
      const ground = raycaster.intersectObject(terrain, false)[0]
      return ground ? { ground: proj.toGrid(ground.point) } : {}
    }
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      down = null
      const h = handlers.current
      const hit = pick(e)
      if (h.drawing && hit.ground) h.onTerrainClick?.(hit.ground)
      else if (hit.routeId) h.onRouteClick?.(hit.routeId)
      else h.onEmptyClick?.()
    }
    const onMove = (e) => {
      if (e.buttons) return
      const hit = pick(e)
      renderer.domElement.style.cursor = handlers.current.drawing && hit.ground ? 'crosshair' : hit.routeId ? 'pointer' : ''
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)

    const resize = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      labels.setSize(w, h)
    })
    resize.observe(mount)

    let frame
    const animate = () => {
      if (intro) {
        const t = Math.min((performance.now() - intro.start) / intro.duration, 1)
        camera.position.lerpVectors(from, to, easeInOut(t))
        camera.lookAt(target)
        if (t === 1) {
          controls.target.copy(target)
          controls.enabled = true
          intro = null
        }
      }
      if (controls.enabled) controls.update()
      renderer.render(scene, camera)
      labels.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    animate()

    ctxRef.current = { proj, routeGroup, stationGroup, draftGroup }

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      controls.dispose()
      for (const g of [routeGroup, stationGroup, draftGroup]) disposeGroup(g)
      terrain.geometry.dispose()
      terrain.material.dispose()
      texture.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      mount.removeChild(labels.domElement)
      ctxRef.current = null
    }
    // onReady is only needed on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, textureUrl])

  // --- routes ------------------------------------------------------------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { proj, routeGroup } = ctx
    disposeGroup(routeGroup)
    const base = proj.span * 0.0022
    for (const route of routes) {
      if (route.cells.length < 2) continue
      const selected = route.id === selectedId
      const dimmed = selectedId && !selected
      const curve = routeCurve(grid, proj, route.cells, base * 2)
      const segments = Math.min(route.cells.length * 3, 2000)
      const radius = base * (route.thin ? 0.55 : 1) * (selected ? 1.7 : 1)
      const line = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, radius, 6),
        new THREE.MeshBasicMaterial({ color: route.color, transparent: true, opacity: dimmed ? 0.45 : 1 }),
      )
      // A wider invisible tube makes thin routes easy to click.
      const hitArea = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, base * 4, 4),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      )
      hitArea.userData = { pick: true, routeId: route.id }
      routeGroup.add(line, hitArea)
    }
  }, [grid, routes, selectedId])

  // --- stations ----------------------------------------------------------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { proj, stationGroup } = ctx
    disposeGroup(stationGroup)
    const size = proj.span * 0.004
    stations.forEach((st, k) => {
      const ground = proj.toWorld(st.rc[0], st.rc[1])
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.12, size * 0.12, size * 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      )
      pole.position.copy(ground).add(new THREE.Vector3(0, size * 3, 0))
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.8, 16, 12),
        new THREE.MeshBasicMaterial({ color: k === 0 ? 0xffffff : 0xffb27a }),
      )
      head.position.copy(ground).add(new THREE.Vector3(0, size * 6, 0))
      // Short tags in 3D; the full names are listed in the route details.
      const text = k === 0 ? (/landing/i.test(st.name) ? st.name : `${st.name} (landing)`) : `Stop ${k}`
      const tag = label(text, 'scene-label')
      tag.position.copy(head.position).add(new THREE.Vector3(0, size * 1.6, 0))
      stationGroup.add(pole, head, tag)
    })
  }, [grid, stations])

  // --- draft points while drawing a route ---------------------------------
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { proj, draftGroup } = ctx
    disposeGroup(draftGroup)
    const size = proj.span * 0.0035
    const points = draft.map(([r, c]) => proj.toWorld(r, c, size))
    points.forEach((p, k) => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color: 0x5ad1ff }))
      dot.position.copy(p)
      const tag = label(String(k + 1), 'scene-label scene-label-draft')
      tag.position.copy(p).add(new THREE.Vector3(0, size * 2.5, 0))
      draftGroup.add(dot, tag)
    })
    if (points.length > 1) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({ color: 0x5ad1ff, dashSize: size * 3, gapSize: size * 2 }),
      )
      line.computeLineDistances()
      draftGroup.add(line)
    }
  }, [grid, draft])

  return <div ref={mountRef} className="terrain-scene" />
}
