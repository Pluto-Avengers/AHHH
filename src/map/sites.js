// Landing sites shown on the Mars map.
// Each has HiRISE terrain exported to /public/sites/<id>/ by scripts/export_sites.py.
// bounds: [[south, west], [north, east]] of the 3D terrain area.

export const SITES = [
  {
    id: 'jezero',
    name: 'Jezero Crater',
    lat: 18.45,
    lon: 77.42,
    bounds: [[18.42, 77.37], [18.49, 77.465]],
    mission: 'Perseverance landed 2021',
    summary:
      'Flat crater floor next to an ancient river delta. Low elevation gives more atmosphere for braking, and the delta holds lake sediments worth sampling.',
  },
  {
    id: 'gale',
    name: 'Gale Crater',
    lat: -4.64,
    lon: 137.4,
    bounds: [[-4.7, 137.36], [-4.585, 137.443]],
    mission: 'Curiosity landed 2012',
    summary:
      'Smooth gravel plains at the foot of Mount Sharp. One of the lowest landing sites on Mars, with layered rock recording a long history of water.',
  },
  {
    id: 'gusev',
    name: 'Gusev Crater',
    lat: -14.6,
    lon: 175.5,
    bounds: [[-14.65, 175.455], [-14.55, 175.545]],
    mission: 'Spirit landed 2004',
    summary:
      'Open basalt plains rising into the Columbia Hills, where Spirit found silica deposits left by hot springs.',
  },
  {
    id: 'meridiani',
    name: 'Meridiani Planum',
    lat: -2.0,
    lon: -5.49,
    bounds: [[-2.07, -5.53], [-1.94, -5.44]],
    mission: 'Opportunity landed 2004',
    summary:
      'Some of the flattest ground on Mars, near the equator for warmth and sunlight. Impact craters expose layered sulfate rock formed in water.',
  },
]
