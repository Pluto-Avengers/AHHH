// Panels and controls for the VR page. Everything is a flat 3D plane with a canvas-drawn texture,
// and responds to the mouse (laptop preview), a controller trigger, or a hand pinch.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { drawButton, drawTitleBar } from './draw.js'
import { desktopLook, isDrag } from './input.js'

/** A plane whose texture is drawn with the 2D canvas API. Redraws when `drawKey` changes. */
export function CanvasPanel({ width, height, px = 1024, draw, drawKey, sprite = false, sizeAttenuation = true, ...props }) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = px
    c.height = Math.round((px * height) / width)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return { canvas: c, texture: t }
  }, [px, width, height])

  useLayoutEffect(() => {
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    draw(ctx, canvas.width, canvas.height)
    texture.needsUpdate = true
    // redraw only when what's shown changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey, canvas, texture])

  useEffect(() => () => texture.dispose(), [texture])

  if (sprite) {
    return (
      <sprite {...props}>
        <spriteMaterial map={texture} transparent toneMapped={false} fog={false} sizeAttenuation={sizeAttenuation} />
      </sprite>
    )
  }
  return (
    <mesh {...props}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} fog={false} />
    </mesh>
  )
}

/** A button you pinch (hands), pull the trigger on (controller) or click (mouse). */
export function VRButton({ label, swatch, active, disabled, onClick, width = 0.2, height = 0.05, ...props }) {
  const [hovered, setHovered] = useState(false)
  return (
    <CanvasPanel
      width={width}
      height={height}
      px={Math.round(width * 2400)}
      draw={(ctx, w, h) => drawButton(ctx, w, h, { label, swatch, active, hovered, disabled })}
      drawKey={`${label}|${swatch}|${active}|${hovered}|${disabled}|${width}`}
      userData={{ label }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled && !isDrag(e)) onClick?.()
      }}
      {...props}
    />
  )
}

/** Lays buttons out left to right, `gap` meters apart, centred on x = 0. */
export function ButtonRow({ y, gap = 0.01, buttons }) {
  const total = buttons.reduce((s, b) => s + (b.width ?? 0.2), 0) + gap * (buttons.length - 1)
  let x = -total / 2
  return buttons.map(({ key, width = 0.2, ...b }) => {
    const cx = x + width / 2
    x += width + gap
    return <VRButton key={key} width={width} position={[cx, y, 0.001]} {...b} />
  })
}

const TITLE_H = 0.05
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

/**
 * A floating window you can move: pinch (or click) its title bar and drag. It turns to face you
 * when you let go. `placement` = where it starts relative to your head:
 * { angle (degrees, + = to your right), distance (m), drop (m from eye height down to the window centre) }.
 * Changing `resetKey` puts it back there (the "Bring windows to me" button).
 */
export function DraggableWindow({ title, width, height, placement, resetKey, children }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const camera = useThree((s) => s.camera)
  const inVR = useXR((s) => !!s.session)
  const [hover, setHover] = useState(false)

  const faceHead = (g) => {
    const head = camera.getWorldPosition(new THREE.Vector3())
    const pos = g.getWorldPosition(new THREE.Vector3())
    g.rotation.set(0, Math.atan2(head.x - pos.x, head.z - pos.z), 0)
  }

  // Place in front of the user's head on mount and on reset. Waits a couple of frames so the
  // camera (and in VR, the headset pose) is already where you're standing.
  const pending = useRef(0)
  useEffect(() => {
    pending.current = 3
  }, [resetKey])
  useFrame(() => {
    if (pending.current === 0) return
    if (--pending.current > 0) return
    const g = ref.current
    if (!g?.parent) return
    const head = camera.getWorldPosition(new THREE.Vector3())
    const dir = camera.getWorldDirection(new THREE.Vector3())
    const f = new THREE.Vector3(dir.x, 0, dir.z)
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1)
    f.normalize()
    const right = new THREE.Vector3(-f.z, 0, f.x)
    const a = THREE.MathUtils.degToRad(placement.angle)
    // Laptop preview has a narrow field of view, so the windows sit farther out there.
    const distance = placement.distance * (inVR ? 1 : 1.9)
    const world = head
      .clone()
      .addScaledVector(f, distance * Math.cos(a))
      .addScaledVector(right, distance * Math.sin(a))
    world.y = head.y - placement.drop
    g.parent.updateWorldMatrix(true, false)
    g.position.copy(g.parent.worldToLocal(world))
    faceHead(g)
  })

  const onDown = (e) => {
    e.stopPropagation()
    const g = ref.current
    e.target?.setPointerCapture?.(e.pointerId)
    if (desktopLook.current) desktopLook.current.enabled = false // don't also turn the view
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(g.getWorldQuaternion(_q))
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, e.point.clone())
    drag.current = { id: e.pointerId, plane, offset: g.getWorldPosition(_v).clone().sub(e.point) }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    e.stopPropagation()
    const hit = e.ray?.intersectPlane(d.plane, new THREE.Vector3())
    if (!hit) return
    const g = ref.current
    g.position.copy(g.parent.worldToLocal(hit.add(d.offset)))
  }
  const onUp = (e) => {
    if (!drag.current || e.pointerId !== drag.current.id) return
    e.target?.releasePointerCapture?.(e.pointerId)
    drag.current = null
    faceHead(ref.current)
    setTimeout(() => {
      if (desktopLook.current) desktopLook.current.enabled = true
    }, 0)
  }

  // Group origin = window centre. Title bar along the top edge.
  return (
    <group ref={ref}>
      <CanvasPanel
        width={width}
        height={TITLE_H}
        px={Math.round(width * 2000)}
        draw={(ctx, w, h) => drawTitleBar(ctx, w, h, title, hover)}
        drawKey={`${title}|${hover}|${width}`}
        position={[0, height / 2 - TITLE_H / 2, 0.001]}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      />
      {/* body: swallows clicks so they don't fall through to the ground behind and move you */}
      <mesh position={[0, -TITLE_H / 2, -0.002]} onClick={(e) => e.stopPropagation()}>
        <planeGeometry args={[width, height - TITLE_H]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.88} toneMapped={false} fog={false} />
      </mesh>
      {children}
    </group>
  )
}
