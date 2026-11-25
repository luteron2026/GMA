// Named places from the university's own campus map (cdn.maps.moderncampus.net, map 530:
// its markers carry lat/lon, or for a few, a spot on the illustrated map that was matched to
// the ground through the markers that have both). Campus coordinates (x east, y north, m).

// Floating labels like the buildings', for places that aren't a mapped building
// kind: 'lawn' (green), 'parking' (blue P), 'place' (brown)
export const PLACE_LABELS = [
  { name: 'Kinesiology Center', at: [-6.2, 99.8], kind: 'place', h: 8 },
  { name: 'Oaks Pavilion', sub: 'Under the Oaks', at: [6.7, -66.7], kind: 'place', h: 8.5 },
  { name: 'Louis Herwaldt Lawn', sub: 'Track & Field', at: [-11, 51], kind: 'lawn' },
  { name: 'North Campus Lawn', at: [182, 192], kind: 'lawn' },
  { name: 'RCSM Lawn', at: [235, -95], kind: 'lawn' },
  { name: 'Swixon Lawn', at: [-220, -3], kind: 'lawn' },
  { name: "Visitor's Lot", sub: 'P1', at: [-17, -33], kind: 'parking' },
  { name: 'Residence Parking', sub: 'P1', at: [-162, -54], kind: 'parking' },
  { name: 'Parking', sub: 'P2', at: [40, -8], kind: 'parking' },
  { name: 'Trophy Coffee Parking', sub: 'P2', at: [-33, 45], kind: 'parking' },
  { name: 'Reese Center Parking', at: [278, -121], kind: 'parking' },
  { name: 'North Campus Parking', at: [232, 193], kind: 'parking' },
  { name: 'Intramural Field Parking', at: [-340, -180], kind: 'parking' },
];

// LiDAR structures that are closed buildings rather than open canopies (by a point inside)
export const ENCLOSED_STRUCTURES = [
  [-6.2, 99.8], // Kinesiology Center
];
