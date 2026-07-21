#!/usr/bin/env python3
"""
build_biochar_tiles.py
======================
Color and tile the committed biochar class raster into an XYZ tile pyramid for
GitHub Pages.

The heavy work (national mukey grid -> biochar class raster) is done once with
make_class_raster.py and committed to the repo as biochar_class_300m.tif. This
build is therefore small and fast: it colors the five classes, reprojects to
Web Mercator, and cuts the tiles. No data download, no reclass at build time.

Runs on a stock Ubuntu runner with GDAL >= 3.1 (needs gdal2tiles --xyz).

Usage:
  python build_biochar_tiles.py --out site --zoom 3-9
"""
import argparse
import os
import subprocess
import sys
from shutil import which


def run(cmd):
    print("  $ " + " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True)


def gdal2tiles_cmd():
    for name in ("gdal2tiles.py", "gdal2tiles"):
        if which(name):
            return [name]
    return [sys.executable, "-m", "osgeo_utils.gdal2tiles"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--class-raster", default="biochar_class_300m.tif",
                    help="committed uint8 class raster (1-5, 0=nodata)")
    ap.add_argument("--colors", default="biochar_class_colors.txt")
    ap.add_argument("--out", required=True, help="site folder (tiles land in <out>/tiles)")
    ap.add_argument("--zoom", default="3-9")
    ap.add_argument("--work", default="_work")
    args = ap.parse_args()

    for f in (args.class_raster, args.colors):
        if not os.path.exists(f):
            sys.exit("missing input: %s" % f)

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.work, exist_ok=True)

    # 1. color the five classes (discrete, no interpolation)
    rgba = os.path.join(args.work, "biochar_national_rgba.tif")
    run(["gdaldem", "color-relief", args.class_raster, args.colors, rgba,
         "-alpha", "-nearest_color_entry",
         "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER"])

    # 2. reproject to Web Mercator (nearest so class colors stay crisp)
    merc = os.path.join(args.work, "biochar_national_3857.tif")
    run(["gdalwarp", "-t_srs", "EPSG:3857", "-r", "near", "-overwrite",
         "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER",
         rgba, merc])

    # 3. XYZ tile pyramid (Leaflet default scheme; matches the viewer's TMS=false)
    tiles_dir = os.path.join(args.out, "tiles")
    run(gdal2tiles_cmd() + ["--xyz", "--profile=mercator", "-z", args.zoom,
                            "-r", "near", "-w", "none", merc, tiles_dir])

    print("\nDone. Tiles in %s" % tiles_dir, flush=True)


if __name__ == "__main__":
    main()
