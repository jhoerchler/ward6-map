"""Build site/trucks/trucks.json: tractor-trailer / commercial-vehicle restrictions in St. Louis.
Inputs (committed in sources/trucks/): raw_geo.json (city street centerlines, 2021 wards, OSM tags),
raw_ordinances.json (full-text scan of every ordinance online, 1991-2026)."""
import json, datetime
from shapely.geometry import mapping, Polygon, Point, LineString, shape
from shapely.ops import unary_union, polygonize, nearest_points
from geo import *

O={o['ord']:o for o in json.load(open('raw_ordinances.json'))['ordinances']}
SCAN=json.load(open('raw_ordinances.json'))['scan']
WARDS={f['properties']['WARD']:shape(f['geometry']) for f in G['wards']['features']}

def pt(names_a,names_b):
    p=xing(names_a,names_b)
    if p: return p[0]
    A=unary_union(lines(names_a)); B=unary_union(lines(names_b)); return nearest_points(A,B)[0]

SEVENTH=['S 7TH ST','S 7TH BLVD']; LEX=['LEXINGTON AVE','W LEXINGTON AVE','E LEXINGTON AVE']
MLK=['DR MARTIN LUTHER KING DR','W DR MARTIN LUTHER KING DR','E DR MARTIN LUTHER KING DR']
KHWY=['N KINGSHIGHWAY BLVD']; WPARK=['W PARK AVE','WEST PARK AVE']
NEWST=['N NEWSTEAD AVE','S NEWSTEAD AVE']; TAYLOR=['N TAYLOR AVE','S TAYLOR AVE']

SPONSOR_FIX={'Megan E Green':'Megan E. Green'}
def meta(o):
    r=O[o]; sp=(r['sponsors'] or '').split('\n')[0].split(',')[0].strip()
    return {'ord':str(o),'bb':r['board_bill'],'session':r['session'],'sponsor':SPONSOR_FIX.get(sp,sp),'effective':r['effective'],'pdf':r['pdf'],
            'link':f'https://www.stlouis-mo.gov/government/city-laws/ordinances/ordinance.cfm?ord={o}'}

ITEMS=[]
def add(o, geom, **k):
    d=meta(o) if o in O else {'ord':str(o),'link':f'https://library.municode.com/mo/st._louis/codes/code_of_ordinances?nodeId=TIT17VETR'}
    d.update(k); d['geom']=geom; ITEMS.append(d)

ALL='Commercial trucks, truck-tractors and trailers'
SEMI_26='Commercial trucks, truck-tractors and trailers over 26,000 lb gross vehicle weight'
COMM='Commercial vehicles (freight/delivery vehicles; pickups for personal use exempt)'
LOCAL='Local deliveries and trucks with no other route are allowed'

# --- Ward 6 ---
add(70441, seg_between(['MORGAN FORD RD'],['ARSENAL ST'],['UTAH ST']), kind='street', status='in force',
    where='Morganford Road, Arsenal Street to Utah Street', vehicles=SEMI_26, hours='All hours', exceptions=LOCAL+'; emergency vehicles and tow trucks exempt', code='17.30.022 A.6')
add(70863, seg_between(['UTAH ST'],['S GRAND BLVD'],['MORGAN FORD RD']), kind='street', status='in force',
    where='Utah Street, Grand Boulevard to Morganford Road', vehicles=SEMI_26, hours='All hours', exceptions=LOCAL+'; emergency vehicles and tow trucks exempt',
    code='Not shown in the online Revised Code (codification may lag)')
# --- elsewhere ---
add(69093, seg_between(['MCCAUSLAND AVE'],['MANCHESTER AVE'],['WISE AVE']), kind='street', status='in force',
    where='McCausland Avenue northbound, Manchester Avenue to Wise Avenue', vehicles=SEMI_26, hours='6 p.m. to 8 a.m., every day', exceptions='Emergency vehicles and tow trucks exempt', code='17.68.010 B')
add(69092, seg_between(['UNION BLVD'],['Interstate 70'],['W FLORISSANT AVE']), kind='street', status='repealed',
    where='Union Boulevard, I-70 to West Florissant Avenue', vehicles='Semi-trailer trucks (tractor-trailers)', hours='Certain hours',
    exceptions='Emergency vehicles and tow trucks exempt', code='Repealed by Ordinance 69503 (2013)')
add(70223, seg_between(['RUSSELL BLVD'],SEVENTH,['GRAVOIS AVE']), kind='street', status='in force',
    where='Russell Boulevard, Seventh Street to Gravois Avenue', vehicles=SEMI_26, hours='All hours', exceptions=LOCAL+'; emergency vehicles exempt', code='17.68.010 C')
for street,a,b,label in [(['CHIPPEWA ST'],['S BROADWAY'],['MARINE AVE'],'Chippewa Street, South Broadway to Marine Avenue'),
                         (['KEOKUK ST'],['S BROADWAY'],['MARINE AVE'],'Keokuk Street, South Broadway to Marine Avenue'),
                         (['OSAGE ST'],['S BROADWAY'],['MARINE AVE'],'Osage Street, South Broadway to Marine Avenue'),
                         (['MARINE AVE'],['OSAGE ST'],['MIAMI ST'],'Marine Avenue, Osage Street to Miami Street'),
                         (['KOSCIUSKO ST'],['CAHOKIA ST'],['PRESIDENT ST','W PRESIDENT ST'],'Kosciusko Street, Cahokia Street to President Street')]:
    add(70275, seg_between(street,a,b), kind='street', status='in force', where=label, vehicles=SEMI_26, hours='All hours',
        exceptions=LOCAL+'; emergency vehicles and tow trucks exempt', code='17.30.022 A.1-5')
add(71111, seg_between(WPARK,['HAMPTON AVE'],['HUGHES PL']), kind='street', status='in force',
    where='West Park Avenue, Hampton Avenue to Hughes Place', vehicles=COMM, hours='All hours', exceptions=LOCAL, code='17.185.020')
add(71275, seg_between(['HUGHES PL'],['DALE AVE'],WPARK), kind='street', status='in force',
    where='Hughes Place, Dale Avenue to West Park Avenue (extends Ordinance 71111)', vehicles=COMM, hours='All hours', exceptions=LOCAL,
    code='Not shown in the online Revised Code (codification may lag)')
add(71240, seg_between(['C D BANKS AVE'],['N NEWSTEAD AVE'],['PENDLETON AVE']), kind='street', status='in force',
    where='CD Banks Avenue, North Newstead Avenue to Pendleton Avenue', vehicles=COMM, hours='All hours', exceptions=LOCAL,
    code='Not shown in the online Revised Code (codification may lag)')
add(71618, seg_between(KHWY,LEX,MLK), kind='street', status='in force',
    where='Kingshighway Memorial Boulevard, Lexington Avenue to Dr. Martin Luther King Drive', vehicles=SEMI_26, hours='6 p.m. to 8 a.m., every day',
    exceptions='Emergency vehicles and tow trucks exempt', code='17.210.010')
add(71619, seg_between(KHWY,['W FLORISSANT AVE'],MLK), kind='parking', status='in force',
    where='Kingshighway Memorial Boulevard and lots abutting it, West Florissant Avenue to Dr. Martin Luther King Drive',
    vehicles='Parking of semi-trailer trucks, cabs or trailers', hours='All hours', exceptions='Emergency vehicles and tow trucks exempt', code='17.210.020')
add(71668, seg_between(['MERAMEC ST'],['S BROADWAY'],['S GRAND BLVD']), kind='street', status='in force',
    where='Meramec Street, South Broadway to Grand Boulevard', vehicles=COMM, hours='All hours', exceptions=LOCAL+'; emergency vehicles exempt', code='17.215')
# areas
tri=[seg_between(['GRAVOIS AVE'],['Interstate 55'],['SIDNEY ST']), seg_between(['SIDNEY ST'],['GRAVOIS AVE'],['Interstate 55']), seg_between(['Interstate 55'],['SIDNEY ST'],['GRAVOIS AVE'])]
corners=[pt(['GRAVOIS AVE'],['Interstate 55']), pt(['GRAVOIS AVE'],['SIDNEY ST']), pt(['SIDNEY ST'],['Interstate 55'])]
add(63976, Polygon([(p.x,p.y) for p in corners]), kind='area', status='in force',
    where='Area bounded by Gravois Avenue, Sidney Street and I-55', vehicles=ALL, hours='8 p.m. to 7 a.m., every day',
    exceptions='Emergency vehicles and tow trucks exempt', code='17.30.021', approx=True)
lks=unary_union(lines(['N LEONOR K SULLIVAN BLVD'])); wash=unary_union(lines(['WASHINGTON AVE']))
add(71981, Polygon([(-90.1862,38.63411), (-90.18622,38.62966), tuple(nearest_points(wash,lks)[0].coords[0]), tuple(pt(['N LEONOR K SULLIVAN BLVD'],['CARR ST']).coords[0])]),
    kind='area', status='in force', where="Laclede's Landing: Carr Street, Leonor K. Sullivan Boulevard, Washington Avenue and Lumiere Place Boulevard",
    vehicles=SEMI_26, hours='All hours', exceptions=LOCAL+'; emergency vehicles and tow trucks exempt', code='17.68.010 D', approx=True)
add(57457, Polygon([(-90.187593,38.623897), tuple(pt(['WALNUT ST'],['S TUCKER BLVD']).coords[0]), tuple(pt(['N TUCKER BLVD'],['CONVENTION PLZ']).coords[0]),
    tuple(pt(['N 6TH ST'],['CONVENTION PLZ']).coords[0]), tuple(pt(['N 6TH ST'],['WASHINGTON AVE']).coords[0]), (-90.18622,38.62966)]),
    kind='area', status='in force', ord_note='1977, before the online ordinance archive', effective='1977', session='1977',
    where='Downtown: Walnut Street, Tucker Boulevard (12th), Convention Plaza, Sixth Street, Washington Avenue and Memorial Drive (perimeter streets open to trucks)',
    vehicles='Trucks licensed over 24,000 lb', hours='All hours', exceptions='Loading, unloading or servicing inside the area (paperwork required)', code='17.68.010 A', approx=True)
idl=[seg_between(['LINDELL BLVD'],NEWST,TAYLOR), seg_between(NEWST,['WEST PINE BLVD'],['MARYLAND AVE'])]
add(61303, unary_union(idl), kind='idling', status='in force', effective='1989', session='1988-1989',
    where='Lindell Boulevard, Newstead Avenue to Taylor Avenue; Newstead Avenue, West Pine Boulevard to Maryland Avenue',
    vehicles='Commercial vehicles over 10,000 lb: no idling while parked or standing', hours='All hours', exceptions='Loading equipment, traffic, passengers, refrigerated deliveries', code='17.78.070')

def round_geom(g):
    def r(c): return [round(c[0],5), round(c[1],5)]
    m=mapping(g.simplify(0.00002))
    def walk(x):
        if isinstance(x[0],(int,float)): return r(x)
        return [walk(y) for y in x]
    return {'type':m['type'],'coordinates':walk(m['coordinates'])}

W6=WARDS[6]
for it in ITEMS:
    it['cls']=('repealed' if it['status']=='repealed' else it['kind'] if it['kind'] in ('parking','idling') else 'commercial' if it['vehicles']==COMM else 'night' if it['hours']!='All hours' else 'allday')
    g=it['geom']
    it['wards']=sorted(w for w,P in WARDS.items() if P.intersects(g.buffer(0.00015)))
    it['ward6']= 6 in it['wards']
    it['geom']=round_geom(g)

# OpenStreetMap
OSM=[]
for e in G['osm']['elements']:
    t=e['tags'] or {}
    if t.get('highway') in ('motorway','motorway_link','trunk','trunk_link'): continue
    geom=LineString(e['geom']) if len(e['geom'])>1 else Point(e['geom'][0])
    wards=sorted(w for w,P in WARDS.items() if P.intersects(geom.buffer(0.00015)))
    if not wards: continue
    desc=[]
    if t.get('hgv') in ('no',): desc.append('No trucks')
    elif t.get('hgv') in ('destination','delivery','local'): desc.append('Trucks: local delivery only')
    if t.get('goods'): desc.append('Goods vehicles: '+t['goods'])
    if t.get('maxweight'): desc.append('Weight limit '+t['maxweight'])
    if t.get('maxweightrating'): desc.append('Weight limit '+t['maxweightrating'])
    if t.get('traffic_sign'): desc.append('Sign '+t['traffic_sign'])
    if not desc: continue
    OSM.append({'osm':f"{e['type']}/{e['id']}", 'name':t.get('name',''), 'desc':'; '.join(desc), 'wards':wards, 'ward6':6 in wards, 'geom':round_geom(geom)})

out={'built':datetime.date.today().isoformat(),
 'scan':{'first':62284,'last':SCAN['range'][1] if False else 72198,'ordinances':SCAN['ordinances_found'],'with_text':SCAN['with_text'],'keyword_hits':len(SCAN['keyword_hits'])},
 'osm_as_of':G['osm']['osm_base'],
 'citywide':[
  {'code':'17.30.010','ord':'62926','year':1993,'text':'Truck traffic is banned (except to load, unload or service) on streets and alleys in a schedule kept by the Register and the Traffic Administrator. That schedule is not published online, so those streets can only be found by their signs.'},
  {'code':'17.30.020','ord':'64881','year':2000,'text':'No truck or bus may park on a street next to residential (A-F) zoning, and no tractor, truck-tractor or trailer may be parked or stored on any street or alley without a Streets permit.'},
  {'code':'17.30.030','ord':'61185','year':1989,'text':'Size limits on every street: 108 in. wide, 15 ft high, 40 ft long (65 ft combined), 22,400 lb per axle, unless the Director of Streets issues a permit.'}],
 'items':ITEMS, 'osm':OSM, 'ward6':round_geom(W6)}
json.dump(out,open('trucks.json','w'),separators=(',',':'))
print(len(ITEMS),'items', len(OSM),'osm', len(json.dumps(out,separators=(',',':'))),'bytes')
for it in ITEMS: print(it['ord'], it['status'], it['kind'], it['wards'], it['where'][:70], it['geom']['type'], len(json.dumps(it['geom'])))

# Flat table of every restriction (one row per street/area), for spreadsheets.
import csv
from shapely.geometry import shape as _shape
with open('trucks.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f)
    w.writerow(['ordinance','board_bill','session','sponsor','took_effect','status','type','location','vehicles','hours','exceptions','city_code','wards','in_ward_6','ordinance_page','ordinance_pdf'])
    for it in ITEMS:
        w.writerow([it['ord'],it.get('bb',''),it.get('session',''),it.get('sponsor',''),it.get('effective',''),it['status'],it['kind'],it['where'],it['vehicles'],it['hours'],it.get('exceptions',''),it.get('code',''),' '.join(map(str,it['wards'])),'yes' if it['ward6'] else 'no',it['link'],it.get('pdf','')])
print('wrote trucks.csv')
