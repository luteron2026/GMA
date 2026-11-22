// Real ground heights from USGS LiDAR (around campus) and terrain tiles (the mountains beyond).
// World space: x east, z south (campus y north = -z), y up in meters above TERRAIN.base.
import { TERRAIN } from './data/terrain.js';

function decode(b64, Type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

function grid(spec) {
  const raw = decode(spec.data, Int16Array);
  const h = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] * spec.scale;
  return { ...spec, h, x1: spec.x0 + (spec.nx - 1) * spec.step, y1: spec.y0 + (spec.ny - 1) * spec.step };
}

export const CORE = grid(TERRAIN.core);
export const OUTER = grid(TERRAIN.outer);
export const SHRUB = { ...TERRAIN.shrub, d: decode(TERRAIN.shrub.data, Uint8Array) };

// Phones use every other height sample; the mesh and the height lookups must agree
let STRIDE = 1;
export function setTerrainStride(s) {
  if ((CORE.nx - 1) % s || (CORE.ny - 1) % s) throw new Error('stride must divide the grid');
  STRIDE = s;
}
export function terrainStride() { return STRIDE; }

// Height on the detailed grid, matching how the mesh splits each cell (diagonal a-d)
function coreHeight(x, y) {
  const g = CORE, st = STRIDE, step = g.step * st;
  const cx = (g.nx - 1) / st, cy = (g.ny - 1) / st; // cells per side
  const fx = (x - g.x0) / step, fy = (y - g.y0) / step;
  const i = Math.min(cx - 1, Math.max(0, Math.floor(fx)));
  const j = Math.min(cy - 1, Math.max(0, Math.floor(fy)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
  const k = j * st * g.nx + i * st, dj = st * g.nx;
  const a = g.h[k], b = g.h[k + st], c = g.h[k + dj], d = g.h[k + dj + st];
  return u >= v ? a + (b - a) * u + (d - b) * v : a + (c - a) * v + (d - c) * u;
}

function outerHeight(x, y) {
  const g = OUTER;
  const fx = Math.min(g.nx - 1.001, Math.max(0, (x - g.x0) / g.step));
  const fy = Math.min(g.ny - 1.001, Math.max(0, (y - g.y0) / g.step));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const k = j * g.nx + i;
  const a = g.h[k], b = g.h[k + 1], c = g.h[k + g.nx], d = g.h[k + g.nx + 1];
  return u >= v ? a + (b - a) * u + (d - b) * v : a + (c - a) * v + (d - c) * u;
}

export function inCore(x, y) {
  return x >= CORE.x0 && x <= CORE.x1 && y >= CORE.y0 && y <= CORE.y1;
}

// Ground height at a campus-space point (x east, y north)
export function heightAtCampus(x, y) {
  return inCore(x, y) ? coreHeight(x, y) : outerHeight(x, y);
}

// Ground height at a world-space point (x, z)
export function groundY(x, z) {
  return heightAtCampus(x, -z);
}

// Shrub cover 0..1 at a campus-space point
export function shrubAt(x, y) {
  const s = SHRUB;
  const i = Math.floor((x - s.x0) / s.step), j = Math.floor((y - s.y0) / s.step);
  if (i < 0 || j < 0 || i >= s.nx || j >= s.ny) return 0;
  return s.d[j * s.nx + i] / 255;
}

// Slope (rise over run) of the ground at a world point
export function slopeAt(x, z, d = 2) {
  const gx = (groundY(x + d, z) - groundY(x - d, z)) / (2 * d);
  const gz = (groundY(x, z + d) - groundY(x, z - d)) / (2 * d);
  return Math.hypot(gx, gz);
}

// Roof geometry for a building id: { base, n, verts: [[x, y, z]...] (campus space), tris, pitched }
const ROOF_V = decode(TERRAIN.roofVerts, Int16Array);
const ROOF_T = decode(TERRAIN.roofTris, Uint16Array);
export function roofFor(id) {
  const r = TERRAIN.roofs[id];
  if (!r) return null;
  const [ox, oy, base, n, vo, nv, to, nt, pitched] = r;
  const verts = [];
  for (let i = 0; i < nv; i++) {
    const k = (vo + i) * 3;
    verts.push([ox + ROOF_V[k] / 10, oy + ROOF_V[k + 1] / 10, ROOF_V[k + 2] / 10]);
  }
  return { base, n, verts, tris: ROOF_T.subarray(to, to + nt), pitched: !!pitched };
}

export const TREES = TERRAIN.trees;
export const STRUCTURES = TERRAIN.structures;
