// Landing sites shown on the Mars map.
// Each has HiRISE terrain exported to /public/sites/<id>/ by scripts/export_sites.py.
// bounds: [[south, west], [north, east]] of the 3D terrain area.
// rover: the mission that worked there and what it collected (figures from NASA, JPL and CNSA).

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
    rover: {
      name: 'Perseverance',
      agency: 'NASA rover',
      stats: [
        ['Landed', 'Feb 18, 2021'],
        ['Status', 'Still driving'],
        ['Oxygen made by MOXIE', '122 g'],
        ['Ingenuity flights', '72'],
      ],
      collected: [
        'Sealed cores of rock and soil for a future return to Earth; 10 tubes were left in a depot on the crater floor.',
        'Rock chemistry and possible signs of ancient life from the PIXL and SHERLOC instruments.',
        'Wind, dust and temperature readings from its MEDA weather station.',
      ],
    },
  },
  {
    id: 'gale',
    name: 'Gale Crater',
    lat: -4.64,
    lon: 137.4,
    bounds: [[-4.7, 137.36], [-4.585, 137.443]],
    mission: 'Curiosity landed 2012',
    marker: 'below', // Elysium Planitia sits just north on the world map
    summary:
      'Smooth gravel plains at the foot of Mount Sharp. One of the lowest landing sites on Mars, with layered rock recording a long history of water.',
    rover: {
      name: 'Curiosity',
      agency: 'NASA rover',
      stats: [
        ['Landed', 'Aug 6, 2012'],
        ['Status', 'Still driving'],
        ['Surface radiation', '0.21 mGy a day'],
        ['Climbing', 'Mount Sharp'],
      ],
      collected: [
        'Drilled rock powder showing Gale once held a lake that could have supported microbes.',
        'Organic molecules preserved in 3-billion-year-old mudstone.',
        'Radiation dose on the surface, the measurement used to plan safe crewed missions.',
      ],
    },
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
    rover: {
      name: 'Spirit',
      agency: 'NASA rover',
      stats: [
        ['Landed', 'Jan 4, 2004'],
        ['Last contact', 'Mar 22, 2010'],
        ['Distance driven', '7.73 km'],
        ['Planned mission', '90 sols'],
      ],
      collected: [
        'Nearly pure silica soil at Home Plate, left by hot springs or steam vents.',
        'Carbonate-rich rock in the Columbia Hills, a sign of once-neutral water.',
        'Chemistry of the volcanic basalt that covers the plains.',
      ],
    },
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
    rover: {
      name: 'Opportunity',
      agency: 'NASA rover',
      stats: [
        ['Landed', 'Jan 25, 2004'],
        ['Last contact', 'Jun 10, 2018'],
        ['Distance driven', '45.16 km'],
        ['Planned mission', '90 sols'],
      ],
      collected: [
        'Hematite “blueberries” and layered rock at Eagle crater that formed in water.',
        'Gypsum veins at Endeavour crater, left by water flowing through cracks.',
        'Meteorites lying on the plains, the first found on another planet.',
      ],
    },
  },
  {
    id: 'ares',
    name: 'Ares Vallis',
    lat: 19.12,
    lon: -33.25,
    bounds: [[19.07, -33.3], [19.17, -33.195]],
    mission: 'Mars Pathfinder landed 1997',
    summary:
      'Rocky flood plain at the mouth of Ares Vallis, where ancient floods dropped boulders. Twin Peaks stand about 1 km southwest of the lander.',
    rover: {
      name: 'Sojourner',
      agency: 'NASA rover, with the Pathfinder lander',
      stats: [
        ['Landed', 'Jul 4, 1997'],
        ['Last contact', 'Sep 27, 1997'],
        ['Distance driven', 'About 100 m'],
        ['Images sent', 'About 17,000'],
      ],
      collected: [
        'Rock chemistry from its APXS spectrometer, including the rocks Barnacle Bill and Yogi.',
        'Over 550 rover images and 16,500 lander images of the flood plain.',
        'Temperature, pressure and wind from the lander’s weather mast.',
      ],
    },
  },
  {
    id: 'elysium',
    name: 'Elysium Planitia',
    lat: 4.5,
    lon: 135.605,
    bounds: [[4.44, 135.565], [4.56, 135.645]],
    mission: 'InSight landed 2018',
    marker: 'above-right', // between Gale (south) and Utopia (north-west) on the world map
    summary:
      'Smooth lava plain near the equator, chosen for InSight because it is one of the flattest, safest places on Mars to land.',
    rover: {
      name: 'InSight',
      agency: 'NASA lander (no rover)',
      stats: [
        ['Landed', 'Nov 26, 2018'],
        ['Last contact', 'Dec 15, 2022'],
        ['Marsquakes recorded', '1,319'],
        ['Largest quake', 'Magnitude 5'],
      ],
      collected: [
        'Seismic readings that measured the size of Mars’s core and the thickness of its crust.',
        'Daily wind, temperature and air pressure for four years.',
        'Close to 7,000 images of the lander’s surroundings.',
      ],
    },
  },
  {
    id: 'utopia',
    name: 'Utopia Planitia',
    lat: 25.05,
    lon: 109.92,
    bounds: [[25.01, 109.875], [25.1, 109.975]],
    mission: 'Zhurong landed 2021',
    marker: 'above', // keeps clear of Jezero and Elysium on the world map
    summary:
      'Southern edge of Utopia Planitia, a huge lowland that may once have held an ocean. Zhurong drove south from its lander.',
    rover: {
      name: 'Zhurong',
      agency: 'CNSA rover (Tianwen-1)',
      stats: [
        ['Landed', 'May 14, 2021'],
        ['Last active', 'May 20, 2022'],
        ['Distance driven', '1,921 m'],
        ['Planned mission', '90 sols'],
      ],
      collected: [
        'Ground-penetrating radar profiles of layers buried under the plain.',
        'Salty, hardened crusts on the surface, a sign of past water.',
        'Images and weather readings along its drive south.',
      ],
    },
  },
]
