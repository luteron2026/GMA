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
// siding:  'lap' (horizontal boards) or 'batten' (vertical board and batten) instead of stucco
// bay:     color of a dark panel running floor to floor behind each window (the dorms)
// ac:      a window AC unit under each window; floorBand: a trim band at each floor line
// windows.frame: frame color when it differs from the trim (white vinyl frames)
// arcade:  tall stucco arches standing out from both long walls over a walkway (Reese Center)

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
  // Tan stucco and dark-framed storefront glass; the Mustang Grill's deck, its timber gable
  // pavilion, the pergola and the stone piers are built in grill.js
  dunkin: {
    wall: 0xd2bd98, trim: 0x3e2f25, roof: 0xe6e6e2, stories: 2,
    windows: { shape: 'rect', size: 'storefront', arrangement: 'even', tint: 'dark' },
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
    // the round stone fountain on the plaza in front of Rutherford's entrance (placed on the
    // aerial photo; its look and the flagpole beside it from the campus map's photos)
    fountain: { at: [34.382016, -118.518230], style: 'stone', plaza: 7, flag: { angle: 2.9 } },
  },
  // The pool north of Hotchkiss, measured on the USDA aerial photo: the water (13.7 x 6.3 m),
  // the deck from the pool house at its west end to the trees on the east, with the wide side
  // and its shade canopy toward Placerita (pool frame: u along the pool, v across it)
  hotchkiss: {
    roof: 0x6f5c54,
    pool: { at: [34.382082, -118.519756], size: [13.7, 6.3], heading: -11.3, deck: [-16.1, 8.6, -4.8, 10.4], shade: [-14.6, 7.2, 6.9, 10.0], gate: [-10, -4.8], open: 'W' },
  },
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

// From the photos on the university's own campus map (cdn.maps.moderncampus.net map 530),
// written down by hand. These refine or fill in the Street View notes above.
const FROM_PHOTOS = {
  // Dorms: two stories of tan stucco or beige lap siding, every window in a dark brown panel
  // that runs floor to floor, a window AC unit under each one
  hotchkiss: { wall: 0xc8ad86, trim: 0x4a3a2e, bay: 0x5a4434, ac: true, stories: 2 },
  slight: { wall: 0xcdb48e, trim: 0x4a3528, ac: true, stories: 2, balcony: { rail: 0x2b2b2b } },
  dixon: { wall: 0xcdbb98, trim: 0x4a3a2e, siding: 'lap', bay: 0x5a4434, ac: true, stories: 2 },
  sweazy: { wall: 0xcdbb98, trim: 0x4a3a2e, siding: 'lap', bay: 0x5a4434, ac: true, stories: 2 },
  waldock: { wall: 0x9e958a, trim: 0x3e352e, siding: 'lap', floorBand: 0x4a3a2e, stories: 3, windows: { shape: 'rect', size: 'medium', arrangement: 'even', tint: 'dark' } },
  smith: { wall: 0xc3b8a6, trim: 0x5a4535, stories: 3, stoneBase: true, windows: { shape: 'rect', size: 'small', arrangement: 'scattered', tint: 'blue' } },
  // The Reese Center: sand-colored stucco, and its row of tall arches over a second-floor
  // walkway with a wood railing along both long sides
  reece: { wall: 0xcbb48e, trim: 0x6b4f3a, arcade: { rail: 0x7a5a3a } },
  // Ranch-style houses and offices under the oaks
  chancellor: { wall: 0xb59e72, trim: 0x3a2e26, siding: 'batten', stories: 1, windows: { shape: 'rect', size: 'tall', arrangement: 'even', tint: 'dark' } },
  vider: { wall: 0xa9a284, trim: 0x5a4a3a, siding: 'lap', stories: 1, windows: { shape: 'rect', size: 'medium', arrangement: 'scattered', tint: 'dark', frame: 0xf2f0ea } },
  events: { wall: 0xe6dcc0, trim: 0x5a3e2e, siding: 'lap', stories: 1, porch: 'gable', windows: { shape: 'rect', size: 'medium', arrangement: 'even', tint: 'clear' } },
  oaks: { wall: 0xe8dcb0, trim: 0x4a3a2e, siding: 'lap', stoneBase: true, stories: 1, windows: { shape: 'rect', size: 'storefront', arrangement: 'even', tint: 'dark' } },
  king: { wall: 0xcdb896, trim: 0x4a3a2e, stoneBase: true, windows: { shape: 'rect', size: 'tall', arrangement: 'scattered', tint: 'dark' } },
  // The modular offices: beige panel siding, brown trim, wooden steps
  itadmin: { wall: 0xd2c4a0, trim: 0x5a4535, siding: 'batten', windows: { shape: 'rect', size: 'medium', arrangement: 'scattered', tint: 'dark' } },
  wismer: { wall: 0xdccfa8, trim: 0x4a3a2e, siding: 'batten', windows: { shape: 'rect', size: 'medium', arrangement: 'scattered', tint: 'dark' } },
  ods: { wall: 0xd2c4a0, trim: 0x5a3e2e, siding: 'batten', windows: { shape: 'rect', size: 'medium', arrangement: 'even', tint: 'dark', frame: 0x5a3e2e } },
  kinesiology: { wall: 0xcdbf9e, siding: 'batten' },
  // Powell Library: tan stucco, stacked-stone piers, a timber gable over the door
  library: { wall: 0xd2bd92, piers: 'stone', porch: 'gable' },
  // The Plew music building around the recital hall: yellow-tan stucco, brick pilasters with
  // cypress between them, a second-floor walkway with a black railing
  // North Campus: the Business Center's stacked-stone entrance piers, black-railed upper walkway
  // and navy sign; the Stead Center's warm tan stucco (its walk-up Trophy North window is in
  // trophy.js)
  business: { wall: 0xcaa978, trim: 0x4a3a2e, piers: 'stone', balcony: { rail: 0x1e1e1e }, stories: 2, sign: { base: 'wall', text: 'School of Business & Communication' } },
  humanities: { wall: 0xd0b483, trim: 0x4a3a2e, stories: 2 },
  music: { wall: 0xd6bf8a, trim: 0x5a3e2e, piers: 'brick', balcony: { rail: 0x1e1e1e }, stories: 2 },
};
for (const [id, look] of Object.entries(FROM_PHOTOS)) LOOKS[id] = { ...(LOOKS[id] || {}), ...look };

// The stone monument at the main entrance on Placerita Canyon Rd
export const ENTRANCE_SIGN = { stone: 0x8a7f72, letters: '#c9b38f', slats: 0x8b6a4e, text: "THE MASTER'S UNIVERSITY", size: [6, 1.5] };
