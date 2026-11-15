// Panels and controls for the VR page. Everything is a flat 3D plane with a canvas-drawn texture,
// and responds to the mouse (laptop preview), a controller trigger, or a hand pinch.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import PanelPainter from './PanelPainter.js'
import { desktopLook, isDrag } from './input.js'

/**
 * A plane whose texture is drawn with the 2D canvas API. Redraws when `drawKey` changes.
 * `dynamic`: the panel redraws often (map, EVA readout), so it skips building mipmaps on every upload.
 */
export function CanvasPanel({ width, height, px = 1024, draw, drawKey, dynamic = false, sprite = false, sizeAttenuation = true, ...props }) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = px
    c.height = Math.round((px * height) / width)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    if (dynamic) {
      t.generateMipmaps = false
      t.minFilter = THREE.LinearFilter
    }
    return { canvas: c, texture: t }
  }, [px, width, height, dynamic])

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
      draw={(ctx, w, h) => new PanelPainter(ctx, w, h).button({ label, swatch, active, hovered, disabled })}
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

export const TITLE_H = 0.06
const FRAME = 0.04 // grab margin around the window (m), invisible
const START_MOVE_M = 0.012 // a hand must move this far before a pinch becomes a drag (not a jittery press)
const START_TURN_RAD = 0.035 // ... or turn this much (about 2°)
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _head = new THREE.Vector3()
const _pos = new THREE.Vector3()

/** Hands and controllers (not the laptop mouse): the window follows the hand itself. */
const isHand = (e) => Boolean(e.pointerQuaternion) && !/^(screen-|mouse)/.test(e.pointerType ?? 'mouse')

/**
 * A floating window you can move. Pinch (or click) its title bar, its empty background or the
 * invisible frame around it, and move your hand: the window follows the hand, smoothed so hand
 * tracking jitter doesn't shake it, and keeps turning to face you. A pinch that doesn't move
 * doesn't drag, so pressing near a button never nudges the window.
 * `placement` = where it starts relative to your head:
 * { angle (degrees, + = to your right), distance (m), drop (m from eye height down to the window centre) }.
 * Changing `resetKey` puts it back there (the "Bring windows to me" button).
 */
export function DraggableWindow({ title, width, height, placement, resetKey, children }) {
  const ref = useRef(null)
  const drag = useRef(null) // the pinch in progress
  const target = useRef(null) // where the window is heading (world), followed smoothly each frame
  const camera = useThree((s) => s.camera)
  const inVR = useXR((s) => !!s.session)
  const [hover, setHover] = useState(false)

  const faceHead = (g) => {
    const head = camera.getWorldPosition(_head)
    const pos = g.getWorldPosition(_pos)
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

  // Follow the drag smoothly, turning to face you as the window moves.
  useFrame((_, dt) => {
    const g = ref.current
    const t = target.current
    if (!g?.parent || !t) return
    const local = g.parent.worldToLocal(_v.copy(t))
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 22)
    g.position.lerp(local, k)
    faceHead(g)
    if (!drag.current && g.position.distanceToSquared(local) < 1e-8) target.current = null
  })

  const onDown = (e) => {
    e.stopPropagation()
    const g = ref.current
    e.target?.setPointerCapture?.(e.pointerId)
    if (desktopLook.current) desktopLook.current.enabled = false // don't also turn the view
    const windowPos = g.getWorldPosition(new THREE.Vector3())
    if (isHand(e)) {
      // Keep the window where it is relative to the hand: offset in the hand's own frame.
      const handPos = e.pointerPosition.clone()
      const handRot = e.pointerQuaternion.clone()
      const offset = windowPos.sub(handPos).applyQuaternion(handRot.clone().invert())
      drag.current = { id: e.pointerId, hand: true, handPos, handRot, offset, moving: false }
    } else {
      // Mouse: slide along the window's plane under the cursor.
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(g.getWorldQuaternion(_q))
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, e.point.clone())
      drag.current = { id: e.pointerId, hand: false, plane, offset: windowPos.sub(e.point), moving: true }
    }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    e.stopPropagation()
    if (d.hand) {
      if (!e.pointerPosition || !e.pointerQuaternion) return
      if (!d.moving) {
        const moved = e.pointerPosition.distanceTo(d.handPos) > START_MOVE_M
        const turned = e.pointerQuaternion.angleTo(d.handRot) > START_TURN_RAD
        if (!moved && !turned) return
        d.moving = true
      }
      target.current = d.offset.clone().applyQuaternion(e.pointerQuaternion).add(e.pointerPosition)
    } else {
      const hit = e.ray?.intersectPlane(d.plane, new THREE.Vector3())
      if (hit) target.current = hit.add(d.offset)
    }
  }
  const onUp = (e) => {
    if (!drag.current || e.pointerId !== drag.current.id) return
    e.target?.releasePointerCapture?.(e.pointerId)
    drag.current = null
    setTimeout(() => {
      if (desktopLook.current) desktopLook.current.enabled = true
    }, 0)
  }
  const grab = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
    onPointerOver: () => setHover(true),
    onPointerOut: () => setHover(false),
  }

  // Group origin = window centre. Title bar along the top edge.
  return (
    <group ref={ref}>
      <CanvasPanel
        width={width}
        height={TITLE_H}
        px={Math.round(width * 2000)}
        draw={(ctx, w, h) => new PanelPainter(ctx, w, h).titleBar(title, hover)}
        drawKey={`${title}|${hover}|${width}`}
        position={[0, height / 2 - TITLE_H / 2, 0.001]}
        {...grab}
      />
      {/* body: grab its empty space to move the window; it also stops clicks falling through to
          the ground behind (which would move you) */}
      <mesh position={[0, -TITLE_H / 2, -0.002]} onClick={(e) => e.stopPropagation()} {...grab}>
        <planeGeometry args={[width, height - TITLE_H]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.88} toneMapped={false} fog={false} />
      </mesh>
      {/* invisible frame: a wider target for a hand pinch than the window's edge */}
      <mesh position={[0, 0, -0.004]} {...grab}>
        <planeGeometry args={[width + FRAME * 2, height + FRAME * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} fog={false} />
      </mesh>
      {children}
    </group>
  )
}
