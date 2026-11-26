import json, math
from shapely.geometry import LineString, MultiLineString, Point, shape, Polygon, mapping
from shapely.ops import linemerge, nearest_points, substring, unary_union
G=json.load(open('raw_geo.json'))
def lines(names):
    ls=[]
    for s in G['streets']:
        if s['n'] in names and s['g']:
            for p in s['g']:
                if len(p)>1: ls.append(LineString(p))
    return ls
def merged(names):
    return linemerge(unary_union(lines(names)))
M=111320*math.cos(math.radians(38.6))
def dist_m(a,b): return math.hypot((a.x-b.x)*M,(a.y-b.y)*111320)
def xing(a_names,b_names):
    A=unary_union(lines(a_names)); B=unary_union(lines(b_names))
    i=A.intersection(B)
    if not i.is_empty:
        pts=[i] if i.geom_type=='Point' else list(getattr(i,'geoms',[i]))
        pts=[p if p.geom_type=='Point' else p.centroid for p in pts]
        return pts
    p,q=nearest_points(A,B); 
    return [p] if dist_m(p,q)<100 else []
def seg(street, a, b, pick=None):
    m=merged(street)
    parts=list(m.geoms) if m.geom_type=='MultiLineString' else [m]
    pa=xing(street,a); pb=xing(street,b)
    if not pa or not pb: raise Exception(f'no xing {street} {a if not pa else b}')
    best=None
    for P in pa:
        for Q in pb:
            for L in parts:
                if L.distance(P)<0.0003 and L.distance(Q)<0.0003:
                    d=L.project(P); e=L.project(Q)
                    s=substring(L,min(d,e),max(d,e))
                    if s.length>0 and (best is None or (pick=='long' and s.length>best.length) or (pick!='long' and s.length<best.length)): best=s
    if best is None:
        # fallback: union of pieces between projections
        raise Exception(f'no single part {street} {a} {b}; parts={len(parts)}')
    return best

def seg_between(street, a, b, perp=80):
    pa=xing(street,a); pb=xing(street,b)
    if not pa or not pb: raise Exception(f'no xing {street} {a if not pa else b}')
    try:
        return seg(street,a,b)
    except Exception:
        pass
    P,Q=pa[0],pb[0]
    vx,vy=(Q.x-P.x)*M,(Q.y-P.y)*111320; L2=vx*vx+vy*vy
    out=[]
    for l in lines(street):
        c=l.interpolate(0.5,normalized=True)
        wx,wy=(c.x-P.x)*M,(c.y-P.y)*111320
        t=(wx*vx+wy*vy)/L2
        d=abs(wx*vy-wy*vx)/math.sqrt(L2)
        if -0.01<=t<=1.01 and d<perp: out.append(l)
    if not out: raise Exception('none between')
    u=unary_union(out)
    return linemerge(u) if u.geom_type=='MultiLineString' else u
