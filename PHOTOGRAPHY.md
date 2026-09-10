# Photography brief

Every image slot on the site currently uses one of Kaylin's own brand photographs.
Nothing is empty and nothing is a placeholder. What is missing is **property and
interior photography**, which the site would benefit from and which cannot be
sourced responsibly without either her own shoot or a paid licence.

## Why stock was not used

Three sources were tested:

| Source | Result |
|---|---|
| Unsplash | Search requires an API key (HTTP 401). Images are free for commercial use, so this is viable **if** an application key is created. |
| Pexels | Blocks automated access (HTTP 403). |
| Openverse / Wikimedia Commons | Reachable and open, but the usable results are 500 to 1024px amateur photographs under CC BY, BY-SA or BY-ND. |

The Openverse and Commons results fail on three counts. They are too small for a
full-bleed hero, which needs 2000px or wider. They require visible attribution on
every page they appear on. And BY-ND specifically forbids modification, which
rules out cropping to any of the site's aspect ratios.

A 500px cabinet-sample photograph under a no-derivatives licence would look worse
on a premium brand than the brand photography already in place. So none was used.

## The three real options

**1. Kaylin's own listing photography.** Best outcome by a distance. Her listings
have already been professionally shot, the images are genuinely of the properties
she sold, and there is no licensing question. Exteriors, interiors, kitchens and
living spaces from past listings would fill every slot below. Confirm with the
brokerage whether the photographer's licence permits marketing reuse; it usually
does, sometimes with a credit.

**2. A paid stock licence.** Adobe Stock, Stocksy or Getty. Budget roughly ten to
fifteen images. Search for "Toronto condominium interior", "modern kitchen
Ontario", "luxury home exterior". Drop the files into `incoming-photos/`, map them
in `mapping.json`, and run the pipeline.

**3. Unsplash with an API key.** Free and licensed for commercial use without
attribution. Create an application at unsplash.com/developers. I did not ask for
the key, and would rather not handle one; you can paste images into
`incoming-photos/` yourself, or add the key to the pipeline directly.

## Where property photography would go

Add files to `incoming-photos/`, map them in `mapping.json`, then run:

```bash
python3 tools_process_photos.py --apply && python3 build.py
```

| Slot | Where it appears | Orientation | Minimum width | Ideal subject |
|---|---|---|---|---|
| `hero-home` | Homepage hero | Landscape | 2000px | Currently the Coming Soon walk. Strong as is. |
| `re-hero` | Real Estate hub hero | Landscape | 2000px | A Toronto or Markham street or exterior |
| `re-buy` | Buying page hero | Landscape | 2000px | Interior, a room a buyer walks into |
| `re-sell` | Selling page hero | Landscape | 2000px | Exterior with a sign, or a staged living space |
| `re-invest` | Investing page hero | Landscape | 2000px | Condominium tower or a multi-unit exterior |
| `re-strategy` | Strategy page hero | Landscape | 2000px | Quieter and more considered; a desk or a study |
| `resources-hero` | Resources hero | Landscape | 2000px | Neutral architectural detail |
| `hero-consulting` | Consulting hero | Landscape | 2000px | Business setting, deliberately not residential |
| `hero-contact` | Contact hero | Landscape | 2000px | Any brand image |
| `kaylin-portrait` | Homepage introduction | Portrait | 1200px | Kaylin. A proper portrait is the largest gap. |
| `kaylin-about` | About page | Portrait | 1200px | Kaylin, a different frame from the homepage |

## The one gap worth closing first

There is still **no proper portrait of Kaylin**. The two portrait slots use
behind-the-scenes frames where her face is not clearly visible. For a personal
brand site that is the single most valuable photograph to add, ahead of any
interior.
