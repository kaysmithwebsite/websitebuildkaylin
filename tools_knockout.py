# -*- coding: utf-8 -*-
"""Produces a reversed (white on transparent) version of a flat two-tone logo.

The supplied Kaylin Smith Real Estate lockup is navy artwork on a white
background. A white colourway is what every brand has for dark grounds, and
without one the logo has to sit on a plate. This derives it mechanically from
the client's own artwork: the mark's shapes, proportions and spacing are
untouched, only the colourway is inverted. Anti-aliased edges are preserved by
mapping darkness to alpha rather than thresholding, so the result has clean
edges rather than a jagged cutout.

No third-party imaging library is available here, so PNG is decoded and encoded
directly. Only what sips emits is supported: 8-bit, non-interlaced, colour type
2 (RGB) or 6 (RGBA).

    python3 tools_knockout.py in.png out.png
"""
from __future__ import print_function
import struct, sys, zlib

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != PNG_SIG:
        raise ValueError("not a PNG")
    pos, idat, hdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", body)
            if depth != 8 or inter != 0 or ctype not in (2, 6):
                raise ValueError("unsupported PNG: depth=%d ctype=%d interlace=%d"
                                 % (depth, ctype, inter))
            hdr = (w, h, ctype)
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
        pos += 12 + ln
    if hdr is None:
        raise ValueError("no IHDR")
    return hdr, zlib.decompress(b"".join(idat))


def unfilter(raw, w, h, bpp):
    """Reverses the per-scanline PNG filters."""
    stride = w * bpp
    out = bytearray(stride * h)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        ft = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        if ft == 1:                                   # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:                                 # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:                                 # Average
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:                                 # Paeth
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ft != 0:
            raise ValueError("bad filter type %d" % ft)
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return out


def write_png(path, w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)                                  # filter: none
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(typ, body):
        return (struct.pack(">I", len(body)) + typ + body
                + struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    # Declare sRGB. Without it macOS reads the file as some other space and
    # converts on the way out, which silently shifts flat near-neutral fields
    # by a couple of levels and leaves a visible seam where the artwork meets
    # a CSS colour that was supposed to match it exactly.
    srgb = chunk(b"sRGB", b"\x00")                       # perceptual intent
    gama = chunk(b"gAMA", struct.pack(">I", 45455))      # 1/2.2, per the spec
    chrm = chunk(b"cHRM", struct.pack(">8I", 31270, 32900, 64000, 33000,
                                      30000, 60000, 15000, 6000))
    out = (PNG_SIG + chunk(b"IHDR", ihdr) + srgb + gama + chrm
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    open(path, "wb").write(out)


def knockout(src, dst):
    (w, h, ctype), raw = read_png(src)
    bpp = 3 if ctype == 2 else 4
    px = unfilter(raw, w, h, bpp)
    out = bytearray(w * h * 4)
    for i in range(w * h):
        r = px[i * bpp]; g = px[i * bpp + 1]; b = px[i * bpp + 2]
        src_a = px[i * bpp + 3] if bpp == 4 else 255
        # Luminance drives alpha: dark artwork becomes opaque white, the white
        # ground becomes transparent, and the greys in between keep the edges
        # smooth instead of stair-stepping.
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
        a = int(round((1.0 - lum) * src_a))
        j = i * 4
        out[j] = 255; out[j + 1] = 255; out[j + 2] = 255; out[j + 3] = a
    write_png(dst, w, h, out)
    return w, h


def unmatte(src, dst, floor=0.10):
    """Lifts artwork off a white ground while keeping its own colours.

    The supplied navy lockup is a JPEG with a #EEEEEE frame baked in, so it
    shows as a grey plate wherever it sits on white. Alpha is the standard
    un-multiply from white, a = 1 - min(r,g,b)/255, which is the smallest
    alpha that still yields an in-gamut colour; the colour is then divided
    back out. Composited over white this reproduces the original pixel
    exactly, so navy stays navy and black text stays black.

    `floor` drops near-white pixels outright rather than rescaling the rest:
    it clears the grey frame (alpha ~0.07) without shifting the artwork.
    """
    (w, h, ctype), raw = read_png(src)
    bpp = 3 if ctype == 2 else 4
    px = unfilter(raw, w, h, bpp)
    out = bytearray(w * h * 4)
    for i in range(w * h):
        r = px[i * bpp]; g = px[i * bpp + 1]; b = px[i * bpp + 2]
        a = 1.0 - min(r, g, b) / 255.0
        j = i * 4
        if a < floor:
            out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0
            continue
        inv = 255.0 * (1.0 - a)
        for k, c in enumerate((r, g, b)):
            v = int(round((c - inv) / a))
            out[j + k] = 0 if v < 0 else (255 if v > 255 else v)
        out[j + 3] = int(round(a * 255))
    write_png(dst, w, h, out)
    return w, h


if __name__ == "__main__":
    if "--unmatte" in sys.argv:
        a = [x for x in sys.argv[1:] if not x.startswith("--")]
        w, h = unmatte(a[0], a[1])
        print("wrote %s (%dx%d, original colours on transparent)" % (a[1], w, h))
    else:
        w, h = knockout(sys.argv[1], sys.argv[2])
        print("wrote %s (%dx%d, white on transparent)" % (sys.argv[2], w, h))
