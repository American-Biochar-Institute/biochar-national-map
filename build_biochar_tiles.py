#!/usr/bin/env python3
"""
build_biochar_tiles.py
Color and tile the committed biochar class raster (biochar_class_300m.tif) into
an XYZ tile pyramid for GitHub Pages. No data download, no reclass at build time.
Extra flags (--lookup, --res, --grid-url) are accepted and ignored so this runs
under the existing workflow unchanged. Needs GDAL >= 3.1 (gdal2tiles --xyz).
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
    ap.add_argument("--class-raster", default="biochar_class_300m.tif")
    ap.add_argument("--colors", default="biochar_class_colors.txt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--zoom", default="3-9")
    ap.add_argument("--work", default="_work")
    ap.add_argument("--lookup")
    ap.add_argument("--res")
    ap.add_argument("--grid-url")
    args = ap.parse_args()

    for f in (args.class_raster, args.colors):
        if not os.path.exists(f):
            sys.exit("missing input: %s (is biochar_class_300m.tif committed at the repo root?)" % f)

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.work, exist_ok=True)

    rgba = os.path.join(args.work, "biochar_national_rgba.tif")
    run(["gdaldem", "color-relief", args.class_raster, args.colors, rgba,
         "-alpha", "-nearest_color_entry",
         "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER"])

    merc = os.path.join(args.work, "biochar_national_3857.tif")
    run(["gdalwarp", "-t_srs", "EPSG:3857", "-r", "near", "-overwrite",
         "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER",
         rgba, merc])

    tiles_dir = os.path.join(args.out, "tiles")
    run(gdal2tiles_cmd() + ["--xyz", "--profile=mercator", "-z", args.zoom,
                            "-r", "near", "-w", "none", merc, tiles_dir])
    print("\nDone. Tiles in %s" % tiles_dir, flush=True)


if __name__ == "__main__":
    main()
