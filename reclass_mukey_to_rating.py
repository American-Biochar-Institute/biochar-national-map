#!/usr/bin/env python3
"""
reclass_mukey_to_rating.py

Turn a MUKEY raster (each cell = a soil map unit key) into a biochar-rating
raster, using the national lookup CSV (mukey, rating, class).

This is the join-in-raster-space step of the Mode 1 national map. It avoids
joining the 36.7M-feature MUPOLYGON layer directly: you rasterize MUKEY once
(a single pass, no join), then this script maps each cell's mukey to its
rating and class code.

Outputs:
  - <out>_class.tif : Byte, class codes 1-5 (0 = nodata). Use this for coloring.
  - <out>_rating.tif: Float32, the 0-1 rating (optional, --rating).

Class codes (the deployed rule's verified quarter cuts):
  1 Negligible  (rating = 0)
  2 Low         (0.001 - 0.250)
  3 Fair        (0.251 - 0.500)
  4 Good        (0.501 - 0.750)
  5 Excellent   (0.751 - 1.0)

Runs in the OSGeo4W Python (uses osgeo.gdal + numpy, no extra installs).

Usage:
  python reclass_mukey_to_rating.py mukey_100m.tif biochar_national_lookup.csv biochar_national
  python reclass_mukey_to_rating.py mukey_100m.tif biochar_national_lookup.csv biochar_national --rating
"""
import sys, csv, argparse
import numpy as np
from osgeo import gdal
gdal.UseExceptions()

def class_code(r):
    if r <= 0:        return 1
    if r <= 0.250:    return 2
    if r <= 0.500:    return 3
    if r <= 0.750:    return 4
    return 5

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mukey_raster")
    ap.add_argument("lookup_csv")
    ap.add_argument("out_prefix")
    ap.add_argument("--rating", action="store_true", help="also write the Float32 rating raster")
    ap.add_argument("--block", type=int, default=2048)
    args = ap.parse_args()

    # --- load lookup: mukey -> (rating, class_code) ---
    mukeys, ratings, classes = [], [], []
    with open(args.lookup_csv, newline="") as f:
        r = csv.DictReader(f)
        # tolerate different header casings
        cols = {c.lower(): c for c in r.fieldnames}
        mk_c = cols.get("mukey"); rt_c = cols.get("rating")
        if mk_c is None or rt_c is None:
            sys.exit("CSV must have 'mukey' and 'rating' columns; found: %s" % r.fieldnames)
        for row in r:
            try:
                mk = int(row[mk_c]); rt = float(row[rt_c])
            except (ValueError, TypeError):
                continue
            mukeys.append(mk); ratings.append(rt); classes.append(class_code(rt))
    if not mukeys:
        sys.exit("No usable rows in lookup CSV.")

    keys = np.array(mukeys, dtype=np.int64)
    order = np.argsort(keys)
    keys = keys[order]
    val_class = np.array(classes, dtype=np.uint8)[order]
    val_rating = np.array(ratings, dtype=np.float32)[order]
    print("lookup rows: %d  (mukey range %d to %d)" % (len(keys), keys.min(), keys.max()))

    src = gdal.Open(args.mukey_raster)
    if src is None: sys.exit("Cannot open %s" % args.mukey_raster)
    band = src.GetRasterBand(1)
    W, H = src.RasterXSize, src.RasterYSize
    gt, proj = src.GetGeoTransform(), src.GetProjection()

    drv = gdal.GetDriverByName("GTiff")
    co = ["COMPRESS=LZW", "TILED=YES", "BIGTIFF=IF_SAFER"]
    cls_ds = drv.Create(args.out_prefix + "_class.tif", W, H, 1, gdal.GDT_Byte, co)
    cls_ds.SetGeoTransform(gt); cls_ds.SetProjection(proj)
    cls_b = cls_ds.GetRasterBand(1); cls_b.SetNoDataValue(0)

    rat_ds = rat_b = None
    if args.rating:
        rat_ds = drv.Create(args.out_prefix + "_rating.tif", W, H, 1, gdal.GDT_Float32, co)
        rat_ds.SetGeoTransform(gt); rat_ds.SetProjection(proj)
        rat_b = rat_ds.GetRasterBand(1); rat_b.SetNoDataValue(-9999.0)

    B = args.block
    nblocks = ((H + B - 1)//B) * ((W + B - 1)//B)
    done = 0
    for y in range(0, H, B):
        ys = min(B, H - y)
        for x in range(0, W, B):
            xs = min(B, W - x)
            a = band.ReadAsArray(x, y, xs, ys).astype(np.int64)
            idx = np.searchsorted(keys, a)
            idx_clipped = np.clip(idx, 0, len(keys) - 1)
            hit = keys[idx_clipped] == a
            cls_out = np.where(hit, val_class[idx_clipped], 0).astype(np.uint8)
            cls_b.WriteArray(cls_out, x, y)
            if rat_b is not None:
                rat_out = np.where(hit, val_rating[idx_clipped], -9999.0).astype(np.float32)
                rat_b.WriteArray(rat_out, x, y)
            done += 1
        print("  %d / %d blocks" % (done, nblocks), end="\r")
    cls_b.FlushCache(); cls_ds = None
    if rat_ds is not None: rat_b.FlushCache(); rat_ds = None
    src = None
    print("\ndone: %s_class.tif%s" % (args.out_prefix, (" and _rating.tif" if args.rating else "")))

if __name__ == "__main__":
    main()
