import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Pane, Rectangle, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { renderThumbnails } from './thumbnails.js'
import { TILES } from './tiles.js'

const WORLD = [[-90, -180], [90, 180]]

// Marker: a miniature 3D render of the site's terrain once it's ready, a plain dot until then.
const siteIcon = (site, thumb) =>
  thumb
    ? L.divIcon({
        className: 'site-marker site-marker-3d',
        html: `<img src="${thumb}" alt="" width="104" height="78" /><span class="site-marker-label">${site.name}</span>`,
        iconSize: [104, 78],
        iconAnchor: [52, 46],
      })
    : L.divIcon({
        className: 'site-marker',
        html: `<span class="site-marker-dot"></span><span class="site-marker-label">${site.name}</span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

/**
 * Adds `is-moving` to the map container while it loads, zooms or pans (see the repaint guard in map.css).
 * Works around GPUs that leave ghost frames of the zoom animation on screen.
 */
function RepaintGuard() {
  const map = useMap()

  useEffect(() => {
    const el = map.getContainer()
    let timer
    const start = () => {
      clearTimeout(timer)
      el.classList.add('is-moving')
    }
    const stop = (delay = 400) => {
      clearTimeout(timer)
      timer = setTimeout(() => el.classList.remove('is-moving'), delay)
    }
    const onEnd = () => stop()
    start()
    stop(2500) // initial load: tiles and markers appear
    map.on('zoomstart movestart', start)
    map.on('zoomend moveend', onEnd)
    return () => {
      clearTimeout(timer)
      map.off('zoomstart movestart', start)
      map.off('zoomend moveend', onEnd)
      el.classList.remove('is-moving')
    }
  }, [map])

  return null
}

/** Flies to the chosen site (then calls onArrive) or back out to the whole planet. */
function FlyController({ target, onArrive }) {
  const map = useMap()
  const previous = useRef(null)

  useEffect(() => {
    const was = previous.current
    previous.current = target
    if (!target) {
      if (was) map.flyToBounds(WORLD, { duration: 1.6 })
      else map.fitBounds(WORLD, { animate: false })
      return
    }
    const arrive = () => onArrive()
    map.once('moveend', arrive)
    // Stop near the mosaic's native resolution (z7); the 3D view continues the descent.
    map.flyTo([target.lat, target.lon], 7, { duration: 2.4 })
    return () => map.off('moveend', arrive)
  }, [map, target, onArrive])

  return null
}

export default function MarsMap({ sites, target, onSelect, onArrive }) {
  const [thumbs, setThumbs] = useState({})

  useEffect(() => {
    let cancelled = false
    renderThumbnails(
      sites.map((s) => s.id),
      (id, url) => !cancelled && setThumbs((t) => ({ ...t, [id]: url })),
    ).catch(() => {}) // markers just stay as dots if WebGL or a download fails
    return () => {
      cancelled = true
    }
  }, [sites])

  const icons = useMemo(() => Object.fromEntries(sites.map((s) => [s.id, siteIcon(s, thumbs[s.id])])), [sites, thumbs])

  return (
    <MapContainer
      crs={L.CRS.EPSG4326}
      center={[0, 0]}
      zoom={1}
      minZoom={1}
      maxZoom={13}
      zoomSnap={0.25}
      maxBounds={WORLD}
      maxBoundsViscosity={1}
      zoomControl={false}
      className="mars-leaflet"
    >
      <ZoomControl position="bottomright" />
      <TileLayer url={TILES} noWrap maxNativeZoom={7} maxZoom={13} attribution="NASA Mars Trek · Viking MDIM 2.1" />

      {/* Dims the planet so the sites stand out (lighter while flying in). Its own pane sits
          between the tiles (200) and the markers (600). */}
      <Pane name="dim" style={{ zIndex: 250 }}>
        <Rectangle
          bounds={WORLD}
          interactive={false}
          pathOptions={{ stroke: false, fillColor: '#000', fillOpacity: target ? 0.1 : 0.45, className: 'dim-layer' }}
        />
      </Pane>
      <RepaintGuard />

      {sites
        .filter((site) => !target || site.id === target.id)
        .map((site) => (
          <Marker
            key={site.id}
            position={[site.lat, site.lon]}
            icon={icons[site.id]}
            keyboard
            title={site.name}
            eventHandlers={{ click: () => onSelect(site) }}
          >
            {!target && (
              <Tooltip direction="top" offset={[0, -34]} className="site-tooltip">
                <strong>{site.name}</strong>
                <br />
                {site.mission}
              </Tooltip>
            )}
          </Marker>
        ))}

      {target && <Rectangle bounds={target.bounds} pathOptions={{ color: '#ffffff', weight: 1, fill: false }} />}

      <FlyController target={target} onArrive={onArrive} />
    </MapContainer>
  )
}
