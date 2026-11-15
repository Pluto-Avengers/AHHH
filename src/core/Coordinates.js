/** How coordinates are written across the app (and by Martial): 4 decimals with N/S and E/W. */
export default class Coordinates {
  static lat(v) {
    return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'N' : 'S'}`
  }

  static lon(v) {
    return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? 'E' : 'W'}`
  }

  static point(lat, lon) {
    return `${Coordinates.lat(lat)}, ${Coordinates.lon(lon)}`
  }

  /** Longitude in -180..180 (Leaflet keeps counting past the date line; some maps use 0..360 °E). */
  static wrapLon(lon) {
    if (lon >= -180 && lon <= 180) return lon
    return ((((lon + 180) % 360) + 360) % 360) - 180
  }

  /**
   * Reads a typed latitude and longitude: "18.4447 N, 77.4508 E", "18.4447, 77.4508",
   * "-4.59 137.44", "4.5°N 135.6°E". S and W (or a minus sign) mean south and west;
   * longitudes over 180 (0..360 °E) are accepted. Returns [lat, lon] or null.
   */
  static parse(text) {
    const m = String(text)
      .trim()
      .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;/\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i)
    if (!m) return null
    let lat = Number(m[1])
    let lon = Number(m[3])
    if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat)
    if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon)
    if (Math.abs(lat) > 90 || lon < -180 || lon > 360) return null
    return [lat, Coordinates.wrapLon(lon)]
  }

  /** Great-circle distance on Mars (km). */
  static distanceKm([lat1, lon1], [lat2, lon2]) {
    const R = 3389.5 // mean radius of Mars, km
    const rad = Math.PI / 180
    const dLat = (lat2 - lat1) * rad
    const dLon = (lon2 - lon1) * rad
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
  }
}
