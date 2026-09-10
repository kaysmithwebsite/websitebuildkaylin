# -*- coding: utf-8 -*-
"""Composes original listing descriptions from each property's own attributes.
Copy style: short sentences, no em dashes, no superlative realtor filler."""
import json, random
random.seed(88)
d = json.load(open("data/properties.json"))
NB = {n["slug"]: n for n in json.load(open("data/neighbourhoods.json"))["neighbourhoods"]}

OPEN_SALE = ["A {beds}-bedroom {style_l} in {nb}, offered at {sqft} square feet.",
 "{sqft} square feet of finished space in {nb}, arranged over {beds} bedrooms.",
 "This {style_l} sits in {nb} and runs to {sqft} square feet.",
 "A {beds}-bedroom {ptype_l} in the heart of {nb}."]
OPEN_LEASE = ["Available for lease in {nb}. {beds} bedrooms across {sqft} square feet.",
 "A {beds}-bedroom {ptype_l} for lease in {nb}, at {sqft} square feet."]
MID = ["The layout carries {baths} bathrooms and {park} parking.",
 "{baths} bathrooms, and {park} parking.",
 "Bathrooms total {baths}. Parking is {park}."]
CLOSE_NB = ["{nb} is served by {trans}.", "Transit and highway access come by way of {trans}.",
 "For getting out of the neighbourhood: {trans}."]
CLOSE_END = ["Book a private showing to see how the space actually works.",
 "Worth seeing in person. The floor plan reads differently than the photographs.",
 "Arrange a showing to walk the layout.",
 "A private showing is the fastest way to judge the fit."]

def park_phrase(p):
    t = p["parking_total"]
    if t == 0: return "no dedicated"
    if t == 1: return "one space of"
    return "%d spaces of" % t

for p in d["properties"]:
    nb = NB[p["neighbourhood_slug"]]
    ctx = {"beds": p["bedrooms"], "baths": p["bathrooms"], "sqft": "{:,}".format(p["square_footage"]),
           "nb": nb["name"], "style_l": (p["style"] + " " + p["property_type"]).lower(),
           "ptype_l": p["property_type"].lower(), "park": park_phrase(p),
           "trans": nb["transportation"][0].split(",")[0].strip()}
    parts = []
    parts.append(random.choice(OPEN_LEASE if p["listing_type"]=="lease" else OPEN_SALE).format(**ctx))
    parts.append(random.choice(MID).format(**ctx))
    top = p["features"][:3]
    if top:
        parts.append("Notable inside: " + ", ".join(f.lower() for f in top) + ".")
    if p["lot"]:
        parts.append("The lot measures roughly {f} by {dp} feet.".format(f=p["lot"]["frontage_ft"], dp=p["lot"]["depth_ft"]))
    if p["amenities"]:
        parts.append("Building amenities include " + ", ".join(a.lower() for a in p["amenities"][:3]) + ".")
    parts.append(random.choice(CLOSE_NB).format(**ctx))
    if p["status"] != "Sold":
        parts.append(random.choice(CLOSE_END))
    else:
        parts.append("This property has sold.")
    p["description"] = " ".join(parts)

json.dump(d, open("data/properties.json","w"), indent=1, ensure_ascii=False)
print("descriptions written for", len(d["properties"]))
print()
print(d["properties"][0]["description"])
print()
print(d["properties"][20]["description"])
