# Biochar Soil Suitability Atlas - National Map (Mode 1)

American Biochar Institute

This repository builds a UC Davis SoilWeb style national map of the USDA-NRCS
interpretation **SOH - Dynamic Soil Properties Response to Biochar** and publishes
it to the web. The whole thing runs in GitHub's cloud. Nothing runs on your
machine, and there is no gSSURGO download to manage.

## How it works

- A GitHub Actions workflow fetches the national gSSURGO map-unit-key grid at
  browse resolution from the UC Davis SoilWeb Web Coverage Service.
- It reclasses each map unit key to a biochar response class using the
  NRCS-published rating in `data/biochar_national_lookup.csv`.
- It colors the five classes, reprojects to Web Mercator, and cuts a static tile
  pyramid.
- It publishes the viewer plus the tiles to GitHub Pages. You embed that page in
  a WordPress page on biochar.org with an iframe.

Nothing here recomputes the NRCS rating. It rasterizes what NRCS published, which
is the whole point of the Mode 1 design. The step that used to hang, rasterizing
36.7 million soil polygons, is gone: the national mukey grid already exists as a
public service, so that step is now a download.

## What is in the repo

- `.github/workflows/build-and-deploy.yml` - the cloud build and publish
- `build/build_biochar_tiles.py` - fetch the grid, reclass, color, reproject, tile
- `build/reclass_mukey_to_rating.py` - the verified ABI reclass script (unchanged)
- `build/biochar_class_colors.txt` - the five-class color table
- `viewer/index.html` - the ABI-branded Leaflet viewer
- `data/biochar_national_lookup.csv` - you add this (see `data/README.md`)
- `WORDPRESS_EMBED.md` - how to place the map on biochar.org

## One-time setup

1. Create a free GitHub account if you do not have one. All steps below happen in
   the browser.
2. Create a new repository, for example `biochar-national-map`, and upload the
   contents of this folder. Keep the folder layout.
3. Add the lookup file: drop `biochar_national_lookup.csv` into the `data/`
   folder (see `data/README.md`).
4. Turn on Pages: repository **Settings -> Pages -> Build and deployment ->
   Source = GitHub Actions**.
5. Run the build: **Actions** tab -> **Build and deploy biochar national map** ->
   **Run workflow**. For the first run, set resolution to `1000` to get a quick
   national map in a few minutes and confirm the pipeline works end to end. Then
   run it again at `300` for the detailed browse layer.
6. When the run finishes, open the Pages URL it reports, something like
   `https://<your-account>.github.io/biochar-national-map/`. That is your live map.
7. Embed it on biochar.org (see `WORDPRESS_EMBED.md`).

## Resolution and zoom

- `resolution` is the grid cell size in meters. Lower is more detailed and takes
  longer to build. `1000` is a fast national test. `300` is a good browse layer
  and the default. Going below about `200` mostly grows build time and tile count
  without helping a national overview.
- `zoom` is the tile pyramid range. `3-9` covers national down to county-ish
  browsing. The viewer lets users zoom in past the built levels by upscaling, so
  there is no need to build deep zooms for an overview map.

## Yearly refresh

SSURGO refreshes on October 1, and the SoilWeb grid syncs by early November. The
workflow is scheduled to rebuild automatically in mid-November. Before that run,
replace `data/biochar_national_lookup.csv` with a lookup regenerated from the new
gSSURGO so the rating and the grid share the same vintage. You can also rebuild
any time from the Actions tab.

## Accuracy notes

- **Quarter-cut classes.** The rating classes use quarter cuts, verified against
  national data: 0 Negligible, 0.001 to 0.250 Low, 0.251 to 0.500 Fair, 0.501 to
  0.750 Good, 0.751 to 1.0 Excellent. The color table and viewer legend both use
  these breaks.
- **gSSURGO, not gNATSGO.** The build uses the gSSURGO mukey grid so its keys
  match the gSSURGO-keyed lookup. gNATSGO fills gaps with STATSGO and RSS keys
  that would not join, so gaps are left unshaded rather than filled with a
  different data source.
- **Dominant component.** The lookup rolls each map unit up by dominant component,
  which matches Web Soil Survey on the large majority of units. For an exact
  dominant-condition match, regenerate the lookup by dominant condition; nothing
  else in the pipeline changes.
- **Native condition.** The rating describes the soil as mapped, in its native
  condition. Water table, ponding, and flooding reflect undrained hydrology, so
  some soils that rate low may respond well once drained. The viewer states this.

## A note on the one live dependency

The build fetches the mukey grid from the SoilWeb Web Coverage Service at run
time. The request shape was taken from the soilDB R client and confirmed against
the service capabilities, and the rest of the pipeline is verified. If SoilWeb is
ever down or changes its service, the fetch step is the place to look. As a
fallback, the same national mukey grid is downloadable from the USDA Geospatial
Data Gateway and can be swapped in without touching the reclass, color, or tile
steps.

## Source

USDA-NRCS SSURGO, interpretation SOH - Dynamic Soil Properties Response to
Biochar. National map-unit-key grid via the UC Davis California Soil Resource Lab
SoilWeb Web Coverage Service. Prepared by the American Biochar Institute.
