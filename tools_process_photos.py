# -*- coding: utf-8 -*-
"""Processes real photography from incoming-photos/ into responsive web assets.

    python3 tools_process_photos.py              inspect and report
    python3 tools_process_photos.py --apply      generate assets + manifest

Reads anything sips can open (HEIC, camera RAW, JPEG, PNG, WebP, TIFF) and emits
progressive JPEGs at several widths per slot, plus a manifest build.py reads to
generate srcset markup. All EXIF/XMP is stripped, because phone and camera files
routinely carry GPS coordinates and publishing an agent's location is a real
privacy problem. No third-party dependencies: sips ships with macOS and the
metadata stripping is done here in pure Python.
"""
from __future__ import print_function
import json, os, subprocess, sys, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
INBOX = os.path.join(ROOT, "incoming-photos")
OUTDIR = os.path.join(ROOT, "assets", "img", "photo")
MANIFEST = os.path.join(ROOT, "data", "photos.json")
APPLY = "--apply" in sys.argv

# Widths per slot kind. The hero is displayed full-bleed; cards never exceed ~800.
WIDTHS = {
    "hero":     [640, 1024, 1600, 2000],
    "portrait": [480, 720, 1000, 1400],
    "split":    [480, 720, 1000, 1400],
    "card":     [400, 600, 800],
}
QUALITY = "0.72"   # sips formatOptions: 0.0 - 1.0

READABLE = (".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff",
            ".cr2", ".cr3", ".nef", ".arw", ".raf", ".dng", ".rw2", ".orf", ".jxl")


# ---------------------------------------------------------------------------
def strip_jpeg_metadata(path):
    """Removes APP1 (EXIF/XMP) and APP13 (IPTC) segments from a JPEG in place.

    Keeps APP0 (JFIF) and APP2 (ICC colour profile) so colour rendering is
    unaffected. Returns bytes removed, or -1 if the marker structure could not be
    parsed cleanly. On -1 the file is left untouched: emitting a corrupt image, or
    silently passing GPS through, are both worse than stopping."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] != b"\xff\xd8":
        return 0                      # not a JPEG

    out = bytearray(data[:2])
    i, removed, n = 2, 0, len(data)
    while i < n - 1:
        if data[i] != 0xFF:
            return -1                 # desynced: refuse rather than guess
        marker = data[i + 1]
        if marker == 0xFF:            # fill byte, legal padding
            out.append(0xFF); i += 1; continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            out.extend(data[i:i + 2]); i += 2; continue
        if marker == 0xDA:            # start of scan: entropy data runs to EOI
            out.extend(data[i:]); i = n; break
        if i + 4 > n:
            return -1
        seglen = (data[i + 2] << 8) | data[i + 3]
        if seglen < 2 or i + 2 + seglen > n:
            return -1                 # impossible length
        seg = data[i:i + 2 + seglen]
        if marker in (0xE1, 0xED):    # APP1 = EXIF/XMP (GPS), APP13 = IPTC
            removed += len(seg)
        else:
            out.extend(seg)
        i += 2 + seglen

    if removed:
        with open(path, "wb") as f:
            f.write(bytes(out))
    return removed


def verify_clean(path):
    """Confirms the written file is still decodable and carries no location data."""
    try:
        raw = subprocess.check_output(["sips", "-g", "all", path],
                                      stderr=subprocess.STDOUT).decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        return False, "sips could not read the output"
    if "pixelWidth" not in raw or "<nil>" in raw.split("pixelWidth")[1][:20]:
        return False, "output is not decodable"
    low = raw.lower()
    for key in ("latitude", "longitude", "gpsl"):
        if key in low:
            return False, "location metadata still present (%s)" % key
    return True, ""


def sips_info(path):
    try:
        raw = subprocess.check_output(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", path],
            stderr=subprocess.STDOUT).decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        return None
    info = {}
    for line in raw.splitlines():
        if ":" in line:
            k, _, v = line.strip().partition(":")
            info[k.strip()] = v.strip()
    try:
        return {"w": int(info.get("pixelWidth", 0)),
                "h": int(info.get("pixelHeight", 0)),
                "format": info.get("format", "?")}
    except ValueError:
        return None


def has_gps(path):
    try:
        raw = subprocess.check_output(["sips", "-g", "all", path],
                                      stderr=subprocess.STDOUT).decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        return False
    low = raw.lower()
    return "latitude" in low or "gps" in low


def has_alpha(path):
    try:
        raw = subprocess.check_output(["sips", "-g", "hasAlpha", path],
                                      stderr=subprocess.STDOUT).decode("utf-8", "replace")
        return "yes" in raw
    except subprocess.CalledProcessError:
        return False


def render(src, dest, width, keep_alpha=False):
    """Resizes to `width`. Transparent sources stay PNG so a cutout keeps its
    alpha; everything else becomes JPEG. Never upscales."""
    if keep_alpha:
        tmp = dest + ".tmp.png"
        cmd = ["sips", "-s", "format", "png",
               "--resampleWidth", str(width), src, "--out", tmp]
    else:
        tmp = dest + ".tmp.jpg"
        cmd = ["sips", "-s", "format", "jpeg",
               "-s", "formatOptions", QUALITY,
               "--resampleWidth", str(width), src, "--out", tmp]
    try:
        subprocess.check_output(cmd, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as ex:
        return None, ex.output.decode("utf-8", "replace")[:160]
    stripped = 0 if keep_alpha else strip_jpeg_metadata(tmp)
    if stripped < 0:
        os.remove(tmp)
        return None, "metadata could not be parsed safely; file skipped"
    ok, why = verify_clean(tmp)
    if not ok:
        os.remove(tmp)
        return None, why
    shutil.move(tmp, dest)
    return {"bytes": os.path.getsize(dest), "stripped": stripped}, None


# ---------------------------------------------------------------------------
def main():
    if not os.path.isdir(INBOX):
        print("No incoming-photos/ directory. Nothing to do.")
        return 0

    SKIP = ("remax_logo", "remax-logo", "remaxnewbrand", "sk final",
            "consulting logo")            # brand assets, handled separately
    files = sorted(f for f in os.listdir(INBOX)
                   if not f.startswith(".")
                   and os.path.splitext(f)[1].lower() in READABLE
                   and not any(s in f.lower() for s in SKIP))
    if not files:
        print("incoming-photos/ is empty.")
        print("Save the photographs there, then run this again with --apply.")
        return 0

    # Slot assignments live alongside the photos so they survive re-runs.
    mapping_path = os.path.join(INBOX, "mapping.json")
    mapping = {}
    if os.path.isfile(mapping_path):
        with open(mapping_path) as f:
            mapping = json.load(f)

    print("Found %d photograph(s) in incoming-photos/\n" % len(files))
    manifest = {}
    unmapped = []

    for fn in files:
        src = os.path.join(INBOX, fn)
        info = sips_info(src)
        if not info:
            print("  %-40s UNREADABLE (skipped)" % fn[:40]); continue
        orient = "portrait" if info["h"] > info["w"] else "landscape"
        gps = has_gps(src)
        entry = mapping.get(fn)
        print("  %-38s %5dx%-5d %-9s %-9s %s"
              % (fn[:38], info["w"], info["h"], info["format"], orient,
                 ("-> " + ", ".join(entry["slot"] if isinstance(entry["slot"], list)
                                    else [entry["slot"]])) if entry else "(unassigned)"))
        if gps:
            print("       ^ contains GPS location data; it will be stripped on output")
        if not entry:
            unmapped.append(fn); continue

        if not APPLY:
            continue

        slots = entry["slot"]
        if isinstance(slots, str):
            slots = [slots]
        kinds = entry.get("kind", "hero")
        if isinstance(kinds, str):
            kinds = [kinds] * len(slots)
        if not os.path.isdir(OUTDIR):
            os.makedirs(OUTDIR)

      # A single photograph may serve more than one slot.
        for slot, kind in zip(slots, kinds):
         sizes = []
         alpha = has_alpha(src)
         ext = "png" if alpha else "jpg"
         for w in WIDTHS.get(kind, WIDTHS["hero"]):
            if w > info["w"]:
                continue                       # never upscale
            dest = os.path.join(OUTDIR, "%s-%d.%s" % (slot, w, ext))
            res, err = render(src, dest, w, keep_alpha=alpha)
            if err:
                print("       ! %d px failed: %s" % (w, err)); continue
            sizes.append({"w": w, "src": "/assets/img/photo/%s-%d.%s" % (slot, w, ext),
                          "bytes": res["bytes"]})
         if not sizes:                         # source smaller than every target
            w = info["w"]
            dest = os.path.join(OUTDIR, "%s-%d.%s" % (slot, w, ext))
            res, err = render(src, dest, w, keep_alpha=alpha)
            if not err:
                sizes.append({"w": w, "src": "/assets/img/photo/%s-%d.%s" % (slot, w, ext),
                              "bytes": res["bytes"]})
         if sizes:
            manifest[slot] = {
                "sizes": sizes,
                "width": info["w"], "height": info["h"],
                "aspect": round(info["w"] / float(info["h"]), 4),
                "alt": entry.get("alt", ""),
                "cutout": alpha,
                "source_file": fn,
                "credit": entry.get("credit", ""),
            }
            print("       %-18s %d size(s), largest %s"
                  % (slot, len(sizes), "%.0f KB" % (sizes[-1]["bytes"] / 1024.0)))

    if unmapped:
        print("\n%d photo(s) have no slot assigned." % len(unmapped))
        print("Add them to incoming-photos/mapping.json, for example:")
        print(json.dumps({unmapped[0]: {"slot": "hero-home", "kind": "hero",
                                        "alt": "Describe the photograph here."}},
                         indent=2))

    if APPLY:
        with open(MANIFEST, "w") as f:
            json.dump({"_note": "Generated by tools_process_photos.py. Do not edit by hand.",
                       "photos": manifest}, f, indent=1)
        print("\nWrote %s (%d slot(s))." % (os.path.relpath(MANIFEST, ROOT), len(manifest)))
        print("Now run: python3 build.py")
    else:
        print("\nInspection only. Re-run with --apply to generate assets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
