# Contributing

Thanks for helping improve India's open boundary data. Every change goes through a pull request and is reviewed before it reaches the Whistling Citizen app.

## Ways to help

- **Fix a boundary** that is wrong or out of date.
- **Fix a name** (constituency, district, parliamentary constituency).
- **Fill in missing fields** such as `districtName`, `pcNo`, `pcName` or `seatType` (many states have these as `null`).
- **Add ward boundaries** for a city that isn't covered yet.
- **Review** other people's pull requests if you know the area.

Not sure how to edit GeoJSON? Open an issue with the evidence and someone will help.

## Fixing a constituency

1. Find the file: `data/states/{state}/ac/{acNo}.geojson` (for example `data/states/tn/ac/124.geojson`).
2. Edit it with a GIS tool such as [geojson.io](https://geojson.io) or QGIS, or edit the JSON directly for property fixes.
3. Keep the file as **one `Feature`** with a `Polygon` or `MultiPolygon` geometry.
4. Change `quality` only if you have checked the boundary against an official map (`matches-official-map`) or reviewed it carefully (`community-reviewed`).
5. Do **not** edit generated files: `districts.json`, or anything under `dist/`. Version numbers in `state.json` are bumped automatically on publish.
6. Run the checks locally:

   ```bash
   npm install
   npm run validate
   npm run validate:geometry -- --base origin/main   # self-intersections and overlaps for the files you changed
   ```

7. Open a pull request and fill in the template, including **your evidence**.

When you move a shared border, move it on **both** neighbouring constituencies, otherwise you create a gap or an overlap. The overlap check will catch most of these. If the border is also a state border, update `outline.geojson` too.

Fixed one of the problems listed in `data/known-issues.json`? Remove its entry in the same pull request.

## Evidence

Boundary changes must cite a source, for example:

- Delimitation Commission order or Election Commission of India map
- State gazette notification
- Official district or municipal corporation map

## Allowed and forbidden sources

**Allowed:** official government publications, your own local knowledge, and openly licensed data compatible with CC BY-SA 4.0, such as CC0, CC BY, CC BY-SA or GODL-India (list it in your pull request so it can be added to [SOURCES.md](SOURCES.md)). ODbL data, including OpenStreetMap, is **not** compatible.

**Forbidden:** tracing or copying from Google Maps, Bing Maps, Apple Maps, MapmyIndia or any other proprietary map or imagery whose license doesn't allow it. A single contaminated contribution can make the whole dataset unusable, so these pull requests will be closed.

**No personal data:** do not add phone numbers, email addresses or home addresses of representatives or anyone else.

## Sign your commits (DCO)

By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/): you have the right to submit your contribution under this repository's licenses (CC BY-SA 4.0 for data and docs, MIT for code). Sign each commit:

```bash
git commit -s -m "Fix boundary of TN-AC-124"
```

## What happens after merge

A maintainer merges your pull request, CI rebuilds the data and publishes it to the CDN, and the Whistling Citizen app picks it up automatically.
