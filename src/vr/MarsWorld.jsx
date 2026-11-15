import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { XROrigin, useXR } from '@react-three/xr'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import TerrainProjection from '../three/TerrainProjection.js'
import GroundDetail from './GroundDetail.js'
import { CanvasPanel } from './ui.jsx'
import { desktopLook, isDrag } from './input.js'
import PanelPainter from './PanelPainter.js'

const SKY_HORIZON = '#c99a72' // dusty butterscotch near the horizon
const SKY_ZENITH = '#5a3b2a'
const EYE_HEIGHT = 1.7 // laptop preview only; in the headset your real height is used

// ---------------------------------------------------------------------------
// Ground, sky and rocks
// ---------------------------------------------------------------------------

function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { horizon: { value: new THREE.Color(SKY_HORIZON) }, zenith: { value: new THREE.Color(SKY_ZENITH) } },
        vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; varying vec3 vDir;
          void main() { float t = pow(clamp(vDir.y, 0.0, 1.0), 0.45); gl_FragColor = vec4(mix(horizon, zenith, t), 1.0); }`,
      }),
    [],
  )
  // Follows the camera so it is always "at infinity".
  const ref = useRef(null)
  const eye = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => ref.current?.position.copy(camera.getWorldPosition(eye)))
  return (
    <mesh ref={ref} material={material} renderOrder={-1}>
      <sphereGeometry args={[7000, 32, 16]} />
    </mesh>
  )
}

function Rocks({ grid, surface, routes }) {
  const mesh = useMemo(() => {
    let seed = 3
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const spots = []
    // Mostly near the routes (where you'll be walking), some across the whole site.
    for (const route of routes) {
      for (const i of route.cells) {
        for (let j = 0; j < 8; j++) spots.push([Math.floor(i / grid.cols), i % grid.cols, 2 + rand() * rand() * 60])
      }
    }
    for (let j = 0; j < 1500; j++) spots.push([rand() * grid.rows, rand() * grid.cols, 0])
    // Capped for the headset's GPU: the rocks are one instanced draw, but every triangle still counts.
    const count = Math.min(spots.length, 6000)
    const geo = new THREE.OctahedronGeometry(1, 0)
    const mat = new THREE.MeshLambertMaterial({ color: '#7a4a33', flatShading: true })
    const m = new THREE.InstancedMesh(geo, mat, count)
    const o = new THREE.Object3D()
    const color = new THREE.Color()
    for (let n = 0; n < count; n++) {
      const [r, c, spread] = spots[n]
      const a = rand() * Math.PI * 2
      const rr = r + (Math.sin(a) * spread) / grid.ch
      const cc = c + (Math.cos(a) * spread) / grid.cw
      const size = rand() < 0.92 ? 0.08 + rand() * 0.35 : 0.5 + rand() * 1.1
      o.position.copy(surface.toWorld(rr, cc, -size * 0.35))
      o.rotation.set(rand() * 3, rand() * 3, rand() * 3)
      o.scale.set(size * (0.8 + rand() * 0.6), size * (0.5 + rand() * 0.5), size * (0.8 + rand() * 0.6))
      o.updateMatrix()
      m.setMatrixAt(n, o.matrix)
      m.setColorAt(n, color.setHSL(0.05, 0.35 + rand() * 0.2, 0.18 + rand() * 0.14))
    }
    m.raycast = () => {} // rocks never block pinching the ground
    return m
    // only the built-in routes shape the rock field (custom routes don't reshuffle it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, surface])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )
  return <primitive object={mesh} />
}

function RouteRibbon({ surface, path, route, selected, dimmed }) {
  const geometry = useMemo(() => {
    const pts = path.pts.map(([r, c]) => surface.toWorld(r, c, route.thin ? 0.08 : 0.2))
    if (pts.length === 1) pts.push(pts[0].clone().add(new THREE.Vector3(0.1, 0, 0)))
    const curve = new THREE.CatmullRomCurve3(pts)
    const radius = (route.thin ? 0.1 : 0.3) * (selected ? 1.8 : 1)
    return new THREE.TubeGeometry(curve, Math.min(pts.length * 3, 3000), radius, 6)
  }, [surface, path, route, selected])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} raycast={() => {}}>
      <meshBasicMaterial color={route.color} transparent opacity={dimmed ? 0.35 : route.thin ? 0.6 : 0.95} toneMapped={false} />
    </mesh>
  )
}

function Beacon({ position, label, color = '#ffb27a', height = 50 }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.2, 0]} raycast={() => {}}>
        <cylinderGeometry args={[0.05, 0.05, 2.4, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 2.5, 0]} raycast={() => {}}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* tall beam: visible from far away */}
      <mesh position={[0, height / 2, 0]} raycast={() => {}}>
        <cylinderGeometry args={[0.35, 0.35, height, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      <CanvasPanel
        sprite
        width={3}
        height={0.7}
        px={512}
        draw={(ctx, w, h) => new PanelPainter(ctx, w, h).tag(label)}
        drawKey={label}
        position={[0, 3.6, 0]}
        scale={[0.09, 0.021, 1]}
        sizeAttenuation={false}
        raycast={() => {}}
      />
    </group>
  )
}

/** The landing site at true scale, with routes, stops and pinch-the-ground-to-move. */
export const MarsSurface = memo(function MarsSurface({ grid, textureUrl, surface, routes, paths, selectedId, showHazards, draft, onGroundPick }) {
  const terrain = useMemo(() => {
    const texture = new THREE.TextureLoader().load(textureUrl)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const mesh = new TerrainProjection(grid, 1).buildMesh(texture)
    new GroundDetail().applyTo(mesh.material)
    // Hand and controller pointers test the ground every frame: use the height-grid ray march
    // (VRSurface.intersectRay) instead of three.js testing all ~300,000 triangles.
    const inverse = new THREE.Matrix4()
    const local = new THREE.Ray()
    mesh.raycast = function (raycaster, intersects) {
      inverse.copy(this.matrixWorld).invert()
      local.copy(raycaster.ray).applyMatrix4(inverse)
      const hit = surface.intersectRay(local, 0, Infinity)
      if (!hit) return
      const [r, c] = surface.toGrid(hit.point.x, hit.point.z)
      const normal = surface.normalAt(r, c).transformDirection(this.matrixWorld)
      const point = hit.point.applyMatrix4(this.matrixWorld)
      const distance = raycaster.ray.origin.distanceTo(point)
      if (distance < raycaster.near || distance > raycaster.far) return
      intersects.push({ distance, point, object: this, normal, face: { a: 0, b: 0, c: 0, normal, materialIndex: 0 } })
    }
    return mesh
  }, [grid, textureUrl, surface])
  const hazards = useMemo(() => {
    const t = new THREE.CanvasTexture(grid.hazardCanvas())
    t.colorSpace = THREE.SRGBColorSpace
    const m = new THREE.Mesh(
      terrain.geometry,
      new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    m.raycast = () => {}
    return m
  }, [grid, terrain])
  useEffect(
    () => () => {
      terrain.material.map?.dispose()
      terrain.geometry.dispose()
      terrain.material.dispose()
      hazards.material.map.dispose()
      hazards.material.dispose()
    },
    [terrain, hazards],
  )

  // The plain beyond the mapped area sits at the site's typical ground height, so the data edge
  // reads as a small step instead of a cliff.
  const plainY = useMemo(() => {
    const valid = []
    for (let i = 0; i < grid.height.length; i += 7) if (grid.slope[i] !== 255) valid.push(grid.height[i])
    valid.sort((a, b) => a - b)
    return (valid[Math.floor(valid.length / 2)] ?? grid.elevation[0]) - grid.elevation[0] - 2
  }, [grid])

  const onGround = (e) => {
    if (isDrag(e)) return
    e.stopPropagation()
    onGroundPick(surface.toGrid(e.point.x, e.point.z))
  }

  return (
    <>
      <Sky />
      <fog attach="fog" args={[SKY_HORIZON, 250, 3200]} />
      <ambientLight intensity={2.3} />
      <directionalLight position={[-400, 600, -300]} intensity={1.4} />

      <primitive object={terrain} onClick={onGround} />
      {showHazards && <primitive object={hazards} />}
      {/* dusty plain beyond the mapped area, fading into the haze */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, plainY, 0]} raycast={() => {}}>
        <circleGeometry args={[12000, 64]} />
        <meshLambertMaterial color="#9a6544" />
      </mesh>

      <Rocks grid={grid} surface={surface} routes={routes.filter((r) => r.kind !== 'custom')} />

      {routes.map((route) => (
        <RouteRibbon
          key={route.id}
          surface={surface}
          path={paths[route.id]}
          route={route}
          selected={route.id === selectedId}
          dimmed={selectedId && route.id !== selectedId}
        />
      ))}

      {grid.stations.map((st, i) => (
        <Beacon
          key={st.name}
          position={surface.toWorld(st.rc[0], st.rc[1])}
          label={i === 0 ? 'Landing site' : `Stop ${i}`}
          color={i === 0 ? '#ffffff' : '#ffb27a'}
        />
      ))}
      {draft.map(([r, c], i) => (
        <Beacon key={`d${i}`} position={surface.toWorld(r, c)} label={`Point ${i + 1}`} color="#5ad1ff" height={25} />
      ))}
    </>
  )
})

// ---------------------------------------------------------------------------
// You: the rig that carries your view (and your windows) across the ground
// ---------------------------------------------------------------------------

/**
 * Moves you to `playerRef.current` = { r, c } every frame, standing on the ground.
 * In the headset the XR origin sits at your feet; in the laptop preview the camera sits at eye
 * height and dragging looks around. Writes the way you're facing into playerRef.current.heading.
 */
export function PlayerRig({ surface, playerRef, children }) {
  const rig = useRef(null)
  const { camera, gl } = useThree()
  const inVR = useXR((s) => !!s.session)
  const controls = useRef(null)

  // Laptop preview: look around by dragging (orbit around a point just in front of your eyes).
  useEffect(() => {
    if (inVR) return
    const p = playerRef.current
    const feet = surface.toWorld(p.r, p.c)
    rig.current.position.copy(feet)
    const eye = feet.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0))
    const look = new THREE.Vector3(Math.sin(p.heading ?? 0), -0.12, -Math.cos(p.heading ?? 0)).normalize()
    camera.position.copy(eye)
    const c = new OrbitControls(camera, gl.domElement)
    c.target.copy(eye).addScaledVector(look, 0.05)
    c.enableZoom = false
    c.enablePan = false
    c.rotateSpeed = -0.35 // drag the scene, like turning your head
    c.update()
    controls.current = c
    desktopLook.current = c
    return () => {
      c.dispose()
      controls.current = null
      desktopLook.current = null
    }
  }, [inVR, camera, gl, surface, playerRef])

  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const g = rig.current
    const p = playerRef.current
    if (!g || !p) return
    const feet = surface.toWorld(p.r, p.c)
    const delta = feet.sub(g.position)
    g.position.add(delta)
    if (controls.current && delta.lengthSq() > 0) {
      camera.position.add(delta)
      controls.current.target.add(delta)
      controls.current.update()
    }
    camera.getWorldDirection(dir)
    p.heading = Math.atan2(dir.x, -dir.z)
  })

  return (
    <group ref={rig}>
      <XROrigin />
      {children}
    </group>
  )
}

/** Advances a route walk every frame: `walkRef.current` = { path, s, sim, playing, speed }. */
export function Walker({ walkRef, playerRef, onArrive }) {
  useFrame((_, dt) => {
    const w = walkRef.current
    if (!w?.playing || !w.path) return
    const step = Math.min(dt, 0.1) * w.speed // simulated seconds this frame
    w.s += w.path.speedAt(w.s) * step
    w.sim += step
    if (w.s >= w.path.length) {
      w.s = w.path.length
      w.playing = false
      onArrive?.()
    }
    const at = w.path.at(w.s)
    playerRef.current.r = at.r
    playerRef.current.c = at.c
  })
  return null
}

/** Calls `onChange(session)` when you enter or leave VR. */
export function SessionWatcher({ onChange }) {
  const session = useXR((s) => s.session)
  useEffect(() => onChange(session), [session, onChange])
  return null
}
