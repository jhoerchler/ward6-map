# Ward service request map (GitHub Pages)

An interactive map of City of St. Louis Citizens' Service Bureau requests in
one ward, built to sit in an iframe on the ward office's RUN! site. It is the
same map as QuickCSB's `/csb/wards/6/embed`, but published by GitHub instead of
the home server, so it keeps working whether or not that laptop is on.

```
build.py                      downloads + builds site/data/ward<N>.json (stdlib only)
site/                         the static page GitHub Pages serves
  index.html, embed.js, embed.css (Leaflet loads from cdnjs)
geodata/                      Ward 6 outline (simplified to ~2 m) + neighborhood names;
                              add other wards from QuickCSB geodata/wards.geojson
.github/workflows/update.yml  rebuild + publish every two hours
```

## How the data stays current

The workflow runs every two hours (at :17 past) and on every push to `main`:

1. Restores the city's 126 MB bulk export (`csb.zip`) from the Actions cache.
   It is downloaded fresh once a day; if the city's download fails, the last
   good copy is used and the next run retries.
2. Reads every year of the export and keeps the ward's still-open requests
   plus anything opened or finished in the last 400 days.
3. If the `CSB_API_KEY` secret is set, re-reads the city's live Open311 API
   for the days the export has not caught up with (up to 14), places each
   request in a ward by its coordinates, and lets those rows win.
4. Publishes `site/` to GitHub Pages.

Without the API key the map still works; it is just as current as the
city's last bulk export (usually a day behind).

## One-time setup

1. Repository: https://github.com/jhoerchler/ward6-map (public, so Pages is free).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → New repository secret**:
   name `CSB_API_KEY`, value = the same key QuickCSB uses (`secrets.bat`).
4. Optional, same page, **Variables** tab: `WARDS` = `6` (or `6,7` for several).
5. **Actions → Update ward map → Run workflow** for the first build. The site
   appears at `https://jhoerchler.github.io/ward6-map/`.

## Putting it on the RUN! site

Add a **Custom Code / Embed** block and paste:

```html
<iframe src="https://jhoerchler.github.io/ward6-map/"
  title="Ward 6 service request map" style="width:100%;height:100%;border:0"
  allow="geolocation" loading="lazy"></iframe>
```

Set the block's height (desktop / tablet / phone), e.g. 650 / 650 / 600 px.
RUN!'s editor disables scripts, so check it on the published page.

URL options: `?ward=7` (if built), `?accent=032673` (outline/selected colour; default is the ward site's navy),
`?status=open|closed|all`, `?days=30|90|365`, `?cat=trash,streets`.

## Things to know

- **GitHub pauses scheduled workflows after 60 days with no commits.** It
  emails a warning first; any push, or pressing "Enable workflow" on the
  Actions tab, starts it again.
- Welfare checks, homeless calls and encampment reports are left off the map
  (`PRIVATE` in `site/embed.js`): they are about a person, not a place.
- `site/embed.js` and `site/embed.css` are the same files as QuickCSB's
  `static/embed.*`. Change one, copy it to the other.

## Running it locally

```
python build.py --zip ../CSB_Request_Site/data/csb.zip --skip-live
python -m http.server -d site 8000      # then open http://localhost:8000
```
