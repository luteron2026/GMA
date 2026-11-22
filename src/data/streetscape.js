// Streets, signs, fences, gates, neighborhood colors and street props around campus, from
// Street View observations (written descriptions, no imagery copied). Positions are
// [lat, lon] and get converted to game meters at load time, so items can be added straight
// from a map. `faces` is the direction the drivers who read a sign are heading.
// Raw notes: tools/data/streetview_streets.json

export const STREETS = {
  'Placerita Canyon Road': { center: 'double', shoulder: '#cdb995', shoulderW: 2.5, poles: 'south', lights: true },
  'Placeritos Boulevard': { center: 'double', edge: true, shoulder: '#d2c09c', shoulderW: 3, poles: 'south' },
  'Quigley Canyon Road': { center: 'none', shoulder: '#a88d68', shoulderW: 2, poles: 'west' },
  'Meadview Avenue': { center: 'none', shoulder: '#b8ad98', shoulderW: 1.8 },
  'Pepperidge Drive': { center: 'none', shoulder: '#bdb8ae', shoulderW: 0.5 },
  'Oak Orchard Road': { center: 'none', shoulder: '#a88d68', shoulderW: 1.8, poles: 'south' },
  'Amelia Lane': { center: 'none', shoulder: '#b8ad98', shoulderW: 1 },
};

// kind: stop | deadEnd | bump | pedBeacon | doNotEnter; plate: small sign under it
export const SIGNS = [
  { kind: 'stop', at: [34.38408, -118.51708], faces: 'N' },
  { kind: 'deadEnd', at: [34.38402, -118.51690], faces: 'E' },
  { kind: 'stop', at: [34.38228, -118.51762], faces: 'S' },
  { kind: 'stop', at: [34.38210, -118.51772], faces: 'N', plate: 'PRIVATE PROPERTY' },
  { kind: 'pedBeacon', at: [34.38218, -118.51742], faces: 'E' },
  { kind: 'pedBeacon', at: [34.38210, -118.51745], faces: 'W' },
  { kind: 'bump', at: [34.38216, -118.51722], faces: 'E' },
  { kind: 'doNotEnter', at: [34.38224, -118.51712], faces: 'S' },
  { kind: 'bump', at: [34.38300, -118.52175], faces: 'E' },
  { kind: 'stop', at: [34.38163, -118.51472], faces: 'N' },
];

// Painted on the road: text reads for drivers heading `faces`
export const MARKINGS = [
  { text: 'STOP', at: [34.38404, -118.51685], faces: 'W' },
  { text: 'STOP', at: [34.38232, -118.51760], faces: 'S' },
  { text: 'BUMP', at: [34.38252, -118.51900], faces: 'W' },
];

export const CROSSWALKS = [[34.38216, -118.51740], [34.38292, -118.52200]];
export const SPEED_BUMPS = [[34.38214, -118.51715], [34.38252, -118.51900], [34.38298, -118.52185]];

// Fences and walls along a street between two points, on the street side named by `side`
// (N/S/E/W; without it, the side the points are on)
// kind: blockRail | vinylRanch | pipeRail | lowWallHedge | railWindscreen | brickIron | splitRail | privacy
export const FENCES = [
  { kind: 'blockRail', side: 'S', from: [34.38300, -118.52230], to: [34.38250, -118.51880] },
  { kind: 'vinylRanch', side: 'N', from: [34.38320, -118.52350], to: [34.38270, -118.51950] },
  { kind: 'pipeRail', side: 'N', from: [34.38305, -118.52200], to: [34.38295, -118.52130] },
  { kind: 'lowWallHedge', side: 'S', from: [34.38215, -118.51830], to: [34.38210, -118.51775] },
  { kind: 'railWindscreen', side: 'W', from: [34.38232, -118.51740], to: [34.38405, -118.51712] },
  { kind: 'brickIron', from: [34.38445, -118.51990], to: [34.38420, -118.51800] },
  { kind: 'splitRail', from: [34.38410, -118.51700], to: [34.38440, -118.51680] },
  { kind: 'privacy', from: [34.38615, -118.51660], to: [34.38590, -118.51580] },
];

// Campus drive entrances: stone pillars (+ wooden rail), lanterns, signs
export const GATES = [
  { name: 'main', at: [34.38212, -118.51768], lanterns: true, plaque: true, redCurb: true, bollards: true, driveLamps: true },
  { name: 'athletic', at: [34.38224, -118.51712] },
  { name: 'west', at: [34.38292, -118.52200], directory: 'West Campus', redCurb: true },
  { name: 'north', at: [34.38405, -118.51660], lanterns: true, directory: 'North Campus' },
];

// House looks by the street they're on
export const NEIGHBORHOOD = {
  'Placerita Canyon Road': { walls: [0xe3cfa8, 0xd8b892, 0xefe8da, 0xc9b79c], roofs: [0x7a6a5a, 0x6e5f52, 0x7a6a5a, 0x6e5f52, 0xb5562e] }, // one red-tile Spanish house
  'Placeritos Boulevard': { walls: [0xf0e6d2, 0xe6cfa6, 0xefefe9, 0xc9b9a0], roofs: [0x8d8172, 0x7a6656], tudor: true },
  'Quigley Canyon Road': { walls: [0xf2efe6, 0xe3cfa8], roofs: [0x7a6a5a] },
  'Meadview Avenue': { walls: [0xe7b98a, 0xf2ece0], roofs: [0xa89a88], tudor: true },
  'Pepperidge Drive': { walls: [0xf3f2ee, 0xe3cfa8], roofs: [0x3e3f44], shutters: true },
  'Oak Orchard Road': { walls: [0xecd9b8, 0xefe8da], roofs: [0x7a6656] },
};

// Particular trees (the nearest LiDAR trees get this look) and planting
export const TREE_NOTES = [
  { kind: 'canaryPalm', at: [34.38440, -118.51955], count: 2 },
  { kind: 'fanPalm', at: [34.38158, -118.51468], count: 2 },
  { kind: 'stonePine', from: [34.38250, -118.51700], to: [34.38400, -118.51695], width: 14 },
  { kind: 'crapeMyrtle', from: [34.38432, -118.51860], to: [34.38425, -118.51780], width: 10 },
];
export const BEDS = [
  { at: [34.38295, -118.52160], r: 6, colors: ['#9a7fc4', '#b49ad6', '#6f8a4a'] }, // lavender, Education
  { at: [34.38222, -118.51700], r: 5, colors: ['#d8c23a', '#7f9a3e', '#a8b04a'], boulders: true }, // athletic lot
  { at: [34.38415, -118.51690], r: 4, colors: ['#f4f4ee', '#e8e8dc', '#6f8a4a'], boulders: true }, // white flowering
];

export const PROPS = [
  { kind: 'flagpoles', at: [34.38245, -118.51790], count: 4 },
  { kind: 'hydrant', at: [34.38209, -118.51776] },
  { kind: 'lotLights', at: [34.38225, -118.51690] },
  { kind: 'trashBins', at: [34.38428, -118.51800] },
  { kind: 'bikeRack', at: [34.38466, -118.51668] },
];
