// What the campus buildings look like, from Street View and satellite observations (written
// descriptions, no imagery copied). Shapes, heights and roofs come from LiDAR (terrain.js);
// this file only adds colors, materials, windows and details. Edit freely: anything left
// out falls back to CAMPUS_STYLE.
//
// windows: shape 'rect' | 'arched' | 'square'; size 'small' | 'medium' | 'tall' | 'storefront';
//          arrangement 'even' | 'ribbon' | 'scattered'; tint 'dark' | 'clear' | 'blue'
// piers:   stacked-stone or brick columns along the walls ('stone' | 'brick')
// porch:   entrance canopy at the door: 'gable' (timber gable on pillars), 'posts' (covered porch),
//          'deck' (wooden deck + ramp)
// extras:  balcony (2nd-floor walkway with railing), tower (bell tower + spire), stair (exterior
//          stair up the entrance wall), sign (navy campus sign: 'stone' pedestal, 'pole', 'wall'),
//          number (building number by the door), fountain (at [lat, lon] or in front of a side), pool

export const CAMPUS_STYLE = {
  wall: 0xcdb898, // tan/beige stucco
  trim: 0x4a3a2e, // dark brown window frames and fascia
  roof: 0x6e5a52, // brown asphalt shingle
  flatRoof: 0x9c968e, // gravel / membrane on flat roofs
  stone: 0x8a7f72, // stacked gray-brown stone
  brick: 0x5b3b2c, // dark brick
  timber: 0x4a3a2e, // heavy timber canopies
  sign: '#1f3a6e', // navy blue campus signs
  windows: { shape: 'rect', size: 'medium', arrangement: 'even', tint: 'dark' },
};

export const LOOKS = {
  dunkin: {
    wall: 0xcbb89a, trim: 0x4a3a2e, roof: 0xe6e6e2, stories: 2,
    windows: { shape: 'rect', size: 'storefront', arrangement: 'even', tint: 'dark' },
    piers: 'stone', porch: 'gable', balcony: { rail: 0x2b2b2b },
  },
  oaks: { roof: 0x6b5a50 },
  church: {
    wall: 0xcdb595, trim: 0x5a3e2b, roof: 0x7a6656, stories: 1,
    windows: { shape: 'rect', size: 'tall', arrangement: 'scattered', tint: 'dark' },
    stoneBase: true, porch: 'posts', tower: true,
  },
  online: {
    wall: 0xd2bc9c, trim: 0x4e3b2e, roof: 0x7b6555, stories: 2,
    windows: { shape: 'rect', size: 'medium', arrangement: 'scattered', tint: 'dark' },
    stair: { walls: false }, sign: { base: 'stone', text: 'Online Education' },
  },
  reece: {
    wall: 0xc9bfae, roof: 0xe8e8e4,
    windows: { shape: 'arched', size: 'tall', arrangement: 'even', tint: 'dark' },
  },
  library: {
    wall: 0xa88a6e, trim: 0x4a3a2e, roof: 0x6e5a50, stories: 2,
    windows: { shape: 'rect', size: 'tall', arrangement: 'even', tint: 'dark' },
    fountain: { at: [34.38200, -118.51800], bollards: true }, // central plaza, lawn and oaks around it
  },
  hotchkiss: { roof: 0x6f5c54, pool: { side: 'N' } },
  slight: { roof: 0x7c7f83 },
  chancellor: { roof: 0x6e5a52 },
  vider: { roof: 0x6b5850 },
  events: { roof: 0x6e5a52 },
  dixon: { roof: 0x735e55, fountain: { side: 'E', dist: 9 } },
  waldock: { roof: 0xa68a7a },
  education: {
    wall: 0xcdb898, trim: 0x3e3a36, roof: 0x7a6656, stories: 1,
    windows: { shape: 'rect', size: 'tall', arrangement: 'even', tint: 'dark' },
    stoneBase: true, piers: 'stone', porch: 'gable', sign: { base: 'stone', text: 'School of Education' },
  },
  engineering: {
    wall: 0xcdb898, trim: 0x3e3a36, roof: 0x7a6656, stories: 1,
    windows: { shape: 'rect', size: 'medium', arrangement: 'even', tint: 'dark' },
    stoneBase: true, sign: { base: 'pole', text: 'Engineering & Computer Science' },
  },
  sweazy: { roof: 0x735e55 },
  communication: { roof: 0x6e5a52 },
  kinesiology: {
    wall: 0xd4c2a2, trim: 0x6b4f3a, roof: 0xe8e8e4, stories: 1, topBand: true,
    windows: { shape: 'rect', size: 'medium', arrangement: 'scattered', tint: 'clear' },
    porch: 'deck', awning: 0xc8b48c, sign: { base: 'wall', text: 'Kinesiology' }, number: '27',
  },
  chapel: {
    wall: 0xcdb896, trim: 0x5a4535, roof: 0x6e5a50, stories: 2,
    windows: { shape: 'rect', size: 'medium', arrangement: 'ribbon', tint: 'dark' },
    stair: { walls: true }, number: '24',
  },
  humanities: { roof: 0x6e5a52 },
  business: { roof: 0x6b5a52 },
  biblical: {
    wall: 0xbfae8a, trim: 0x3a3532, roof: 0x6e5a52, stories: 2,
    windows: { shape: 'rect', size: 'medium', arrangement: 'even', tint: 'clear' },
    piers: 'brick', balcony: { rail: 0x1e1e1e }, courtyardWith: 'music',
  },
  music: { roof: 0x6e5a52 },
};

// The stone monument at the main entrance on Placerita Canyon Rd
export const ENTRANCE_SIGN = { stone: 0x8a7f72, letters: '#c9b38f', slats: 0x8b6a4e, text: "THE MASTER'S UNIVERSITY", size: [6, 1.5] };
