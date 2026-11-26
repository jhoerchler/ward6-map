# Truck restrictions (site/trucks/)

Every street, area, parking or idling restriction that a St. Louis ordinance puts
on tractor-trailers and other commercial trucks, drawn on the city's street
centerlines. Built for the 6th Ward site; the map opens on Ward 6.

## How it was compiled

1. **Every ordinance online, read in full.** The city's ordinance archive starts at
   Ordinance 62284 (1991). All 9,889 ordinances from 62284 to 72198 were opened and
   their PDF text searched for trucks, tractors, trailers, semi-trailers, commercial
   vehicles, gross vehicle weight and through traffic. 15 PDFs are scanned images
   with no text; their titles were checked by hand and none concern traffic.
   The keyword hits were then read to keep only street or area restrictions.
   Results: `raw_ordinances.json` (method, the full hit list, and the text of each
   kept ordinance).
2. **The current Revised Code.** Chapters 17.30 (Trucks), 17.68 (Trucks by weight),
   17.78 (Vehicle noise), 17.185, 17.210 and 17.215 on Municode. This is how limits
   older than 1991 that are still law show up (Ordinance 57457, 1977, downtown;
   Ordinance 61303, 1989, idling on Lindell and Newstead).
3. **Board bills.** Every board bill title since 2005, and the 2025-26 and 2026-27
   session lists, checked for truck bills that never passed. None besides an alley
   bill (BB 309, 2016-17).
4. **OpenStreetMap.** `hgv=no|destination|delivery`, `goods`, `maxweight` and
   no-truck signs inside the city. Shown separately: they have no ordinance behind them.

## Known gaps

* Section 17.30.010 bans truck traffic on streets in "a schedule on file" with the
  Register and the Traffic Administrator. That schedule is not published, so those
  streets are missing unless someone mapped the sign on OpenStreetMap.
* Ordinances before 1991 that were later repealed are not online at all.
* Area outlines (downtown, Laclede's Landing, Gravois/Sidney/I-55) are approximate.

## Rebuild

```
python build_trucks.py      # needs shapely; reads raw_geo.json + raw_ordinances.json
```
Writes `trucks.json` (for the map) and `trucks.csv` (one row per restriction).
