"""Convert an OpenStreetMap export of The Master's University into src/data/campus.js.

Usage (from the repo root; needs `pip install shapely`):
    python3 tools/osm_to_campus.py tools/data/tmu.osm src/data/campus.js

tools/data/tmu.osm is an OpenStreetMap export (openstreetmap.org > Export) of the campus.
Map data (c) OpenStreetMap contributors, ODbL. Coordinates are meters at real scale,
x east, y north, origin at the export's center.
"""
import sys, math, json, xml.etree.ElementTree as ET
from shapely.geometry import Polygon, LineString, MultiLineString, Point, box
from shapely.ops import linemerge, unary_union

OSM, OUT = sys.argv[1], sys.argv[2]
if not OUT.endswith('.js'):
    raise SystemExit('output must be a .js file')
BOUNDS = dict(minX=-420, maxX=360, minY=-345, maxY=335)
CLIP = box(BOUNDS['minX'] - 30, BOUNDS['minY'] - 30, BOUNDS['maxX'] + 30, BOUNDS['maxY'] + 30)
INSIDE = box(BOUNDS['minX'], BOUNDS['minY'], BOUNDS['maxX'], BOUNDS['maxY'])

root = ET.parse(OSM).getroot()
b = root.find('bounds')
lat0 = (float(b.get('minlat')) + float(b.get('maxlat'))) / 2
lon0 = (float(b.get('minlon')) + float(b.get('maxlon'))) / 2
KX = 111320 * math.cos(math.radians(lat0))
KY = 110574
nodes = {n.get('id'): ((float(n.get('lon')) - lon0) * KX, (float(n.get('lat')) - lat0) * KY) for n in root.findall('node')}
ways = {}
for w in root.findall('way'):
    tags = {t.get('k'): t.get('v') for t in w.findall('tag')}
    pts = [nodes[r.get('ref')] for r in w.findall('nd') if r.get('ref') in nodes]
    ways[w.get('id')] = (tags, pts)
rel_tags = {}
for r in root.findall('relation'):
    tags = {t.get('k'): t.get('v') for t in r.findall('tag')}
    for m in r.findall('member'):
        if m.get('type') == 'way' and m.get('role') == 'outer':
            rel_tags[m.get('ref')] = tags

R = lambda v: round(v, 1)
def coords(geom):
    return [[R(x), R(y)] for x, y in geom.coords]
def ring(poly):
    c = coords(poly.exterior)[:-1]
    # counter-clockwise for consistent extrusion
    if Polygon(c).exterior.is_ccw is False:
        c = c[::-1]
    return c

def obb(poly):
    r = poly.minimum_rotated_rectangle
    c = list(r.exterior.coords)[:4]
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
    e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    l1, l2 = math.hypot(*e1), math.hypot(*e2)
    if l1 >= l2:
        ang, w, h = math.atan2(e1[1], e1[0]), l1, l2
    else:
        ang, w, h = math.atan2(e2[1], e2[0]), l2, l1
    # normalise angle to (-pi/2, pi/2]
    while ang > math.pi / 2: ang -= math.pi
    while ang <= -math.pi / 2: ang += math.pi
    cen = r.centroid
    return [R(cen.x), R(cen.y), R(w), R(h), round(ang, 4)], r.area

# ---------------------------------------------------------------- campus area
campus_polys = [Polygon(ways[w][1]) for w in ('484140096', '484140101')]
campus = unary_union(campus_polys).buffer(0)

# ---------------------------------------------------------------- buildings
NAMED = {
    'MacArthur Center / Bross Court': dict(id='chapel', name='MacArthur Center', sub='Chapel · Bross Court', color=0xf2ede2, roofColor=0x9a4a36),
    'Dunkin Student Center / Mustang Grill': dict(id='dunkin', name='Dunkin Student Center', sub='Mustang Grill', color=0xe2cfa8),
    'J.J. Rutherford Administration / Powell Library': dict(id='library', name='Powell Library', sub='Rutherford Administration', color=0xc98f6b),
    'Reese Center for Science & Mathematics': dict(id='reece', name='Reese Center', sub='Science & Mathematics', color=0xeadcc4),
    'Hotchkiss Hall': dict(id='hotchkiss', name='Hotchkiss Hall', color=0xf0e4cc, dorm=True),
    'Dixon Hall': dict(id='dixon', name='Dixon Hall', color=0xe8d8bd, dorm=True),
    'Slight Hall': dict(id='slight', name='Slight Hall', color=0xf0e4cc, dorm=True),
    'Sweazy Hall': dict(id='sweazy', name='Sweazy Hall', color=0xe8d8bd, dorm=True),
    'Waldock Hall': dict(id='waldock', name='Waldock Hall', color=0xf0e4cc, dorm=True),
    'C.W. Smith Hall': dict(id='smith', name='C.W. Smith Hall', color=0xe8d8bd, dorm=True),
    'King Hall': dict(id='king', name='King Hall', color=0xe6d6b8),
    'Oaks Lounge': dict(id='oaks', name='Oaks Lounge', color=0xe6d6b8, small=True),
    'Events & Production': dict(id='events', name='Events & Production', color=0xd9cdb5, small=True),
    'Vider Administrative Services': dict(id='vider', name='Vider Admin Services', sub='Health Center', color=0xe6d6b8, small=True),
    "Chancellor's House": dict(id='chancellor', name="Chancellor's House", sub='Development', color=0xd8c3a0, small=True),
    'School of Online Education': dict(id='online', name='Online Education', color=0xe6d6b8, small=True),
    'Pearl C. Schaffer School of Education Center': dict(id='education', name='Schaffer Center', sub='School of Education', color=0xe6d6b8),
    'Engineering & Computer Science Center': dict(id='engineering', name='Engineering & CS', color=0xe6d6b8),
    'Communication Center': dict(id='communication', name='Communication Center', color=0xe6d6b8),
    # OSM calls this one the Kinesiology Center; the university's map has it as the fitness
    # center, with the Kinesiology Center in the building east of it (not in OSM; world.js)
    'Kinesiology Center': dict(id='kinesiology', name='ImpactOrtho Fitness Center', color=0xd9d4c7),
    'John P. Stead School of Humanities Center': dict(id='humanities', name='Stead Center', sub='School of Humanities', color=0xe6d6b8),
    'Business Center': dict(id='business', name='Business Center', color=0xe6d6b8),
    'Biblical Studies Center': dict(id='biblical', name='Biblical Studies Center', color=0xeadcc4),
    'Paul T. Plew School of Music Center': dict(id='music', name='Plew Center', sub='School of Music', color=0xe2cfa8),
    'Placerita Bible Church': dict(id='church', name='Placerita Bible Church', color=0xf2ede2, roofColor=0x7a5a48),
}
# Campus buildings OSM leaves unnamed, named from the university's own campus map
# (cdn.maps.moderncampus.net map 530, whose markers carry lat/lon), by OSM way id
NAMED_BY_WAY = {
    '472555738': dict(id='itadmin', name='IT Administration Center', color=0xe6d6b8, small=True),
    '472555725': dict(id='wismer', name='Wismer Technology Center', color=0xe6d6b8, small=True),
    '472555734': dict(id='ods', name='Disability Services', sub='Academic Counseling', color=0xe6d6b8, small=True),
    '472564535': dict(id='sportmgmt', name='Sport Management Center', color=0xe6d6b8, small=True),
    '472564533': dict(id='plantops', name='Plant Operations', color=0xd9d4c7, small=True),
    '472564529': dict(id='clubhouse', name='Soccer & Baseball Clubhouse', color=0xe6d6b8, small=True),
}
HOUSE_COLORS = [0xd8c3a0, 0xcfb894, 0xe3d3b4, 0xc9b08a, 0xe8dcc6, 0xbfae92]
ROOF_COLORS = [0x8c4a3a, 0x9a5a44, 0x6e5a4e, 0x7d4436]

buildings, building_polys = [], []
seen_ids = set()
for wid, (tags, pts) in ways.items():
    t = tags if 'building' in tags else rel_tags.get(wid, {})
    if 'building' not in t or len(pts) < 4:
        continue
    poly = Polygon(pts).buffer(0)
    if poly.is_empty or poly.area < 14 or not INSIDE.contains(poly.centroid):
        continue
    poly = poly.simplify(0.25)
    if poly.geom_type != 'Polygon':
        continue
    box_, box_area = obb(poly)
    rect = poly.area / box_area if box_area else 0
    name = t.get('name')
    h = float(t['height']) if 'height' in t else None
    entry = {}
    if name in NAMED or wid in NAMED_BY_WAY:
        spec = dict(NAMED[name] if name in NAMED else NAMED_BY_WAY[wid])
        entry.update(id=spec['id'], name=spec['name'])
        if spec.get('sub'): entry['sub'] = spec['sub']
        entry['kind'] = 'dorm' if spec.get('dorm') else 'campus'
        if spec.get('small'): entry['small'] = True
        entry['color'] = spec['color']
        if spec.get('roofColor'): entry['roofColor'] = spec['roofColor']
        if spec.get('dorm'): entry['dorm'] = True
        entry['height'] = round(max(5.5, (h or 7) * 1.25), 1)
        seen_ids.add(spec['id'])
    elif campus.contains(poly.centroid):
        entry.update(id='c' + wid, kind='campus', color=0xe2d6be)
        entry['height'] = round(max(4.5, (h or 5) * 1.2), 1)
    else:
        n = int(wid)
        entry.update(id='h' + wid, kind='house', color=HOUSE_COLORS[n % len(HOUSE_COLORS)])
        entry['height'] = round(max(3.6, min(6.5, (h or 4) * 1.0)), 1)
        entry['roofColor'] = ROOF_COLORS[(n // 7) % len(ROOF_COLORS)]
        if rect > 0.82 and box_[3] < 22:
            entry['roof'] = 'gable'
    entry['obb'] = box_
    entry['poly'] = ring(poly)
    buildings.append(entry)
    building_polys.append(poly)
missing = set(v['id'] for v in NAMED.values()) - seen_ids
if missing:
    print('WARNING missing named buildings', missing, file=sys.stderr)
all_buildings = unary_union(building_polys)

# ---------------------------------------------------------------- roads
STREET_ABBR = {'Road': 'Rd', 'Boulevard': 'Blvd', 'Avenue': 'Ave', 'Drive': 'Dr', 'Lane': 'Ln', 'Street': 'St'}
def short(name):
    parts = name.split(' ')
    if parts[-1] in STREET_ABBR: parts[-1] = STREET_ABBR[parts[-1]]
    return ' '.join(parts)

def as_lines(g):
    if g.is_empty: return []
    if g.geom_type == 'LineString': return [g]
    if g.geom_type == 'MultiLineString': return list(g.geoms)
    if g.geom_type == 'GeometryCollection':
        return [x for x in g.geoms if x.geom_type == 'LineString']
    return []

groups = {}
for wid, (tags, pts) in ways.items():
    hw = tags.get('highway')
    if not hw or len(pts) < 2: continue
    svc = tags.get('service')
    if hw in ('residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'living_street'):
        kind = 'street'
    elif hw == 'service':
        kind = {'parking_aisle': 'aisle', 'driveway': 'driveway'}.get(svc, 'service')
    elif hw in ('path', 'footway', 'cycleway', 'pedestrian', 'steps'):
        kind = 'trail' if tags.get('surface') == 'unpaved' or (hw == 'path' and tags.get('surface') != 'paved' and Point(pts[0]).y < -150) else 'path'
    elif hw == 'track':
        kind = 'trail'
    else:
        continue
    name = tags.get('name', '')
    key = (kind, name if kind == 'street' and name else wid)
    groups.setdefault(key, []).append(LineString(pts))

WIDTH = {'street': 12, 'service': 6.5, 'aisle': 6.5, 'driveway': 4.5, 'path': 3, 'trail': 2.6}
# Drives narrower than their kind: the one-way aisle between the two angled rows south of
# Reese Field (OSM way id -> width)
WIDTH_BY_WAY = {'484140112': 4.5}
roads = []
road_geoms = []
for (kind, key), lines in groups.items():
    merged = linemerge(MultiLineString(lines)) if len(lines) > 1 else lines[0]
    for ln in as_lines(merged.intersection(CLIP)):
        ln = ln.simplify(0.4)
        if ln.length < 6: continue
        r = {'kind': kind, 'width': WIDTH_BY_WAY.get(key, WIDTH[kind]), 'pts': coords(ln)}
        if kind == 'street':
            if key and not key.isdigit():
                r['name'] = key
                r['short'] = short(key)
            r['lanes'] = 2
            r['traffic'] = True
        elif kind == 'service' and ln.length > 90 and campus.buffer(5).contains(ln.interpolate(0.5, normalized=True)):
            r['cart'] = True
        if kind in ('trail',):
            r['dirt'] = True
        roads.append(r)
        road_geoms.append((r, ln))

# The visible part of an unnamed street is a dead end; keep traffic only on named streets
for r, ln in road_geoms:
    if r['kind'] == 'street' and 'name' not in r:
        r.pop('traffic', None)

# ---------------------------------------------------------------- street signs at named intersections
named = [(r, ln) for r, ln in road_geoms if r.get('name')]
signs = []
for i in range(len(named)):
    for j in range(i + 1, len(named)):
        a, la = named[i]; c, lc = named[j]
        if a['name'] == c['name']: continue
        inter = la.intersection(lc)
        pts = [inter] if inter.geom_type == 'Point' else [g for g in getattr(inter, 'geoms', []) if g.geom_type == 'Point']
        for p in pts:
            if not INSIDE.contains(p): continue
            # Direction of each road at the crossing
            def dir_at(ln):
                d = ln.project(p)
                p1 = ln.interpolate(max(0, d - 4)); p2 = ln.interpolate(min(ln.length, d + 4))
                return math.atan2(p2.y - p1.y, p2.x - p1.x)
            aa, ac = dir_at(la), dir_at(lc)
            # Put the post on the corner that is clear of both roads
            best = None
            for sa in (-1, 1):
                for sc in (-1, 1):
                    off = 8.5
                    dx = math.cos(aa + sa * math.pi / 2) + math.cos(ac + sc * math.pi / 2)
                    dy = math.sin(aa + sa * math.pi / 2) + math.sin(ac + sc * math.pi / 2)
                    l = math.hypot(dx, dy) or 1
                    q = Point(p.x + dx / l * off, p.y + dy / l * off)
                    clear = min(ln.distance(q) - r['width'] / 2 for r, ln in road_geoms if r['kind'] != 'trail')
                    if all_buildings.distance(q) < 1.5: clear -= 10
                    if best is None or clear > best[0]: best = (clear, q)
            q = best[1]
            if not INSIDE.buffer(-3).contains(q): continue
            signs.append({'x': R(q.x), 'y': R(q.y), 'names': [a['short'], c['short']], 'angles': [round(aa, 3), round(ac, 3)]})
# Name signs where a named street leaves the play area, and at a few long stretches
for r, ln in named:
    for frac in (0.25, 0.75) if ln.length > 500 else ((0.5,) if ln.length > 200 else ()):
        p = ln.interpolate(frac, normalized=True)
        if not INSIDE.contains(p): continue
        d = ln.project(p)
        p1 = ln.interpolate(max(0, d - 4)); p2 = ln.interpolate(min(ln.length, d + 4))
        a = math.atan2(p2.y - p1.y, p2.x - p1.x)
        q = Point(p.x + math.cos(a - math.pi / 2) * (r['width'] / 2 + 2), p.y + math.sin(a - math.pi / 2) * (r['width'] / 2 + 2))
        if all_buildings.distance(q) < 2: continue
        if any(math.hypot(s['x'] - q.x, s['y'] - q.y) < 60 for s in signs): continue
        signs.append({'x': R(q.x), 'y': R(q.y), 'names': [r['short']], 'angles': [round(a, 3)]})

# ---------------------------------------------------------------- stop signs (highway=stop nodes)
# The sign stands on the minor road, just before it meets the street, facing its drivers
way_nodes = {w.get('id'): [r.get('ref') for r in w.findall('nd')] for w in root.findall('way')}
stops = []
for nd in root.findall('node'):
    if not any(t.get('k') == 'highway' and t.get('v') == 'stop' for t in nd.findall('tag')):
        continue
    nid = nd.get('id')
    cands = [(wid, refs) for wid, refs in way_nodes.items() if nid in refs and ways[wid][0].get('highway') and ways[wid][0].get('highway') != 'residential']
    cands = [(wid, refs) for wid, refs in cands if refs.index(nid) in (0, len(refs) - 1)] or cands
    if not cands: continue
    wid, refs = cands[0]
    k = refs.index(nid)
    nxt = refs[1] if k == 0 else refs[k - 1]
    if nxt not in nodes: continue
    (x0, y0), (x1, y1) = nodes[nid], nodes[nxt]
    L = math.hypot(x0 - x1, y0 - y1) or 1
    tx, ty = (x0 - x1) / L, (y0 - y1) / L  # travel direction, toward the street
    back = min(8.0, L * 0.8)
    w = WIDTH['service'] / 2 + 0.9
    sx, sy = x0 - tx * back + ty * w, y0 - ty * back - tx * w
    if INSIDE.contains(Point(sx, sy)):
        stops.append([R(sx), R(sy), round(math.atan2(-ty, -tx), 3)])

# ---------------------------------------------------------------- lots and parking stalls
aisles = [ln for r, ln in road_geoms if r['kind'] == 'aisle']
lot_shapes = [ln.buffer(8.5, cap_style=2) for ln in aisles]
for wid, (tags, pts) in ways.items():
    if tags.get('amenity') == 'parking' and len(pts) > 3:
        lot_shapes.append(Polygon(pts).buffer(0))
# Parking OpenStreetMap doesn't have: nose-in rows along both sides of the dorm drive, in front
# of C.W. Smith and Waldock (south) and Sweazy and Dixon (north). Where they are comes from the
# parked cars in the 2023 USGS LiDAR (tools/fetch_lidar.py). Each row: x range, side of the
# drive ('S' or 'N'), and how far the stall centers sit from the drive's center line.
DORM_DRIVE_AT = Point(-290, -141)
DORM_ROWS = [(-323, -208, 'S', 6.4), (-326, -227, 'N', 6.4), (-213, -172, 'N', 6.4)]
dorm_drive = min((ln for r, ln in road_geoms if r['kind'] == 'service'), key=lambda ln: ln.distance(DORM_DRIVE_AT))
dorm_stalls = []
for x0, x1, side, off in DORM_ROWS:
    L = dorm_drive.length
    d = 0.0
    while d < L:
        p = dorm_drive.interpolate(d)
        if x0 <= p.x <= x1:
            p1 = dorm_drive.interpolate(max(0, d - 1)); p2 = dorm_drive.interpolate(min(L, d + 1))
            a = math.atan2(p2.y - p1.y, p2.x - p1.x)
            nx, ny = -math.sin(a), math.cos(a)  # left of the drive's direction
            if (ny < 0) != (side == 'S'): nx, ny = -nx, -ny
            c = Point(p.x + nx * off, p.y + ny * off)
            # The stall's back corners must clear the dorm walls
            back = [Point(c.x + nx * 2.7 + ny * s * 1.4, c.y + ny * 2.7 - nx * s * 1.4) for s in (-1, 1)]
            if not any(all_buildings.buffer(0.3).contains(q) for q in back + [c]):
                dorm_stalls.append([R(c.x), R(c.y), round(math.atan2(-ny, -nx), 3)])
                # Paved from the drive's edge to the back of the stall
                lot_shapes.append(Polygon([(p.x + nx * 2.5 - ny * 1.6, p.y + ny * 2.5 + nx * 1.6),
                                           (p.x + nx * (off + 3.0) - ny * 1.6, p.y + ny * (off + 3.0) + nx * 1.6),
                                           (p.x + nx * (off + 3.0) + ny * 1.6, p.y + ny * (off + 3.0) - nx * 1.6),
                                           (p.x + nx * 2.5 + ny * 1.6, p.y + ny * 2.5 - nx * 1.6)]))
        d += 2.9

# Angled parking along the one-way drives around Reese Field: east of the MacArthur Center
# (both sides), along its top by the Kinesiology Center, and south of the field. OpenStreetMap
# only has the drives; the painted stall lines show up in the 2023 USGS LiDAR intensity
# (asphalt is dark, the lines bright). Stalls lean forward in the direction the drive runs
# (OSM's way direction). Each row: a point on the drive, the coordinate ('x' or 'y') and range
# the row covers, which side ('L' or 'R' of the direction of travel) and the stall angle.
ANGLED_ROWS = [
    ((-35, 40), 'y', 18, 84, 'L', 60),    # east of MacArthur, along the building
    ((-35, 40), 'y', 12, 83, 'R', 60),    # east of MacArthur, the Herwaldt Lawn side
    ((-45, 92), 'x', -64, -27, 'L', 60),  # along the top, by the Kinesiology Center
    ((30, -10), 'x', -30, 98, 'L', 60),   # south of Reese Field, both sides of the aisle
    ((30, -10), 'x', -30, 98, 'R', 60),
]
STALL_W, STALL_L = 2.75, 5.4  # same as src/surfaces.js
angled_stalls = []
for at, axis, lo, hi, side, deg in ANGLED_ROWS:
    road, drive = min(((r, ln) for r, ln in road_geoms if r['kind'] == 'service'), key=lambda rl: rl[1].distance(Point(at)))
    th = math.radians(deg)
    hw = road['width'] / 2
    depth = STALL_L * math.sin(th) + STALL_W * math.cos(th)  # how far the row reaches off the drive
    off = hw + 0.2 + depth / 2
    step = STALL_W / math.sin(th)  # along the drive, so neighbors share their lines
    L = drive.length
    d = 0.0
    while d < L:
        p = drive.interpolate(d)
        if lo <= (p.x if axis == 'x' else p.y) <= hi:
            p1 = drive.interpolate(max(0, d - 1)); p2 = drive.interpolate(min(L, d + 1))
            a = math.atan2(p2.y - p1.y, p2.x - p1.x)
            tx, ty = math.cos(a), math.sin(a)
            nx, ny = (-ty, tx) if side == 'L' else (ty, -tx)
            c = Point(p.x + nx * off, p.y + ny * off)
            # Into the stall: away from the drive and forward
            ix, iy = nx * math.sin(th) + tx * math.cos(th), ny * math.sin(th) + ty * math.cos(th)
            corners = [Point(c.x + ix * u * STALL_L / 2 - iy * v * STALL_W / 2, c.y + iy * u * STALL_L / 2 + ix * v * STALL_W / 2) for u in (-1, 1) for v in (-1, 1)]
            if not any(all_buildings.buffer(0.3).contains(q) for q in corners + [c]):
                angled_stalls.append([R(c.x), R(c.y), round(math.atan2(-iy, -ix), 3)])
                # Paved from the drive's edge to the back of the stall
                e = hw - 0.5
                lot_shapes.append(Polygon([(p.x + nx * e - tx * step / 2, p.y + ny * e - ty * step / 2),
                                           (p.x + nx * e + tx * step / 2, p.y + ny * e + ty * step / 2),
                                           (p.x + nx * (hw + 0.4 + depth) + tx * step / 2, p.y + ny * (hw + 0.4 + depth) + ty * step / 2),
                                           (p.x + nx * (hw + 0.4 + depth) - tx * step / 2, p.y + ny * (hw + 0.4 + depth) - ty * step / 2)]).union(
                    Polygon([(q.x, q.y) for q in (corners[0], corners[1], corners[3], corners[2])]).buffer(0.4)))
        d += step
lots_geom = unary_union(lot_shapes).buffer(0.5).buffer(-0.5).simplify(0.6)
lots = []
for g in (lots_geom.geoms if hasattr(lots_geom, 'geoms') else [lots_geom]):
    if g.area < 120 or not INSIDE.intersects(g): continue
    lots.append({'poly': ring(g)})

non_aisle = unary_union([ln.buffer(r['width'] / 2 + 0.8) for r, ln in road_geoms if r['kind'] in ('street', 'service', 'driveway', 'path')])
blocked = unary_union([all_buildings.buffer(1.2), non_aisle])
stalls = []
for ln in aisles:
    L = ln.length
    d = 2.0
    while d < L - 2.0:
        p = ln.interpolate(d)
        p1 = ln.interpolate(max(0, d - 1)); p2 = ln.interpolate(min(L, d + 1))
        a = math.atan2(p2.y - p1.y, p2.x - p1.x)
        for side in (-1, 1):
            nx, ny = math.cos(a + side * math.pi / 2), math.sin(a + side * math.pi / 2)
            c = Point(p.x + nx * 5.6, p.y + ny * 5.6)
            footprint = Point(c.x, c.y).buffer(1.3)
            if not lots_geom.contains(c) or blocked.intersects(footprint) or not INSIDE.contains(c):
                continue
            if any(math.hypot(s[0] - c.x, s[1] - c.y) < 2.5 for s in stalls):
                continue
            # heading the car faces: toward the aisle
            stalls.append([R(c.x), R(c.y), round(math.atan2(-ny, -nx), 3)])
        d += 2.9
stalls += dorm_stalls + angled_stalls

# ---------------------------------------------------------------- lawns and fields
campus_parts = list(campus.geoms) if hasattr(campus, 'geoms') else [campus]
lawns = [{'kind': 'campus', 'poly': ring(g.simplify(0.8))} for g in campus_parts]
fields = []
for wid, (tags, pts) in ways.items():
    if len(pts) < 4: continue
    poly = Polygon(pts).buffer(0)
    if poly.is_empty or not INSIDE.intersects(poly): continue
    lu, le, sp = tags.get('landuse'), tags.get('leisure'), tags.get('sport')
    kind = None
    if lu == 'grass': kind = 'grass'
    elif lu == 'recreation_ground': kind = 'turf' if 'Reese' in tags.get('name', '') else 'field'
    elif le == 'pitch' and sp == 'soccer': kind = 'pitch'
    elif le == 'pitch' and sp == 'tennis': kind = 'court'
    elif le == 'pitch' and sp == 'beachvolleyball': kind = 'sand'
    if not kind: continue
    e = {'kind': kind, 'poly': ring(poly.simplify(0.4))}
    if tags.get('name'): e['name'] = tags['name']
    if kind in ('pitch', 'court', 'sand', 'field'):
        e['lines'] = obb(poly)[0]
    lawns.append(e)
order = {'campus': 0, 'grass': 1, 'field': 2, 'turf': 2, 'pitch': 3, 'court': 3, 'sand': 3}
lawns.sort(key=lambda l: order[l['kind']])

# Baseball diamond in the southwest corner of Reese Field (visible on aerial photos)
reese = next(Polygon(ways[w][1]) for w in ways if ways[w][0].get('name') == 'Pete Reese Field')
pitch = next(Polygon(ways[w][1]) for w in ways if ways[w][0].get('sport') == 'soccer')

# ---------------------------------------------------------------- creeks
washes = []
for wid, (tags, pts) in ways.items():
    if tags.get('waterway') == 'stream' and len(pts) > 1:
        for ln in as_lines(LineString(pts).intersection(CLIP)):
            if ln.length < 30: continue
            washes.append({'name': tags.get('name', ''), 'width': 9, 'pts': coords(ln.simplify(1.0))})

out = {
    'source': 'OpenStreetMap',
    'bounds': BOUNDS,
    'origin': [round(lat0, 6), round(lon0, 6)],
    'campus': [ring(g.simplify(0.8)) for g in campus_parts],
    'roads': roads,
    'signs': signs,
    'stops': stops,
    'lawns': lawns,
    'lots': lots,
    'stalls': stalls,
    'washes': washes,
    'buildings': buildings,
    'reeseField': {'field': ring(reese), 'pitch': obb(pitch)[0]},
}
print('buildings', len(buildings), 'roads', len(roads), 'signs', len(signs), 'lots', len(lots), 'stalls', len(stalls), 'lawns', len(lawns), 'washes', len(washes), file=sys.stderr)

# ---------------------------------------------------------------- named places
B = {bd['id']: Polygon(bd['poly']) for bd in buildings}
streets = unary_union([ln.buffer(r['width'] / 2 + 1) for r, ln in road_geoms if r['kind'] in ('street', 'service', 'aisle', 'driveway')])
solid = all_buildings.buffer(2.2)

def open_near(x, y, avoid_roads=True, step=1.5):
    """Nearest point to (x, y) that is clear of buildings (and roads)."""
    for rad in [0] + [step * k for k in range(1, 40)]:
        n = max(1, int(rad * 2))
        for i in range(n):
            a = 2 * math.pi * i / n
            p = Point(x + math.cos(a) * rad, y + math.sin(a) * rad)
            if solid.contains(p): continue
            if avoid_roads and streets.contains(p): continue
            if not INSIDE.buffer(-5).contains(p): continue
            return [R(p.x), R(p.y)]
    raise SystemExit(f'no open spot near {x},{y}')

def door(bid, tx, ty, out=4.0):
    """Outside spot by the wall of building `bid` that faces (tx, ty)."""
    poly = B[bid]
    c = list(poly.exterior.coords)
    best = None
    for i in range(len(c) - 1):
        (ax, ay), (bx, by) = c[i], c[i + 1]
        L = math.hypot(bx - ax, by - ay)
        if L < 5: continue
        mx, my = (ax + bx) / 2, (ay + by) / 2
        nx, ny = (by - ay) / L, -(bx - ax) / L
        if poly.contains(Point(mx + nx, my + ny)): nx, ny = -nx, -ny
        d = math.hypot(tx - (mx + nx * out), ty - (my + ny * out))
        if best is None or d < best[0]: best = (d, mx + nx * out, my + ny * out)
    return open_near(best[1], best[2], avoid_roads=False)

def door_facing(bid, dx, dy):
    """Outside spot by the wall of `bid` that faces compass direction (dx, dy) (east, north)."""
    c = B[bid].centroid
    return door(bid, c.x + dx * 300, c.y + dy * 300)

def courtyard(bid):
    poly = B[bid]
    hull = poly.minimum_rotated_rectangle
    minx, miny, maxx, maxy = hull.bounds
    best = None
    x = minx
    while x < maxx:
        y = miny
        while y < maxy:
            p = Point(x, y)
            if hull.contains(p) and not poly.contains(p) and not streets.contains(p):
                d = poly.exterior.distance(p)
                if best is None or d > best[0]: best = (d, x, y)
            y += 1
        x += 1
    return [R(best[1]), R(best[2])]

def lot_spot(x, y):
    s = min(stalls, key=lambda s: math.hypot(s[0] - x, s[1] - y))
    # stand in the aisle in front of the stall
    return [R(s[0] + math.cos(s[2]) * 5), R(s[1] + math.sin(s[2]) * 5)]

pc = obb(pitch)[0]
places = {
    'spawn': open_near(-74, -42),
    'respawn': open_near(-64, -58),
    # Real entrance sides from Street View (tools/data/streetview_buildings.json)
    'chapelDoor': door_facing('chapel', 1, 0),
    'grill': door_facing('dunkin', 0, 1),
    'library': door_facing('library', 0, 1),
    'reece': door_facing('reece', 1, 0),
    'hotchkiss': door('hotchkiss', -60, -100),
    'hotchyard': courtyard('hotchkiss'),
    'dixon': door('dixon', -205, -135),
    'slight': door('slight', -160, -135),
    'waldock': door('waldock', -240, -140),
    'smith': door('smith', -290, -135),
    'sweazy': door('sweazy', -270, -135),
    'king': door('king', -30, -55),
    'gym': door_facing('kinesiology', 0, -1),
    'communication': door('communication', 60, 140),
    'biblical': door('biblical', 200, 180),
    'business': door('business', 250, 230),
    'music': door('music', 250, 190),
    'humanities': door('humanities', 200, 250),
    'education': door_facing('education', 0, 1),
    'church': door_facing('church', 0.8, 0.6),
    'quad': open_near(-71, -50),
    'herwaldtLawn': open_near(-13, 46),
    'northLawn': open_near(180, 194),
    'stadium': [R(pc[0]), R(pc[1])],
    'baseball': open_near(18, 40),
    'intramural': open_near(-290, -266),
    'eastLot': lot_spot(272, -140),
    'westLot': lot_spot(-200, -50),
    'dormLot': lot_spot(-130, -170),
    'northLot': lot_spot(232, 190),
    'smithLot': lot_spot(-340, -180),
    'placeritos': open_near(-150, 232),
    'meadview': open_near(-62, 150),
    'quigley': open_near(166, 60),
    # Prayer Hill is the knob above the Chancellor's House where the real white cross stands
    # (seen from the main entrance on Placerita Canyon Rd); the climb starts where the trail up
    # to it leaves campus
    'hillBase': open_near(45, -168, avoid_roads=False),
    'hill': [121, -231],
    'cartHotchkiss': open_near(-70, -95),
    'cartDunkin': open_near(150, -120),
    'cartDorms': open_near(-180, -135),
    'cartNorth': open_near(180, 150),
    'deanCart': open_near(20, -85),
    'mainEntrance': open_near(70, -45, avoid_roads=False),
}
# Baseball diamond: home plate in the southwest corner of Reese Field, facing center field (northeast)
home = (12.0, 14.0)
theta = math.radians(62)
def at(d, a): return (home[0] + math.cos(a) * d, home[1] + math.sin(a) * d)
arc = [home] + [at(30, theta + math.radians(t)) for t in range(-45, 46, 5)]
infield = [at(0.0, theta), at(27.4, theta - math.pi / 4), at(38.8, theta), at(27.4, theta + math.pi / 4)]
grass = [at(4.5, theta), at(25.0, theta - math.pi / 4 + 0.05), at(34.0, theta), at(25.0, theta + math.pi / 4 - 0.05)]
out['diamond'] = {'dirt': [[R(x), R(y)] for x, y in arc], 'grass': [[R(x), R(y)] for x, y in grass], 'bases': [[R(x), R(y)] for x, y in infield]}

out['places'] = places
# Put each building's front door where its mission/ride spot is
DOOR_PLACE = {'chapel': 'chapelDoor', 'dunkin': 'grill', 'library': 'library', 'reece': 'reece', 'hotchkiss': 'hotchkiss',
              'dixon': 'dixon', 'slight': 'slight', 'waldock': 'waldock', 'smith': 'smith', 'sweazy': 'sweazy', 'king': 'king',
              'kinesiology': 'gym', 'communication': 'communication', 'biblical': 'biblical', 'business': 'business',
              'music': 'music', 'humanities': 'humanities', 'education': 'education', 'church': 'church'}
for bd in buildings:
    if bd['id'] in DOOR_PLACE:
        bd['door'] = places[DOOR_PLACE[bd['id']]]

# ---------------------------------------------------------------- write the JS module
JS = OUT
def dump_list(key, items):
    body = ',\n'.join('    ' + json.dumps(it, separators=(',', ':')) for it in items)
    return f'  {key}: [\n{body},\n  ],\n'
parts = [
    "// Campus layout for Grand Mustang Auto, generated from OpenStreetMap data.\n",
    "// Map data (c) OpenStreetMap contributors, available under the Open Database License (ODbL).\n",
    "// https://www.openstreetmap.org/copyright\n",
    "//\n",
    "// Units are meters at real-world scale. x points east, y points north, and the origin is\n",
    f"// lat {out['origin'][0]}, lon {out['origin'][1]}. The world builder converts these to\n",
    "// Three.js space (x, z = -y). Don't edit by hand: change tools/osm_to_campus.py (named\n",
    "// buildings, mission spots in `places`) and regenerate:\n",
    "//   python3 tools/osm_to_campus.py tools/data/tmu.osm src/data/campus.js\n\n",
    "export const CAMPUS = {\n",
    f"  bounds: {json.dumps(out['bounds'], separators=(', ', ': '))},\n",
    f"  origin: {json.dumps(out['origin'])},\n",
    dump_list('campus', out['campus']),
    dump_list('roads', out['roads']),
    dump_list('signs', out['signs']),
    f"  stops: {json.dumps(out['stops'])},\n",
    dump_list('lawns', out['lawns']),
    f"  diamond: {json.dumps(out['diamond'], separators=(',', ':'))},\n",
    dump_list('lots', out['lots']),
    f"  stalls: {json.dumps(out['stalls'], separators=(',', ':'))},\n",
    dump_list('washes', out['washes']),
    dump_list('buildings', out['buildings']),
    "  places: {\n",
    ''.join(f"    {k}: {json.dumps(v)},\n" for k, v in out['places'].items()),
    "  },\n};\n",
]
open(JS, 'w').write(''.join(parts))
print('wrote', JS, file=sys.stderr)
