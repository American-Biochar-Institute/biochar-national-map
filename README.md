# Soil response to biochar: national map

American Biochar Institute (the Institute). Live map: https://american-biochar-institute.github.io/biochar-national-map/

A public map of the USDA-NRCS soil interpretation **SOH - Dynamic Soil Properties Response to Biochar** for the lower 48 states, at native 30 m resolution. Visitors see the NRCS rating, can build the Institute's adjusted score from a few choices, and can look up the soils in their own fields. The companion **Biochar Response Rating Explorer** (`explorer.html`) explains the evidence behind each factor.

## What the map does

- **Starts with the NRCS rating.** With the default choices, every soil shows its published NRCS rating.
- **Adjusted score (optional).** Three controls change it: whether the land is artificially drained, whether the biochar has a meaningful liming value, and whether to leave out factors research does not link to biochar response (slope, flooding, cobbles and stones, shrink-swell; all together or one at a time). The rules are in `policy.js` (version 2, October 2026). Adjusted scores are the Institute's estimates, not NRCS ratings.
- **Acreage** for the nation, any state or county, and the current view.
- **Your fields.** Draw fields or upload boundaries (.zip shapefile, GeoJSON, KML or KMZ). Soils come from USDA Soil Data Access through the Institute's lookup service; boundaries are not saved by the Institute. Each field shows acres by response class, the soils, what biochar might improve, and an optional soil test pH.

## How it is built

| Part | Where | What it serves |
|---|---|---|
| This site (GitHub Pages) | this repository | The page and its scripts, `policy.js`, summaries, boundaries, bundled water and Interstate layers, `explorer.html`. |
| Data worker | Cloudflare Worker `biochar-national-data` | The 30 m NRCS class grid (`20261006-native30m/`) and the 30 m map-unit index grid with its per-map-unit table (`20261010-index30m/`). |
| Lookup worker | Cloudflare Worker `biochar-aoi-public` | `POST /api/aoi`: looks up the soils in one field polygon from USDA Soil Data Access. Accepts requests from this site and biochar.org; about 30 lookups a minute per visitor and about 240 a minute per Cloudflare location. |

- The default view draws the published NRCS class layer. Any other choice scores all 323,322 map units in the browser (`index-grid.js`, `acreage-worker.js`) and recolors the map from the index grid.
- National, state and county acres are exact counts of 30 m cells. Field acres come from the soil boundaries clipped to the field.
- Base map: Esri Light Gray Canvas (no place names). Labels: state abbreviations at national zooms, county names from zoom 8. Water (off by default): Natural Earth. Interstates (off by default): Natural Earth 10m roads. Aerial imagery: Esri. The map zooms to level 18.
- Address search: in the field toolbar (after "Select fields on the map"), Esri World Geocoding Service with suggestions as you type; a chosen address is marked with a blue pin and shown at zoom 17 on aerial imagery. Done clears it. Searches are not stored.

## Publishing

The workflow `.github/workflows/build-and-deploy.yml` copies the site files listed in it into the Pages artifact and deploys it (Actions tab, **Build and deploy biochar national map**, Run workflow). The three parts must be deployed together when the scoring changes, because the page, the data worker's table and `policy.js` must agree. The build scripts and validation tests live in the Institute's working folder, not in this repository.

## Accuracy notes

- Ratings use the dominant soil component of each map unit. Web Soil Survey uses dominant condition; the two differ on some map units.
- 142 rated map units (about 551,600 acres) have no adjusted score because the Institute's engine cannot reproduce their NRCS rating. They keep their NRCS rating with the default choices and are shown separately otherwise.
- Classes: 0 Negligible, 0.001 to 0.250 Low, 0.251 to 0.500 Fair, 0.501 to 0.750 Good, 0.751 to 1 Excellent.
- Adjusted scores do not predict crop yield or establish program eligibility.

## Source

USDA-NRCS SSURGO and Soil Data Access (FY2026), interpretation SOH - Dynamic Soil Properties Response to Biochar. Prepared by the American Biochar Institute, Portland, Oregon. biochar.org
