# -*- coding: utf-8 -*-
"""Generates data/properties.json - DEMO listings only.
Every record carries demo:true and an MLS number in the DEMO-#### namespace,
which cannot collide with a real TRREB/CREA identifier. Replace this file
wholesale when an authorized IDX/DDF feed is licensed."""
import json, random

random.seed(1701)  # deterministic: rebuilds produce identical data

STREETS = {
 "unionville":   ["Main Street Unionville","Carlton Road","Village Parkway","Fred Varley Drive","Toogood Avenue"],
 "cornell":      ["Cornell Centre Boulevard","Bur Oak Avenue","William Forster Road","Riverlands Avenue","Rustle Woods Avenue"],
 "markham-village":["Main Street North","Parkway Avenue","Robinson Street","Wilson Street","Church Street"],
 "berczy-village":["Ada Mackenzie Road","Fred McLaren Boulevard","Castlemore Avenue","Bur Oak Avenue","Grand Trunk Avenue"],
 "angus-glen":   ["Angus Glen Boulevard","Wilfred Murison Avenue","Cachet Woods Court","Rustle Woods Avenue","Bur Oak Avenue"],
 "cathedraltown":["Cathedral High Street","Benedetto Drive","Giovanni Way","Vellore Woods Boulevard","Angelica Avenue"],
 "wismer-commons":["Mingay Avenue","Roy Rainey Avenue","Star Ridge Avenue","Bur Oak Avenue","Donald Sim Avenue"],
 "thornhill":    ["Yonge Street","Centre Street","Bayview Avenue","Green Lane","John Street"],
 "greensborough":["Greensborough Village Circle","Donald Cousens Parkway","Mingay Avenue","Country Glen Road","Rustle Woods Avenue"],
 "milliken-mills":["Kennedy Road","Denison Street","Alden Road","Rodick Road","Esna Park Drive"],
 "richmond-hill":["Yonge Street","Bayview Avenue","Elgin Mills Road","Major Mackenzie Drive","Mill Street"],
 "stouffville":  ["Main Street Stouffville","Millard Street","Hoover Park Drive","Sandiford Drive","Baker Hill Boulevard"],
}
POSTALS = {"unionville":"L3R","cornell":"L6B","markham-village":"L3P","berczy-village":"L6C","angus-glen":"L6C",
 "cathedraltown":"L6C","wismer-commons":"L6E","thornhill":"L3T","greensborough":"L6E","milliken-mills":"L3R",
 "richmond-hill":"L4C","stouffville":"L4A"}
CITY = {"thornhill":"Thornhill","richmond-hill":"Richmond Hill","stouffville":"Whitchurch-Stouffville"}
# Approx neighbourhood centroids for map view (public geographic knowledge)
COORDS = {"unionville":(43.8659,-79.3116),"cornell":(43.8828,-79.2246),"markham-village":(43.8770,-79.2610),
 "berczy-village":(43.8890,-79.3080),"angus-glen":(43.9030,-79.3080),"cathedraltown":(43.9020,-79.3300),
 "wismer-commons":(43.8960,-79.2760),"thornhill":(43.8130,-79.4230),"greensborough":(43.9000,-79.2530),
 "milliken-mills":(43.8250,-79.3050),"richmond-hill":(43.8828,-79.4403),"stouffville":(43.9710,-79.2450)}

TYPES = ["Detached","Semi-Detached","Freehold Townhouse","Condo Townhouse","Condo Apartment"]
STYLES = {"Detached":["2-Storey","Bungalow","Backsplit","3-Storey"],"Semi-Detached":["2-Storey","3-Storey"],
 "Freehold Townhouse":["2-Storey","3-Storey"],"Condo Townhouse":["2-Storey","Stacked"],"Condo Apartment":["Apartment"]}
FEATURES = ["Hardwood throughout","Renovated kitchen","Quartz countertops","Finished basement","Walk-out basement",
 "Primary bedroom ensuite","Main floor laundry","Gas fireplace","Central air conditioning","Fenced rear yard",
 "Double car garage","Interlock driveway","Skylight","Pot lights","Smooth ceilings","Stainless steel appliances",
 "Second-floor family room","Cold cellar","Rough-in for bathroom","South-facing rear exposure"]
AMENITIES_CONDO = ["Concierge","Fitness centre","Party room","Visitor parking","Rooftop terrace","Bicycle storage","Guest suite"]

ROOMS_BY_TYPE = {
 "main": [("Living",(3.4,5.8),(3.0,4.4)),("Dining",(3.0,4.6),(2.8,3.8)),("Kitchen",(3.0,4.8),(2.6,4.0)),("Family",(3.6,6.0),(3.2,4.4))],
 "upper":[("Primary",(3.8,6.2),(3.2,4.6)),("2nd Bedroom",(3.0,4.4),(2.8,3.6)),("3rd Bedroom",(2.8,4.0),(2.6,3.4)),("4th Bedroom",(2.8,3.8),(2.6,3.2))],
 "lower":[("Recreation",(4.0,7.5),(3.4,5.0)),("Office",(2.6,3.8),(2.4,3.2))],
}

def money(n, step=1000):
    return int(round(n/step)*step)

def make(i, slug, status):
    nb = slug
    ptype = random.choice(TYPES if nb not in ("thornhill","milliken-mills","richmond-hill") else TYPES+["Condo Apartment"])
    style = random.choice(STYLES[ptype])
    is_condo = ptype.startswith("Condo")
    beds = random.choice([2,3,3,4,4,5]) if not is_condo else random.choice([1,2,2,3])
    baths = max(1, min(beds, random.choice([2,2,3,3,4])) if not is_condo else random.choice([1,2,2]))
    sqft_lo = {"Condo Apartment":(520,1250),"Condo Townhouse":(900,1600),"Freehold Townhouse":(1300,2200),
               "Semi-Detached":(1500,2400),"Detached":(1800,4200)}[ptype]
    sqft = int(round(random.uniform(*sqft_lo)/10)*10)
    base = {"Condo Apartment":720,"Condo Townhouse":700,"Freehold Townhouse":690,"Semi-Detached":700,"Detached":740}[ptype]
    mult = {"unionville":1.18,"angus-glen":1.22,"cathedraltown":1.05,"berczy-village":1.12,"cornell":1.03,
            "markham-village":1.06,"wismer-commons":1.08,"thornhill":1.10,"greensborough":1.02,
            "milliken-mills":0.98,"richmond-hill":1.09,"stouffville":0.96}[nb]
    price = money(sqft*base*mult*random.uniform(0.92,1.09), 1000)
    lease = status == "For Lease"
    if lease:
        price = money(price/1000*2.05, 25)
    street = random.choice(STREETS[nb])
    num = random.randint(2, 320)
    unit = ""
    if is_condo and random.random() < 0.8:
        unit = str(random.choice([2,3,4,5,6,7,8,9,10,11,12,14,15,16,18,20]))+str(random.choice("0123456789"))+str(random.randint(1,8))
    lat, lon = COORDS[nb]
    lat += random.uniform(-0.011, 0.011); lon += random.uniform(-0.014, 0.014)

    rooms = []
    for lvl, key in (("Main","main"),("Second","upper")):
        for nm, lr, wr in ROOMS_BY_TYPE[key]:
            if key=="upper":
                idx = ["Primary","2nd Bedroom","3rd Bedroom","4th Bedroom"].index(nm)
                if idx >= beds: continue
            if key=="main" and nm=="Family" and (is_condo or random.random()<0.35): continue
            rooms.append({"level":lvl,"name":nm,"length_m":round(random.uniform(*lr),2),"width_m":round(random.uniform(*wr),2)})
    if not is_condo and random.random() < 0.7:
        for nm, lr, wr in ROOMS_BY_TYPE["lower"]:
            if random.random()<0.5: continue
            rooms.append({"level":"Basement","name":nm,"length_m":round(random.uniform(*lr),2),"width_m":round(random.uniform(*wr),2)})

    feats = random.sample(FEATURES, random.randint(5,9))
    parking = 0 if (is_condo and random.random()<0.12) else (random.choice([1,1,2]) if is_condo else random.choice([2,2,4,6]))
    garage = 0 if ptype=="Condo Apartment" else random.choice([1,1,2,2,3] if ptype=="Detached" else [1,1,2])
    lot = None
    if not is_condo:
        lot = {"frontage_ft": random.choice([20,22,25,30,36,40,45,50,60]), "depth_ft": random.choice([85,90,100,110,115,120])}
    maint = round(random.uniform(0.52,0.86)*sqft, 2) if is_condo else None
    tax = money(price*random.uniform(0.0068,0.0092), 1) if not lease else None

    p = {
      "id": "demo-%03d" % i,
      "demo": True,
      "mls_number": "DEMO-%04d" % (1000+i),
      "status": status,
      "listing_type": "lease" if lease else "sale",
      "price": price,
      "price_qualifier": "per month" if lease else None,
      "address": {
        "unit": unit, "street_number": str(num), "street_name": street,
        "city": CITY.get(nb, "Markham"), "province": "ON",
        "postal_prefix": POSTALS[nb], "country": "Canada"
      },
      "neighbourhood_slug": nb,
      "coordinates": {"lat": round(lat,6), "lng": round(lon,6)},
      "property_type": ptype, "style": style,
      "bedrooms": beds, "bathrooms": baths,
      "square_footage": sqft, "square_footage_source": "Demo data",
      "lot": lot, "parking_total": parking, "garage_spaces": garage,
      "year_built_range": random.choice(["Pre-1980","1981-1990","1991-2000","2001-2010","2011-2020","2021+"]),
      "maintenance_fee_monthly": maint,
      "property_tax_annual": tax, "property_tax_year": 2025 if tax else None,
      "features": feats,
      "amenities": random.sample(AMENITIES_CONDO, random.randint(3,5)) if is_condo else [],
      "rooms": rooms,
      "days_on_market": random.randint(1, 62),
      "listing_brokerage": "RE/MAX Epic Realty, Brokerage",
      "listing_agent": "Kaylin Smith",
      "images": [],
      "image_count": random.randint(18, 34),
      "open_houses": [],
      "sold": None,
      "investment": None,
      "description": ""
    }
    return p

props = []
i = 1
slugs = list(STREETS.keys())
plan = ([("For Sale", s) for s in slugs] +
        [("For Sale", s) for s in slugs[:6]] +
        [("For Lease", s) for s in ["unionville","thornhill","richmond-hill","milliken-mills"]] +
        [("Sold", s) for s in ["unionville","cornell","berczy-village","markham-village","wismer-commons","thornhill"]])
for status, slug in plan:
    p = make(i, slug, status); props.append(p); i += 1

# Sold records get a sold price + date; never presented as Kaylin's own results without verification
for p in props:
    if p["status"] == "Sold":
        ratio = random.uniform(0.965, 1.045)
        p["sold"] = {"sold_price": money(p["price"]*ratio,1000), "sold_date": random.choice(
            ["2026-06-11","2026-06-27","2026-07-08","2026-07-19","2026-08-04","2026-08-21"]),
            "days_to_sell": random.randint(4, 41), "_demo_note": "Demo record. Not a real transaction."}

# Open houses on a subset of active sale listings
oh_dates = [("2026-09-05","2:00 PM","4:00 PM"),("2026-09-06","1:00 PM","3:00 PM"),
            ("2026-09-12","2:00 PM","4:00 PM"),("2026-09-13","12:00 PM","2:00 PM")]
for p in props:
    if p["status"] == "For Sale" and random.random() < 0.34:
        d = random.choice(oh_dates)
        p["open_houses"] = [{"date": d[0], "start": d[1], "end": d[2]}]

# Investment fields only on multi-unit-capable / condo stock, explicitly labelled estimates
for p in props:
    if p["listing_type"]=="sale" and p["property_type"] in ("Condo Apartment","Condo Townhouse","Semi-Detached") and random.random()<0.55:
        rent = money(p["price"]*random.uniform(0.0034,0.0046), 25)
        p["investment"] = {
          "estimated_monthly_rent": rent,
          "estimated_monthly_expenses": money((p["maintenance_fee_monthly"] or 0) + (p["property_tax_annual"] or 0)/12 + 120, 5),
          "basis": "Demo figures for interface demonstration only.",
          "is_estimate": True
        }

feat_pool = [p for p in props if p["status"]=="For Sale"]
for p in random.sample(feat_pool, 6):
    p["featured"] = True
for p in props:
    p.setdefault("featured", False)

out = {
  "_note": "DEMO LISTING DATA. Every record has demo:true and an MLS number in the DEMO-#### namespace. These are NOT real listings and are NOT represented as live MLS data. The UI renders a visible DEMO badge on each. Replace this file when an authorized TRREB/CREA DDF or IDX feed is licensed; the schema matches supabase/schema.sql table `properties`.",
  "_feed_status": "not_connected",
  "properties": props
}
json.dump(out, open("data/properties.json","w"), indent=1, ensure_ascii=False)
print("wrote", len(props), "demo properties")
from collections import Counter
print(Counter(p["status"] for p in props))
print("featured:", sum(1 for p in props if p["featured"]), " open houses:", sum(1 for p in props if p["open_houses"]))
print("investment fields:", sum(1 for p in props if p["investment"]))
