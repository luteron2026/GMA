"""Download the USGS 3DEP LiDAR points that cover the campus (public domain).

Usage: python3 tools/fetch_lidar.py OUT.npz   (needs `pip install 'laspy[lazrs]' numpy`)

Reads the Entwine Point Tile index at s3://usgs-lidar-public/CA_LosAngeles_1_B23 and keeps
every point inside the game area. Output columns: x east, y north (meters from the campus
origin, same projection as campus.js), z elevation (m), classification (this survey only
splits ground (2) from everything else (1)), return number, number of returns.
"""
import sys, json, math, urllib.request, concurrent.futures as cf
import numpy as np, laspy

BASE = 'https://usgs-lidar-public.s3.amazonaws.com/CA_LosAngeles_1_B23/'
# Same local projection as tools/osm_to_campus.py: the center of the OSM export's bounds
LAT0 = (34.3794820 + 34.3856540) / 2
LON0 = (-118.5234580 + -118.5141990) / 2
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574
R = 6378137.0  # the point cloud is in web mercator (EPSG:3857)
AREA = (-470, -395, 410, 385)  # minX, minY, maxX, maxY in local meters

def to_merc(x, y):
    lon, lat = LON0 + x / KX, LAT0 + y / KY
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

def from_merc(mx, my):
    lon = np.degrees(mx / R)
    lat = np.degrees(np.arctan(np.sinh(my / R)))
    return (lon - LON0) * KX, (lat - LAT0) * KY

BX = to_merc(AREA[0], AREA[1]) + to_merc(AREA[2], AREA[3])

def get(path):
    for i in range(5):
        try:
            with urllib.request.urlopen(BASE + path, timeout=60) as r:
                return r.read()
        except Exception:
            if i == 4: raise

ept = json.loads(get('ept.json'))
root = ept['bounds']

def node_bounds(d, x, y, z):
    s = (root[3] - root[0]) / 2 ** d
    return root[0] + x * s, root[1] + y * s, root[0] + (x + 1) * s, root[1] + (y + 1) * s

def hits(key):
    d, x, y, z = map(int, key.split('-'))
    b = node_bounds(d, x, y, z)
    return not (b[2] < BX[0] or b[0] > BX[2] or b[3] < BX[1] or b[1] > BX[3])

nodes = []
def walk(file):
    h = json.loads(get('ept-hierarchy/' + file + '.json'))
    subs = []
    for key, n in h.items():
        if not hits(key): continue
        if n == -1: subs.append(key)
        elif n > 0: nodes.append(key)
    for s in subs: walk(s)
walk('0-0-0-0')
print(len(nodes), 'nodes', file=sys.stderr)

def load(key):
    las = laspy.read(__import__('io').BytesIO(get('ept-data/' + key + '.laz')))
    x, y = from_merc(np.asarray(las.x), np.asarray(las.y))
    m = (x >= AREA[0]) & (x <= AREA[2]) & (y >= AREA[1]) & (y <= AREA[3])
    return np.stack([x[m], y[m], np.asarray(las.z)[m],
                     np.asarray(las.classification)[m], np.asarray(las.return_number)[m],
                     np.asarray(las.number_of_returns)[m]], 1).astype(np.float32)

parts = []
with cf.ThreadPoolExecutor(16) as ex:
    for i, p in enumerate(ex.map(load, nodes)):
        parts.append(p)
        if i % 50 == 0: print(i, file=sys.stderr)
pts = np.concatenate(parts)
print(pts.shape, file=sys.stderr)
np.savez_compressed(sys.argv[1], pts=pts)
