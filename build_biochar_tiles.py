#!/usr/bin/env python3
"""
build_biochar_tiles.py
======================
Build the ABI national biochar-response tile map (Mode 1) entirely in the cloud,
with no local machine and no gSSURGO download.

Pipeline:
  1. Fetch the national gSSURGO map-unit-key (mukey) grid at browse resolution
     from the UC Davis SoilWeb Web Coverage Service (WCS), in chunks, and mosaic.
  2. Reclass mukey -> biochar class 1-5 using biochar_national_lookup.csv
     (NRCS's own published rating, quarter-cut classes). Reuses the verified
     reclass_mukey_to_rating.py from the ABI kit.
  3. Color the classes, reproject to Web Mercator, and cut an XYZ tile pyramid.

Nothing here recomputes the NRCS rating. It rasterizes what NRCS published,
exactly the point of the Mode 1 design. The heavy "rasterize 36.7M polygons"
step is replaced by a download of the ready-made national mukey grid.

Runs on a stock Ubuntu runner with GDAL >= 3.1 (needs gdal2tiles --xyz).
No R, no QGIS, no gSSURGO geodatabase.

Usage:
  python build_biochar_tiles.py --lookup ../data/biochar_national_lookup.csv \
      --colors biochar_class_colors.txt --out ../site --res 300 --zoom 3-9
"""

import argparse
import math
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

# --- SoilWeb WCS: national gSSURGO mukey grid ---
# Endpoint, coverage id, and request shape verified against the soilDB R source
# (ncss-tech/soilDB, R/mukey-WCS.R) and the service GetCapabilities document.
WCS_BASE = "http://casoilresource.lawr.ucdavis.edu/cgi-bin/mapserv?"
WCS_SVC = "map=/data1/website/wcs/mukey-grids.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
COVERAGE = "gssurgo"          # gSSURGO mukey grid; matches the gSSURGO-keyed lookup CSV
NATIVE_CRS = "EPSG:5070"      # USDA Albers, the grid's native CRS

# CONUS extent of the coverage in EPSG:5070 (from the soilDB grid definition).
CONUS = {"xmin": -2356125.0, "xmax": 2263755.0, "ymin": 260985.0, "ymax": 3172575.0}

# The WCS caps a single request at 5000x5000 px. Stay under it with a margin.
MAX_CHUNK_PX = 4500
UA = "ABI-Biochar-Atlas/1.0 (American Biochar Institute; national tile build)"


def run(cmd):
    """Run a shell command, echo it, fail loudly."""
    print("  $ " + " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True)


def wcs_url(xmin, xmax, ymin, ymax, res):
    """Build one WCS 2.0.1 GetCoverage KVP URL (mirrors the working soilDB request)."""
    return (
        WCS_BASE + WCS_SVC
        + "&COVERAGEID=" + COVERAGE
        + "&FORMAT=image/tiff"
        + "&GEOTIFF:COMPRESSION=DEFLATE"
        + "&SUBSETTINGCRS=" + NATIVE_CRS
        + "&SUBSET=" + urllib.parse.quote("x(%f,%f)" % (xmin, xmax), safe="")
        + "&SUBSET=" + urllib.parse.quote("y(%f,%f)" % (ymin, ymax), safe="")
        + "&RESOLUTION=" + urllib.parse.quote("x(%f)" % res, safe="")
        + "&RESOLUTION=" + urllib.parse.quote("y(%f)" % res, safe="")
    )


def download(url, dest, tries=4):
    """Download one chunk with retries; verify it is a readable raster."""
    from osgeo import gdal
    last = None
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
                f.write(r.read())
            ds = gdal.Open(dest)
            if ds is None or ds.RasterXSize == 0:
                raise RuntimeError("downloaded file is not a valid raster")
            ds = None
            return
        except Exception as e:  # noqa: BLE001
            last = e
            print("    [retry %d/%d] %s" % (attempt, tries, e), flush=True)
            time.sleep(5 * attempt)
    raise RuntimeError("WCS download failed after %d tries: %s\n  URL: %s" % (tries, last, url))


def fetch_mukey_grid(res, workdir):
    """Fetch the national mukey grid in aligned chunks and mosaic to a VRT."""
    from osgeo import gdal

    width_m = CONUS["xmax"] - CONUS["xmin"]
    height_m = CONUS["ymax"] - CONUS["ymin"]
    total_x_px = math.ceil(width_m / res)
    total_y_px = math.ceil(height_m / res)
    nx = math.ceil(total_x_px / MAX_CHUNK_PX)
    ny = math.ceil(total_y_px / MAX_CHUNK_PX)
    # chunk size in map units, snapped to whole pixels so chunks tile seamlessly
    chunk_w = math.ceil(total_x_px / nx) * res
    chunk_h = math.ceil(total_y_px / ny) * res
    print("Fetching gSSURGO mukey grid at %dm: %dx%d px, %d x %d = %d chunks"
          % (res, total_x_px, total_y_px, nx, ny, nx * ny), flush=True)

    os.makedirs(workdir, exist_ok=True)
    tiles = []
    n = 0
    for j in range(ny):
        for i in range(nx):
            n += 1
            xmin = CONUS["xmin"] + i * chunk_w
            xmax = min(xmin + chunk_w, CONUS["xmax"])
            ymin = CONUS["ymin"] + j * chunk_h
            ymax = min(ymin + chunk_h, CONUS["ymax"])
            dest = os.path.join(workdir, "mukey_%02d_%02d.tif" % (j, i))
            print("  chunk %d/%d  x[%.0f,%.0f] y[%.0f,%.0f]"
                  % (n, nx * ny, xmin, xmax, ymin, ymax), flush=True)
            download(wcs_url(xmin, xmax, ymin, ymax, res), dest)
            tiles.append(dest)

    vrt = os.path.join(workdir, "mukey_conus.vrt")
    gdal.BuildVRT(vrt, tiles)
    print("Mosaic VRT: %s" % vrt, flush=True)
    return vrt


def gdal2tiles_cmd():
    """gdal2tiles is 'gdal2tiles.py' or 'gdal2tiles' depending on the GDAL build."""
    from shutil import which
    for name in ("gdal2tiles.py", "gdal2tiles"):
        if which(name):
            return [name]
    return [sys.executable, "-m", "osgeo_utils.gdal2tiles"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lookup", required=True, help="biochar_national_lookup.csv (mukey,rating,class)")
    ap.add_argument("--colors", required=True, help="biochar_class_colors.txt")
    ap.add_argument("--out", required=True, help="output site folder (tiles land in <out>/tiles)")
    ap.add_argument("--res", type=int, default=300, help="grid resolution in meters (default 300)")
    ap.add_argument("--zoom", default="3-9", help="gdal2tiles zoom range (default 3-9)")
    ap.add_argument("--work", default="_work", help="scratch folder")
    args = ap.parse_args()

    if args.res < 30 or args.res > 3000:
        sys.exit("--res must be between 30 and 3000 meters")

    here = os.path.dirname(os.path.abspath(__file__))
    reclass = os.path.join(here, "reclass_mukey_to_rating.py")
    if not os.path.exists(reclass):
        sys.exit("reclass_mukey_to_rating.py must sit next to this script")

    os.makedirs(args.out, exist_ok=True)
    work = os.path.abspath(args.work)
    os.makedirs(work, exist_ok=True)

    # 1. national mukey grid (mosaic VRT), straight from the SoilWeb WCS
    mukey_vrt = fetch_mukey_grid(args.res, work)

    # 2. reclass mukey -> class 1-5 using the verified ABI reclass script (unchanged)
    class_prefix = os.path.join(work, "biochar_national")
    run([sys.executable, reclass, mukey_vrt, args.lookup, class_prefix])
    class_tif = class_prefix + "_class.tif"

    # 3. color the 5 classes (discrete, no interpolation)
    rgba = os.path.join(work, "biochar_national_rgba.tif")
    run(["gdaldem", "color-relief", class_tif, args.colors, rgba,
         "-alpha", "-nearest_color_entry",
         "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER"])

    # 4. reproject to Web Mercator for tiling (nearest so class colors stay crisp)
    merc = os.path.join(work, "biochar_national_3857.tif")
    run(["gdalwarp", "-t_srs", "EPSG:3857", "-r", "near", "-overwrite",
         "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER",
         rgba, merc])

    # 5. XYZ tile pyramid (Leaflet default scheme; matches the viewer's TMS=false)
    tiles_dir = os.path.join(args.out, "tiles")
    run(gdal2tiles_cmd() + ["--xyz", "--profile=mercator", "-z", args.zoom,
                            "-r", "near", "-w", "none", merc, tiles_dir])

    print("\nDone. Tiles in %s" % tiles_dir, flush=True)


if __name__ == "__main__":
    main()
