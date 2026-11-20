// Campus layout for Grand Mustang Auto.
//
// Units are meters. Coordinates are (x = east, y = north). The world builder
// converts them to Three.js space (x, z = -y).
//
// The layout is a stylised, game-sized version of The Master's University
// in Placerita Canyon (Santa Clarita, CA). Building names come from public
// sources; positions are approximate and tuned for gameplay.

const rect = (x, y, w, h) => [
  [x - w / 2, y - h / 2],
  [x + w / 2, y - h / 2],
  [x + w / 2, y + h / 2],
  [x - w / 2, y + h / 2],
];

export const CAMPUS = {
  bounds: { minX: -340, maxX: 345, minY: -225, maxY: 300 },

  roads: [
    {
      name: 'Placerita Canyon Rd',
      width: 14,
      lanes: 2,
      pts: [[-360, -180], [-150, -178], [0, -182], [150, -178], [360, -180]],
    },
    { name: 'Main Entrance', width: 10, pts: [[40, -180], [40, -110]] },
    {
      name: 'Campus Loop',
      width: 10,
      loop: true,
      traffic: true,
      pts: [
        [-185, -110], [185, -110], [200, -95], [200, 135],
        [185, 150], [-185, 150], [-200, 135], [-200, -95],
      ],
    },
    { name: 'Canyon Homes Dr', width: 8, pts: [[194, 144], [240, 190], [292, 214]] },
    { name: 'West Lot Dr', width: 8, pts: [[-150, -110], [-150, -132]] },
    { name: 'East Lot Dr', width: 8, pts: [[110, -110], [110, -132]] },
    { name: 'Prayer Hill Trail', width: 6, dirt: true, pts: [[0, 150], [0, 225]] },
  ],

  // Flat ground patches (drawn under everything)
  lawns: [
    { kind: 'quad', poly: rect(0, 20, 150, 110) },
    { kind: 'grass', poly: rect(250, 0, 70, 240) },
    { kind: 'grass', poly: rect(-10, 195, 170, 36) },
    { kind: 'track', poly: rect(-270, -10, 66, 114) },
    { kind: 'field', poly: rect(-270, -10, 50, 96) },
    { kind: 'field', poly: rect(-268, 140, 72, 72) },
    { kind: 'diamond', poly: [[-268, 112], [-242, 138], [-268, 164], [-294, 138]] },
    { kind: 'dirt', circle: [0, 255, 34] },
    { kind: 'wash', poly: [[-360, -200], [360, -200], [360, -222], [-360, -222]] },
  ],

  lots: [
    { name: 'West Lot', poly: rect(-150, -147, 74, 30) },
    { name: 'East Lot', poly: rect(110, -147, 80, 30) },
    { name: 'Dorm Lot', poly: rect(-200, 190, 50, 30) },
  ],

  buildings: [
    {
      id: 'chapel', name: 'MacArthur Chapel', poly: rect(-20, -145, 44, 30),
      height: 12, color: 0xf2ede2, roof: 'gable', roofColor: 0xb5523b, steeple: true,
    },
    {
      id: 'dunkin', name: 'Dunkin Student Center', sub: 'Mustang Grill',
      poly: rect(0, 95, 70, 30), height: 9, color: 0xe2cfa8, roofColor: 0xb5523b, roof: 'gable',
    },
    { id: 'library', name: 'Powell Library', poly: rect(-100, 20, 36, 56), height: 11, color: 0xc98f6b },
    { id: 'reece', name: 'Reece Center', sub: 'Science & Math', poly: rect(100, 20, 36, 56), height: 13, color: 0xeadcc4 },
    { id: 'classrooms', name: 'Classroom Building', poly: rect(-70, -65, 50, 24), height: 8, color: 0xe6d6b8, roof: 'gable', roofColor: 0xb5523b },
    { id: 'offices', name: 'Faculty Offices', poly: rect(70, -65, 50, 24), height: 8, color: 0xe6d6b8, roof: 'gable', roofColor: 0xb5523b },
    { id: 'gym', name: 'Gym', poly: rect(-140, 95, 46, 36), height: 13, color: 0xd9d4c7 },
    { id: 'hotchkiss', name: 'Hotchkiss Hall', poly: rect(250, -80, 40, 22), height: 10, color: 0xf0e4cc, dorm: true },
    { id: 'dixon', name: 'Dixon Hall', poly: rect(250, -25, 40, 22), height: 10, color: 0xe8d8bd, dorm: true },
    { id: 'slight', name: 'Slight Hall', poly: rect(250, 30, 40, 22), height: 10, color: 0xf0e4cc, dorm: true },
    { id: 'sweazy', name: 'Sweazy Hall', poly: rect(250, 85, 40, 22), height: 10, color: 0xe8d8bd, dorm: true },
    { id: 'waldock', name: 'Waldock Hall', poly: rect(-70, 197, 50, 22), height: 10, color: 0xf0e4cc, dorm: true },
    { id: 'smith', name: 'C.W. Smith Hall', poly: rect(40, 197, 50, 22), height: 10, color: 0xe8d8bd, dorm: true },
    { id: 'bleachers', name: 'Herwaldt Stadium', poly: rect(-226, -10, 8, 64), height: 5, color: 0x8a95a5, label: true },
    { id: 'facilities', name: 'Facilities', poly: rect(-150, 192, 26, 20), height: 7, color: 0xb9b2a2 },
    { id: 'home1', name: 'Canyon Homes', poly: rect(262, 238, 14, 12), height: 5, color: 0xd8c3a0, roof: 'gable', roofColor: 0x8c4a3a },
    { id: 'home2', poly: rect(287, 244, 14, 12), height: 5, color: 0xcfb894, roof: 'gable', roofColor: 0x8c4a3a },
    { id: 'home3', poly: rect(312, 236, 14, 12), height: 5, color: 0xd8c3a0, roof: 'gable', roofColor: 0x8c4a3a },
    { id: 'home4', poly: rect(318, 200, 14, 12), height: 5, color: 0xcfb894, roof: 'gable', roofColor: 0x8c4a3a },
    { id: 'home5', poly: rect(266, 196, 12, 12), height: 5, color: 0xd8c3a0, roof: 'gable', roofColor: 0x8c4a3a },
  ],

  // Small round obstacles (fountain, rocks, etc.)
  props: [
    { kind: 'fountain', x: 0, y: 20, r: 5 },
    { kind: 'sign', x: 55, y: -170, r: 1.5, text: "The Master's University" },
    { kind: 'cross', x: 0, y: 268, r: 1 },
  ],

  // Named spots used by missions, spawning, and the minimap.
  places: {
    spawn: [0, 46],
    respawn: [-14, 66],
    chapelDoor: [-20, -125],
    grill: [0, 74],
    waldock: [-70, 180],
    smith: [40, 180],
    hotchkiss: [216, -80],
    hotchyard: [283, -80],
    dixon: [216, -25],
    reece: [77, 20],
    library: [-77, 20],
    stadium: [-270, -10],
    eastLot: [110, -147],
    westLot: [-150, -147],
    canyonHomes: [278, 220],
    baseball: [-232, 138],
    hillBase: [0, 165],
    hill: [0, 252],
    gym: [-140, 70],
  },
};
