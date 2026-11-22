"""Turn USGS LiDAR + terrain tiles into src/data/terrain.js: real hills, trees and roof shapes.

Usage (from the repo root; needs `pip install 'laspy[lazrs]' numpy scipy shapely pillow`):
    python3 tools/fetch_lidar.py /tmp/lidar.npz
    python3 tools/lidar_to_terrain.py /tmp/lidar.npz src/data/campus.js src/data/terrain.js

Run tools/osm_to_campus.py first: roof shapes are keyed by the building ids in campus.js.

Sources (both public domain):
  - USGS 3DEP LiDAR, CA_LosAngeles_1_B23 (via the usgs-lidar-public Entwine index): ground
    model, tree positions/heights/crowns, shrub cover and roof shapes around campus.
  - Terrain Tiles on AWS (Mapzen/Tilezen terrarium, from USGS 3DEP 1/3" DEM): the mountains
    beyond the LiDAR area.
"""
import sys, json, re, math, base64, io, os, urllib.request
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import Polygon, Point, LineString
from shapely import contains_xy
from shapely.ops import unary_union
from PIL import Image

LIDAR, CAMPUS_JS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
CACHE = os.environ.get('TILE_CACHE', '/tmp/terrain-tiles')

# ---------------------------------------------------------------- inputs
src = open(CAMPUS_JS).read()
body = src[src.index('{'):src.rindex('}') + 1]
body = re.sub(r'^(\s+)(\w+):', r'\1"\2":', body, flags=re.M)
body = re.sub(r',(\s*[\]}])', r'\1', body)
C = json.loads(body)
LAT0, LON0 = C['origin']
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574

P = np.load(LIDAR)['pts']
X0, Y0, X1, Y1 = -470, -395, 410, 385  # LiDAR area (tools/fetch_lidar.py AREA)
W, H = X1 - X0, Y1 - Y0
px, py, pz = P[:, 0], P[:, 1], P[:, 2]
cls, rn, nr = P[:, 3].astype(int), P[:, 4].astype(int), P[:, 5].astype(int)
ix = np.clip((px - X0).astype(int), 0, W - 1)
iy = np.clip((py - Y0).astype(int), 0, H - 1)
gnd = cls == 2

# ---------------------------------------------------------------- 1 m ground model
s = np.zeros((H, W)); n = np.zeros((H, W))
np.add.at(s, (iy[gnd], ix[gnd]), pz[gnd]); np.add.at(n, (iy[gnd], ix[gnd]), 1)
have = n > 0
dtm = np.where(have, s / np.maximum(n, 1), 0)
idx = ndi.distance_transform_edt(~have, return_distances=False, return_indices=True)
dtm = ndi.gaussian_filter(dtm[idx[0], idx[1]], 0.8).astype(np.float32)
BASE = float(math.floor(dtm.min()))

def dtm_at(x, y):
    """Bilinear sample of the 1 m DTM (cell centers at X0 + i + 0.5)."""
    fx = np.clip(np.asarray(x) - X0 - 0.5, 0, W - 1.001); fy = np.clip(np.asarray(y) - Y0 - 0.5, 0, H - 1.001)
    i, j = fx.astype(int), fy.astype(int); u, v = fx - i, fy - j
    return (dtm[j, i] * (1 - u) * (1 - v) + dtm[j, i + 1] * u * (1 - v) + dtm[j + 1, i] * (1 - u) * v + dtm[j + 1, i + 1] * u * v)

# Above-ground heights per point, and a 1 m canopy model
above = ~gnd
hag = pz - dtm[iy, ix]
dsm = np.full((H, W), -np.inf, np.float32)
np.maximum.at(dsm, (iy[above], ix[above]), pz[above])
chm = np.where(np.isfinite(dsm), np.maximum(dsm - dtm, 0), 0).astype(np.float32)
# Vegetation scatters the pulse into several returns; roofs, cars and walls give one
up = above & (hag > 0.4)
multi = np.zeros((H, W)); cnt = np.zeros((H, W))
np.add.at(cnt, (iy[up], ix[up]), 1); np.add.at(multi, (iy[up], ix[up]), (nr[up] > 1).astype(float))
multi_s = ndi.uniform_filter(multi, 3) / np.maximum(ndi.uniform_filter(cnt, 3), 1e-6)

yy, xx = np.mgrid[0:H, 0:W]
cx_, cy_ = xx + X0 + 0.5, yy + Y0 + 0.5
bpolys = {b['id']: Polygon(b['poly']) for b in C['buildings']}
bunion = unary_union(list(bpolys.values()))
in_bld = contains_xy(bunion.buffer(1.0), cx_, cy_)

roads, drive = [], []
for r in C['roads']:
    g = LineString(r['pts']).buffer(r['width'] / 2)
    roads.append(g)
    if r['kind'] not in ('path', 'trail'): drive.append(g)
drive += [Polygon(l['poly']) for l in C['lots']]
road_mask = contains_xy(unary_union(roads), cx_, cy_)
drive_mask = contains_xy(unary_union(drive).buffer(0.8), cx_, cy_)
ddist, (dj, di) = ndi.distance_transform_edt(drive_mask, return_indices=True)

veg = (chm > 0.4) & (multi_s > 0.25) & ~in_bld
veg = ndi.binary_opening(veg, iterations=1) | (veg & (chm > 3))

# ---------------------------------------------------------------- trees
tchm = np.where(veg, chm, 0)
sm = ndi.gaussian_filter(tchm, 1.0)
peaks = (sm == ndi.maximum_filter(sm, size=5)) & (sm > 2.6)
# Tall trees have wide crowns: drop peaks that sit inside a taller neighbour's crown
lab, nlab = ndi.label(peaks)
pk = np.array(ndi.center_of_mass(peaks, lab, range(1, nlab + 1))).astype(int)
order = np.argsort(-sm[pk[:, 0], pk[:, 1]])
kept = []
for k in order:
    j, i = pk[k]
    h = sm[j, i]
    ok = True
    for (j2, i2, h2) in kept[-400:]:
        if h2 >= h and math.hypot(i - i2, j - j2) < max(2.2, 0.22 * h2):
            ok = False; break
    if ok: kept.append((j, i, h))
markers = np.zeros((H, W), np.int32)
for k, (j, i, h) in enumerate(kept, 1): markers[j, i] = k
# Grow crowns over vegetation cells above 40% of the local peak
dist, (mj, mi) = ndi.distance_transform_edt(markers == 0, return_indices=True)
owner = markers[mj, mi]
peak_h = np.zeros(len(kept) + 1); peak_h[1:] = [k[2] for k in kept]
crown = veg & (tchm > 0.4 * peak_h[owner]) & (dist < 9)
area = ndi.sum(crown, owner, range(1, len(kept) + 1))
veg_pts = up & veg[iy, ix]
trees = []
pt_owner = np.where(crown[iy, ix] & veg_pts, owner[iy, ix], 0)
order_pts = np.argsort(pt_owner)
bounds = np.searchsorted(pt_owner[order_pts], np.arange(len(kept) + 2))
for k, (j, i, h) in enumerate(kept, 1):
    a = area[k - 1]
    r = math.sqrt(max(a, 1) / math.pi)
    sel = order_pts[bounds[k]:bounds[k + 1]]
    hs = hag[sel]
    hs = hs[hs > 1.0]
    if len(hs) < 6: continue
    top = float(np.percentile(hs, 99))
    cb = float(np.percentile(hs, 8)) / top  # crown base as a fraction of height
    x, y = X0 + i + 0.5, Y0 + j + 0.5
    if top < 2.8 or r < 0.9: continue
    # 0 broadleaf (oaks, sycamores, ficus), 1 palm, 2 conifer (pines, cedars, cypress)
    if cb > 0.62 and r < 3.6 and top > 7: kind = 1
    elif r / top < 0.24 and cb < 0.35 and top > 7: kind = 2
    else: kind = 0
    # A crown over a street or parking lot: put the trunk on the nearest curb, or drop it
    tx, ty = x, y
    if drive_mask[j, i]:
        if ddist[j, i] > r + 0.5: continue
        tx, ty = X0 + di[j, i] + 0.5, Y0 + dj[j, i] + 0.5
    trees.append([round(tx, 1), round(ty, 1), round(top, 1), round(min(r, 10), 1), kind, round(cb, 2), round(x - tx, 1), round(y - ty, 1)])
print('trees', len(trees), 'palms', sum(t[4] == 1 for t in trees), 'conifers', sum(t[4] == 2 for t in trees), file=sys.stderr)

# Shrub cover (chaparral, hedges) at 4 m for the ground texture and bush scatter
shrub = veg & ~crown & (chm < 3.5)
SH = 4
shr = shrub[:H // SH * SH, :W // SH * SH].reshape(H // SH, SH, W // SH, SH).mean((1, 3))
shr_b = np.clip(shr * 255, 0, 255).astype(np.uint8)

# ---------------------------------------------------------------- structures LiDAR sees but OSM doesn't
hard = (chm > 2.4) & (multi_s < 0.15) & ~in_bld & ~veg & ~road_mask
hard = ndi.binary_opening(hard, iterations=1)
lab, nl = ndi.label(hard)
structures = []
for k, sl in enumerate(ndi.find_objects(lab), 1):
    m = lab[sl] == k
    a = m.sum()
    if a < 14 or a > 900: continue
    js, is_ = np.nonzero(m)
    pts = [(X0 + sl[1].start + i + 0.5, Y0 + sl[0].start + j + 0.5) for j, i in zip(js, is_)]
    poly = unary_union([Point(p).buffer(0.71, cap_style=3) for p in pts]).minimum_rotated_rectangle
    c = list(poly.exterior.coords)[:4]
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    l1, l2 = math.hypot(*e1), math.hypot(*e2)
    if min(l1, l2) < 2.5 or a / (l1 * l2) < 0.55: continue  # skip wires and thin fences
    ang = math.atan2(e1[1], e1[0]) if l1 >= l2 else math.atan2(e2[1], e2[0])
    h = float(np.percentile(chm[sl][m], 80))
    if h > 9: continue
    structures.append([round(poly.centroid.x, 1), round(poly.centroid.y, 1), round(max(l1, l2), 1), round(min(l1, l2), 1), round(ang, 3), round(h, 1)])
print('structures', len(structures), file=sys.stderr)

# ---------------------------------------------------------------- roof shapes
# Last returns that hit something hard (overhanging trees scatter into several returns)
multi_in = ndi.uniform_filter(multi, 2) / np.maximum(ndi.uniform_filter(cnt, 2), 1e-6)
roofpts = above & (rn == nr) & (hag > 1.2) & (nr == 1) & (multi_in[iy, ix] < 0.3)
rx, ry, rz = px[roofpts], py[roofpts], pz[roofpts]
rtree = cKDTree(np.stack([rx, ry], 1))

def densify_ring(coords, step):
    out = []
    for k in range(len(coords)):
        a, b = coords[k], coords[(k + 1) % len(coords)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        nseg = max(1, int(math.ceil(L / step)))
        for t in range(nseg):
            out.append((a[0] + (b[0] - a[0]) * t / nseg, a[1] + (b[1] - a[1]) * t / nseg))
    return out

roofs = {}
stats = {'pitched': 0, 'flat': 0, 'fallback': 0}
for b in C['buildings']:
    poly = bpolys[b['id']]
    ring = poly.buffer(4).difference(poly.buffer(1.2)).difference(bunion.buffer(0.5))
    minx, miny, maxx, maxy = ring.bounds
    gx, gy = np.meshgrid(np.arange(minx, maxx, 1.0), np.arange(miny, maxy, 1.0))
    m = contains_xy(ring, gx, gy)
    if m.sum() < 4:
        gx, gy = np.array([c[0] for c in poly.exterior.coords]), np.array([c[1] for c in poly.exterior.coords]); m = np.ones(len(gx), bool)
    gz = dtm_at(gx[m], gy[m])
    base = float(np.percentile(gz, 5)) - 0.3
    inner = poly.buffer(-0.4)
    ids = rtree.query_ball_point([poly.centroid.x, poly.centroid.y], r=math.sqrt(poly.area) * 1.5 + 30)
    ids = np.array(ids, int)
    if len(ids): ids = ids[contains_xy(inner, rx[ids], ry[ids])] if not inner.is_empty else ids[:0]
    zs = rz[ids] if len(ids) else np.array([])
    zs_ok = zs[zs > base + 1.8] if len(zs) else zs
    big = poly.area > 600
    step = 3.0 if big else 1.6
    bnd = densify_ring(b['poly'], step)
    nb = len(bnd)
    gxs, gys = np.meshgrid(np.arange(poly.bounds[0], poly.bounds[2], step), np.arange(poly.bounds[1], poly.bounds[3], step))
    gxs, gys = gxs.ravel() + step / 2, gys.ravel() + step / 2
    keep = contains_xy(poly.buffer(-step * 0.45), gxs, gys)
    interior = list(zip(gxs[keep], gys[keep]))
    verts = bnd + interior
    V = np.array(verts)
    dists = np.array([poly.exterior.distance(Point(v)) for v in verts])
    if len(zs_ok) < 15:
        top = base + 0.3 + b['height']
        Z = np.full(len(V), top)
        stats['fallback'] += 1
        kind = 'flat'
    else:
        sub = ids[zs > base + 1.8]
        d_pts = np.array([poly.exterior.distance(Point(x, y)) for x, y in zip(rx[sub], ry[sub])])
        z_pts = rz[sub]
        top = float(np.percentile(z_pts, 95))
        # Hip-roof model (height grows with distance from the eaves, up to the ridge)
        best = None
        for slope in np.arange(0.1, 0.66, 0.03):
            pred0 = slope * d_pts
            eave = float(np.median(z_pts - pred0))
            pred = np.minimum(eave + pred0, top)
            res = np.abs(z_pts - pred)
            e = float(np.mean(res))
            if best is None or e < best[0]: best = (e, slope, eave)
        e_hip, slope, eave = best
        # Flat / multi-level roof: snap to the dominant levels
        hist, edges = np.histogram(z_pts, bins=np.arange(z_pts.min() - 0.25, z_pts.max() + 0.5, 0.5))
        levels = [(edges[i] + edges[i + 1]) / 2 for i in range(len(hist)) if hist[i] >= max(6, 0.07 * len(z_pts)) and hist[i] == hist[max(0, i - 2):i + 3].max()]
        if not levels: levels = [float(np.median(z_pts))]
        levels = np.array(levels)
        snap = levels[np.argmin(np.abs(z_pts[:, None] - levels[None]), 1)]
        e_flat = float(np.mean(np.abs(z_pts - snap)))
        e_flat1 = float(np.mean(np.abs(z_pts - np.median(z_pts))))
        pitched = poly.area < 1500 and slope >= 0.15 and top - eave > 0.8 and (
            e_hip < 0.75 * e_flat or (b['kind'] == 'house' and e_hip < 0.85 * e_flat1 and e_hip < 1.2 * e_flat))
        if os.environ.get('DEBUG'): print(b['id'], b['kind'], int(poly.area), 'hip', round(e_hip, 2), 'slope', round(slope, 2), 'rise', round(top - eave, 1), 'flat', round(e_flat, 2), 'flat1', round(e_flat1, 2), 'P' if pitched else '-', 'levels', len(levels), file=sys.stderr)
        if pitched:
            Z = np.minimum(eave + slope * dists, top)
            kind = 'pitched'
        else:
            # Each vertex takes the level that most nearby roof points belong to
            vt = cKDTree(np.stack([rx[sub], ry[sub]], 1))
            Z = np.empty(len(V))
            for k, v in enumerate(V):
                near = vt.query_ball_point(v, r=step * 1.1 + 0.6)
                if not near:
                    _, nn = vt.query(v); near = [nn]
                lv = snap[near]
                vals, counts = np.unique(np.round(lv, 2), return_counts=True)
                Z[k] = vals[np.argmax(counts)]
            kind = 'flat'
        stats[kind] += 1
    Z = np.maximum(Z, base + 2.4)
    tri = Delaunay(V)
    tris = []
    for t in tri.simplices:
        a, bb, c = V[t[0]], V[t[1]], V[t[2]]
        cen = Point((a[0] + bb[0] + c[0]) / 3, (a[1] + bb[1] + c[1]) / 3)
        if not poly.contains(cen): continue
        ok = all(poly.buffer(0.05).contains(Point((V[t[p]][0] + V[t[q]][0]) / 2, (V[t[p]][1] + V[t[q]][1]) / 2)) for p, q in ((0, 1), (1, 2), (2, 0)))
        if not ok: continue
        # counter-clockwise when seen from above (campus x/y)
        if (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]) < 0: t = (t[0], t[2], t[1])
        tris.extend(int(i) for i in t)
    ox, oy = round(poly.centroid.x, 1), round(poly.centroid.y, 1)
    vx = np.round((V[:, 0] - ox) * 10).astype(np.int16)
    vy = np.round((V[:, 1] - oy) * 10).astype(np.int16)
    vz = np.round((Z - BASE) * 10).astype(np.int16)
    roofs[b['id']] = {
        'o': [ox, oy], 'b': round(base - BASE, 2), 'n': nb, 'k': kind,
        '_v': np.stack([vx, vy, vz], 1).ravel(), '_t': np.array(tris, np.uint16),
    }
print('roofs', stats, file=sys.stderr)

def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).astype(a.dtype.newbyteorder('<')).tobytes()).decode()

# ---------------------------------------------------------------- core heightmap (2 m)
STEP = 2.0
cxs = np.arange(X0, X1 + 0.01, STEP); cys = np.arange(Y0, Y1 + 0.01, STEP)
GX, GY = np.meshgrid(cxs, cys)
core = dtm_at(GX, GY)
core_i = np.round((core - BASE) * 100).astype(np.int16)

# ---------------------------------------------------------------- outer terrain (terrain tiles)
OUTR, OSTEP, Z = 3200, 32.0, 14
def tile_xy(lat, lon):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
os.makedirs(CACHE, exist_ok=True)
tiles = {}
def tile(tx, ty):
    if (tx, ty) not in tiles:
        f = f'{CACHE}/{Z}_{tx}_{ty}.png'
        if not os.path.exists(f):
            with urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png', timeout=60) as r:
                open(f, 'wb').write(r.read())
        a = np.asarray(Image.open(f).convert('RGB')).astype(np.float64)
        tiles[(tx, ty)] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return tiles[(tx, ty)]
def dem(x, y):
    fx, fy = tile_xy(LAT0 + y / KY, LON0 + x / KX)
    tx, ty = int(fx), int(fy)
    u, v = (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5
    i, j = int(math.floor(u)), int(math.floor(v)); a, c = u - i, v - j
    def px_(ii, jj):
        ttx, tty = tx, ty
        if ii < 0: ttx -= 1; ii += 256
        if ii > 255: ttx += 1; ii -= 256
        if jj < 0: tty -= 1; jj += 256
        if jj > 255: tty += 1; jj -= 256
        return tile(ttx, tty)[jj, ii]
    return (px_(i, j) * (1 - a) * (1 - c) + px_(i + 1, j) * a * (1 - c) + px_(i, j + 1) * (1 - a) * c + px_(i + 1, j + 1) * a * c)
# Datum check against the LiDAR ground
samp = [(x, y) for x in range(-400, 400, 60) for y in range(-350, 350, 60)]
offset = float(np.median([dtm_at(x, y) - dem(x, y) for x, y in samp]))
print('terrain tile offset vs LiDAR', round(offset, 2), file=sys.stderr)
oxs = np.arange(-OUTR, OUTR + 0.01, OSTEP)
outer = np.zeros((len(oxs), len(oxs)))
for j, y in enumerate(oxs):
    for i, x in enumerate(oxs):
        if X0 <= x <= X1 and Y0 <= y <= Y1:
            outer[j, i] = dtm_at(x, y) - 1.5  # hidden under the detailed ground
        else:
            outer[j, i] = dem(x, y) + offset
outer_i = np.round((outer - BASE) * 10).astype(np.int16)

# ---------------------------------------------------------------- write
roof_v = np.concatenate([r['_v'] for r in roofs.values()])
roof_t = np.concatenate([r['_t'] for r in roofs.values()])
roof_index = {}
vo = to = 0
for bid, r in roofs.items():
    nv, nt = len(r['_v']) // 3, len(r['_t'])
    roof_index[bid] = [r['o'][0], r['o'][1], r['b'], r['n'], vo, nv, to, nt, 1 if r['k'] == 'pitched' else 0]
    vo += nv; to += nt
assert vo < 2 ** 31

out = [
    '// Terrain, trees and roof shapes for Grand Mustang Auto, generated from public-domain data:\n',
    '//   USGS 3DEP LiDAR (CA_LosAngeles_1_B23) for the ground, trees, shrubs and roofs around campus,\n',
    '//   and Terrain Tiles on AWS (Mapzen/Tilezen, from the USGS 3DEP DEM) for the mountains around it.\n',
    "// Coordinates are campus meters (x east, y north) like campus.js. Heights are meters above `base`.\n",
    "// Don't edit by hand; regenerate with tools/fetch_lidar.py and tools/lidar_to_terrain.py.\n\n",
    'export const TERRAIN = {\n',
    f'  base: {BASE},\n',
    f'  core: {{ x0: {X0}, y0: {Y0}, step: {STEP}, nx: {len(cxs)}, ny: {len(cys)}, scale: 0.01, data: "{b64(core_i)}" }},\n',
    f'  outer: {{ x0: {-OUTR}, y0: {-OUTR}, step: {OSTEP}, nx: {len(oxs)}, ny: {len(oxs)}, scale: 0.1, data: "{b64(outer_i)}" }},\n',
    f'  shrub: {{ x0: {X0}, y0: {Y0}, step: {SH}, nx: {W // SH}, ny: {H // SH}, data: "{b64(shr_b)}" }},\n',
    '  // [trunk x, trunk y, height, crown radius, kind (0 broadleaf, 1 palm, 2 conifer), crown base / height, crown dx, crown dy]\n',
    '  trees: ' + json.dumps(trees, separators=(',', ':')) + ',\n',
    '  // Sheds, carports and other structures the LiDAR sees: [cx, cy, length, width, angle, height]\n',
    '  structures: ' + json.dumps(structures, separators=(',', ':')) + ',\n',
    '  // Roofs: building id -> [originX, originY, wallBase, boundaryVerts, vertOffset, vertCount, triOffset, triCount, pitched]\n',
    '  // Vertices are int16 triples (dx, dy decimeters from origin; z decimeters above base); the first\n',
    '  // boundaryVerts of each roof run around the footprint and carry the wall tops.\n',
    '  roofs: ' + json.dumps(roof_index, separators=(',', ':')) + ',\n',
    f'  roofVerts: "{b64(roof_v.astype(np.int16))}",\n',
    f'  roofTris: "{b64(roof_t.astype(np.uint16))}",\n',
    '};\n',
]
open(OUT, 'w').write(''.join(out))
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB', file=sys.stderr)
