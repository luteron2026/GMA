"""Trace the real walks and plazas from USGS NAIP aerial photography into src/data/walks.js.

Usage (from the repo root; needs `pip install numpy opencv-python-headless scikit-image shapely pillow`):
    python3 tools/fetch_lidar.py WORK/all.npz            # the LiDAR points (if not done already)
    node -e "import('./src/data/campus.js').then(({CAMPUS})=>require('fs').writeFileSync('WORK/campus.json',
      JSON.stringify(CAMPUS)))"
    python3 tools/naip_walks.py WORK src/data/walks.js

1. Downloads the NAIP photo of the game area (public domain, imagery.nationalmap.gov) at
   0.3 m/pixel, in the campus frame.
2. Marks everything the LiDAR has standing more than 2.2 m above ground (roofs, crowns, cars
   under trees) so it can't be mistaken for concrete.
3. Concrete = bright, gray, smooth pixels off the mapped buildings, drives and lots: wide
   areas become outlines (TRACED_PAVING), narrow ones center lines with widths (TRACED_WALKS).
4. Open ground (lawn, dirt) the photo shows clearly, as a 1 m grid (OPEN_GROUND), which the
   game uses to cut its guessed entrance walks.
"""
import sys, os, math, json, subprocess
import numpy as np, cv2
from PIL import Image
from skimage.morphology import skeletonize
from shapely.geometry import Polygon

WORK, OUT = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(WORK, 'naip'), exist_ok=True)
os.chdir(WORK)
OUT = OUT if os.path.isabs(OUT) else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', OUT)
C_ALL = json.load(open('campus.json'))
json.dump({k: C_ALL[k] for k in ('roads', 'lots', 'lawns')} | {'buildings': [{'poly': b['poly']} for b in C_ALL['buildings']]}, open('campus_slim.json', 'w'))
json.dump(C_ALL['campus'], open('campus_area.json', 'w'))

# ---------------------------------------------------------------- 1. the photo
D='naip'
LAT0=(34.3794820+34.3856540)/2; LON0=(-118.5234580+-118.5141990)/2
KX=111320*math.cos(math.radians(LAT0)); KY=110574
X0,X1,Y0,Y1=-420,360,-345,335; RES=0.3
W=round((X1-X0)/RES); H=round((Y1-Y0)/RES)
mosaic=np.zeros((H,W,3),np.uint8)
nx,ny=2,2
for i in range(nx):
  for j in range(ny):
    xa=X0+(X1-X0)*i/nx; xb=X0+(X1-X0)*(i+1)/nx
    ya=Y0+(Y1-Y0)*j/ny; yb=Y0+(Y1-Y0)*(j+1)/ny
    lo0,lo1,la0,la1=LON0+xa/KX, LON0+xb/KX, LAT0+ya/KY, LAT0+yb/KY
    w=round((xb-xa)/RES); h=round(w*(la1-la0)/(lo1-lo0))
    bb='%.8f,%.8f,%.8f,%.8f'%(lo0,la0,lo1,la1)
    base=('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage'
         f'?bbox={bb}&bboxSR=4326&imageSR=4326&size={w},{h}&format=png&interpolation=RSP_BilinearInterpolation')
    e=json.loads(subprocess.run(['curl','-sS','-m','60',base+'&f=json'],capture_output=True,text=True).stdout)['extent']
    out=f'{D}/q{i}{j}.png'
    subprocess.run(['curl','-sS','-m','180','-o',out,base+'&f=image'],check=True)
    im=np.asarray(Image.open(out).convert('RGB'))
    # resample into the square-meter mosaic using the returned extent
    ex0,ex1,ey0,ey1=(e['xmin']-LON0)*KX,(e['xmax']-LON0)*KX,(e['ymin']-LAT0)*KY,(e['ymax']-LAT0)*KY
    print(i,j,im.shape,'extent err m',round(ex0-xa,2),round(ex1-xb,2),round(ey0-ya,2),round(ey1-yb,2))
    c0=round((xa-X0)/RES); c1=round((xb-X0)/RES); r0=round((Y1-yb)/RES); r1=round((Y1-ya)/RES)
    xs=X0+(np.arange(c0,c1)+0.5)*RES; ys=Y1-(np.arange(r0,r1)+0.5)*RES
    ci=((xs-ex0)/(ex1-ex0)*im.shape[1]).astype(int).clip(0,im.shape[1]-1)
    ri=((ey1-ys)/(ey1-ey0)*im.shape[0]).astype(int).clip(0,im.shape[0]-1)
    mosaic[r0:r1,c0:c1]=im[ri][:,ci]
Image.fromarray(mosaic).save(f'{D}/campus_naip.png')
Image.fromarray(mosaic).resize((W//4,H//4)).save(f'{D}/campus_naip_small.png')
print(W,H)

# ---------------------------------------------------------------- 2. raised things (LiDAR)
# Raster (0.3 m, same frame as the NAIP mosaic) of places with something standing above the ground
d=np.load('all.npz')['pts']; x,y,z,cl=d.T[:4]
X0,Y1,RES=-420,335,0.3; W,H=2600,2267
g=cl==2
# ground height on a 1 m grid, filled
G=1.0; gw,gh=int(780/G)+1,int(680/G)+1
gx=((x[g]-X0)/G).astype(int).clip(0,gw-1); gy=((Y1-y[g])/G).astype(int).clip(0,gh-1)
gz=np.full((gh,gw),np.inf,np.float32); np.minimum.at(gz,(gy,gx),z[g])
for k in range(20):
    nb=gz.copy()
    for dy in(-1,0,1):
        for dx in(-1,0,1): nb=np.minimum(nb,np.roll(np.roll(gz,dy,0),dx,1))
    gz=np.where(np.isinf(gz),nb,gz)
ng=~g
ix=((x[ng]-X0)/G).astype(int).clip(0,gw-1); iy=((Y1-y[ng])/G).astype(int).clip(0,gh-1)
hag=z[ng]-gz[iy,ix]
m=hag>2.2
px=((x[ng][m]-X0)/RES).astype(int).clip(0,W-1); py=((Y1-y[ng][m])/RES).astype(int).clip(0,H-1)
E=np.zeros((H,W),np.uint8); E[py,px]=1
E=cv2.dilate(E,np.ones((3,3),np.uint8))
E=cv2.morphologyEx(E,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
cv2.imwrite('elevated.png',E*255)

# ---------------------------------------------------------------- 3a. wide paving
X0,Y1,RES=-420,335,0.3
im=cv2.imread('naip/campus_naip.png'); H,W=im.shape[:2]
hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV).astype(np.float32)
b,g,r=[im[:,:,k].astype(np.float32) for k in range(3)]
V=hsv[:,:,2]; S=hsv[:,:,1]
Vb=cv2.blur(V,(5,5)); sd=np.sqrt(np.maximum(cv2.blur(V*V,(5,5))-Vb*Vb,0))
concrete=(V>132)&(S<48)&(g<r+10)&(r-b<22)&(b-r<30)&(sd<14)
E=cv2.imread('elevated.png',0)>0
C=json.load(open('campus_slim.json'))
P=lambda pts: np.array([[(x-X0)/RES,(Y1-y)/RES] for x,y in pts],np.int32)
block=np.zeros((H,W),np.uint8)
for bd in C['buildings']: cv2.fillPoly(block,[P(bd['poly'])],1)
for l in C['lots']: cv2.fillPoly(block,[P(l['poly'])],1)
for rd in C['roads']:
    if rd['kind'] in('street','service','aisle','driveway'):
        cv2.polylines(block,[P(rd['pts'])],False,1,thickness=max(1,int(rd['width']/RES)))
block=cv2.dilate(block,np.ones((3,3),np.uint8))
camp=np.zeros((H,W),np.uint8)
CAMPUS=json.load(open('campus_area.json'))
for p in CAMPUS: cv2.fillPoly(camp,[P(p)],1)
camp=cv2.dilate(camp,np.ones((51,51),np.uint8))
m=(concrete&(block==0)&~E&(camp>0)).astype(np.uint8)
m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
n,lab,st,_=cv2.connectedComponentsWithStats(m,8)
keep=np.zeros(n,bool); keep[1:]=st[1:,cv2.CC_STAT_AREA]*RES*RES>10
m=keep[lab].astype(np.uint8)
cv2.imwrite('tracemask.png',m*255)
cs,hier=cv2.findContours(m,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE)
toC=lambda c:[[round(X0+(px+0.5)*RES,1),round(Y1-(py+0.5)*RES,1)] for px,py in c.reshape(-1,2)]
out=[]
for i,c in enumerate(cs):
    if hier[0][i][3]!=-1: continue  # holes handled with their parent
    poly=cv2.approxPolyDP(c,1.4,True)
    if len(poly)<3: continue
    holes=[]
    k=hier[0][i][2]
    while k!=-1:
        hp=cv2.approxPolyDP(cs[k],1.4,True)
        if len(hp)>=3 and cv2.contourArea(hp)*RES*RES>2: holes.append(toC(hp))
        k=hier[0][k][0]
    pg=toC(poly)
    if Polygon(pg).area<10: continue
    out.append({'poly':pg,'holes':holes} if holes else {'poly':pg})
json.dump(out,open('traced.json','w'))
print(len(out),'polys',sum(len(o['poly'])+sum(len(h) for h in o.get('holes',[])) for o in out),'verts, area',round(sum(Polygon(o['poly']).area for o in out)))

# ---------------------------------------------------------------- 4. open ground
X0,Y1,RES=-420,335,0.3
im=cv2.imread('naip/campus_naip.png'); H,W=im.shape[:2]
hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV).astype(np.float32)
b,g,r=[im[:,:,k].astype(np.float32) for k in range(3)]
V=hsv[:,:,2]; S=hsv[:,:,1]
Vb=cv2.blur(V,(5,5)); sd=np.sqrt(np.maximum(cv2.blur(V*V,(5,5))-Vb*Vb,0))
E=cv2.imread('elevated.png',0)>0
loose=(V>110)&(S<62)&(r-b<32)&(sd<20)
dark=V<60   # deep shade: can't tell
C=json.load(open('campus_slim.json'))
P=lambda pts: np.array([[(x-X0)/RES,(Y1-y)/RES] for x,y in pts],np.int32)
block=np.zeros((H,W),np.uint8)
for bd in C['buildings']: cv2.fillPoly(block,[P(bd['poly'])],1)
for l in C['lots']: cv2.fillPoly(block,[P(l['poly'])],1)
for rd in C['roads']:
    if rd['kind'] in('street','service','aisle','driveway'):
        cv2.polylines(block,[P(rd['pts'])],False,1,thickness=max(1,int(rd['width']/RES)))
loose_d=cv2.dilate(loose.astype(np.uint8),np.ones((3,3),np.uint8))>0
openg=~E & ~dark & ~loose_d & (block==0)
Hc,Wc=680,780
gs=cv2.resize(openg.astype(np.float32),(Wc,Hc),interpolation=cv2.INTER_AREA)
G=(gs>0.75).astype(np.uint8)
camp=np.zeros((Hc,Wc),np.uint8)
for p in json.load(open('campus_area.json')): cv2.fillPoly(camp,[np.array([[x+420,335-y] for x,y in p],np.int32)],1)
camp=cv2.dilate(camp,np.ones((31,31),np.uint8))
G=G*camp
cv2.imwrite('open1m.png',G*255)
rows=[]
for row in G:
    runs=[];cur=0;n=0
    for v in row:
        if v==cur: n+=1
        else: runs.append(n); cur=v; n=1
    runs.append(n)
    rows.append('.'.join(np.base_repr(x,36).lower() for x in runs))
s='|'.join(rows); open('grass_rle.txt','w').write(s)
print('open share',G.mean().round(3),'rle',len(s))
np.save('loose.npy',(loose&~E&(block==0)))

# ---------------------------------------------------------------- 3b. narrow walks
# Narrow walks as centerlines: skeleton of the (looser) concrete mask
X0,Y1,RES=-420,335,0.3
L=np.load('loose.npy').astype(np.uint8)
camp=np.zeros(L.shape,np.uint8)
for p in json.load(open('campus_area.json')): cv2.fillPoly(camp,[np.array([[(x-X0)/RES,(Y1-y)/RES] for x,y in p],np.int32)],1)
camp=cv2.dilate(camp,np.ones((51,51),np.uint8))
L=L*camp
L=cv2.morphologyEx(L,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
L=cv2.morphologyEx(L,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
n,lab,st,_=cv2.connectedComponentsWithStats(L,8)
keep=np.zeros(n,bool); keep[1:]=st[1:,cv2.CC_STAT_AREA]*RES*RES>6
L=keep[lab].astype(np.uint8)
dt=cv2.distanceTransform(L,cv2.DIST_L2,3)*RES   # meters to edge
sk=skeletonize(L>0)
# narrow parts only: half-width 0.5..1.6 m
sk&=(dt>0.45)&(dt<1.6)
# trace skeleton into polylines
H,W=sk.shape
ys,xs=np.nonzero(sk); pts=set(zip(ys.tolist(),xs.tolist()))
nb=lambda p:[(p[0]+dy,p[1]+dx) for dy in(-1,0,1) for dx in(-1,0,1) if (dy or dx) and (p[0]+dy,p[1]+dx) in pts]
deg={p:len(nb(p)) for p in pts}
seen=set(); lines=[]
starts=[p for p in pts if deg[p]!=2]+list(pts)
for s0 in starts:
    if s0 in seen: continue
    for first in nb(s0) or [None]:
        if first is None or first in seen: continue
        line=[s0,first]; seen.add(s0); seen.add(first); cur=first
        while deg.get(cur,0)==2:
            nx=[q for q in nb(cur) if q not in seen]
            if not nx: break
            cur=nx[0]; seen.add(cur); line.append(cur)
        lines.append(line)
out=[]
for line in lines:
    a=np.array(line)
    length=np.sum(np.hypot(*np.diff(a,axis=0).T))*RES
    if length<6: continue
    w=float(np.median([dt[y,x] for y,x in line]))*2
    c=cv2.approxPolyDP(a[:,::-1].reshape(-1,1,2).astype(np.int32),1.5,False).reshape(-1,2)
    out.append({'pts':[[round(X0+(x+0.5)*RES,1),round(Y1-(y+0.5)*RES,1)] for x,y in c],'width':round(max(1.4,min(3.2,w+0.3)),1)})
json.dump(out,open('skel.json','w'))
print(len(out),'centerlines, total m',round(sum(sum(np.hypot(*np.diff(np.array(o['pts']),axis=0).T)) for o in out)))

# ---------------------------------------------------------------- write
t=json.load(open('traced.json')); k=json.load(open('skel.json')); rle=open('grass_rle.txt').read()
js = """// Real paving from USGS NAIP aerial photography (public domain, 0.6 m, via
// imagery.nationalmap.gov), lined up with the campus frame and cross-checked with the LiDAR so
// roofs, cars and tree crowns aren't taken for concrete. Campus coordinates (m).
// Made by tools/naip_walks.py.

// Concrete walks and plazas seen in the photo (outlines, some with holes for planters)
export const TRACED_PAVING = """ + json.dumps(t, separators=(',', ':')) + """;

// Narrower walks, as center lines with their width
export const TRACED_WALKS = """ + json.dumps(k, separators=(',', ':')) + """;

// Ground the photo shows clearly is not paved (lawn, dirt, gravel; not under trees, roofs,
// drives or lots), 1 m cells, x from x0 east, rows from y1 south. Each row is run lengths in
// base 36, alternating not-open / open, starting with not-open.
export const OPEN_GROUND = { x0: -420, y1: 335, w: 780, h: 680, rle: '""" + rle + """' };
"""
open(OUT,'w').write(js); print(len(js))
