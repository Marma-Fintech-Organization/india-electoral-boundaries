# India Electoral Boundaries

Open boundary data for India's **assembly constituencies** (all states and union territories) and **city wards**, maintained by Whistling Citizen and contributors, and published for anyone to use.

> These are electoral boundaries for civic use. They are not an authoritative depiction of India's international or state borders.

> **This data is not 100% accurate.** Some boundaries are approximate, some names are misspelled, and some fields (district, parliamentary constituency) are missing for several states. That is why it is open: if you know an area, please help fix it. See [CONTRIBUTING.md](CONTRIBUTING.md).

These are **not official boundaries**. For legal or electoral purposes, refer to the Election Commission of India and the relevant Delimitation Commission orders.

## What's inside

| Layer | Coverage | Files |
|---|---|---|
| Assembly constituencies | 36 states / UTs, ~4,100 constituencies | `data/states/{code}/ac/{acNo}.geojson` |
| State outlines | 36 states / UTs | `data/states/{code}/outline.geojson` |
| India outline | Country | `data/india-outline.geojson` |
| City wards | Chennai, Coimbatore, Bengaluru (BBMP) | `data/wards/{state}/{city}/wards.geojson` |

## Folder layout

```text
data/
  meta.json                         # global manifest version
  known-issues.json                 # problems accepted at import, to be fixed
  india-outline.geojson
  states/
    tn/
      state.json                    # state code, name, versions
      outline.geojson               # state outline
      districts.json                # GENERATED: district -> constituency numbers
      ac/
        1.geojson                   # one constituency per file (edit these)
        2.geojson
  wards/
    tn/chennai/ulb.json             # city / corporation metadata
    tn/chennai/wards.geojson        # all wards of the city
schema/                             # JSON Schemas for every file type
scripts/                            # validate, build, publish
```

State codes are lowercase two-letter codes (`tn`, `ka`, `up`, ...). See `data/states/*/state.json` for names.

## Constituency schema

Each `ac/{acNo}.geojson` is a single GeoJSON `Feature`:

```json
{
  "type": "Feature",
  "id": "TN-AC-1",
  "properties": {
    "stateCode": "TN",
    "stateName": "TAMIL NADU",
    "districtName": "THIRUVALLUR",
    "acNo": 1,
    "acName": "Gummidipoondi",
    "seatType": null,
    "pcNo": 1,
    "pcName": "TIRUVALLUR (SC)",
    "quality": "unverified",
    "sources": ["TBD"]
  },
  "geometry": { "type": "Polygon", "coordinates": [] }
}
```

| Property | Meaning |
|---|---|
| `stateCode` | Two-letter state / UT code (uppercase) |
| `acNo` | Assembly constituency number (unique per state, matches the filename) |
| `acName` | Constituency name |
| `districtName` | District the constituency is in (`null` if unknown) |
| `pcNo`, `pcName` | Parliamentary (Lok Sabha) constituency (`null` if unknown) |
| `seatType` | `GEN`, `SC`, `ST` where known |
| `quality` | `unverified`, `community-reviewed` or `matches-official-map` |
| `sources` | Source IDs from [SOURCES.md](SOURCES.md) |

Full definitions: [`schema/constituency.schema.json`](schema/constituency.schema.json). Coordinates are WGS84 (`[longitude, latitude]`). Most files use 5 decimals (about 1 m); please don't add more precision than your source has.

## Using the data

### Directly from GitHub

Clone the repo or download a release; every file is plain GeoJSON.

### From the CDN

The build publishes an app-optimized copy (legacy property names, per-state indexes) to:

```text
{CDN_BASE}/geo/v2/manifest.json
{CDN_BASE}/geo/v2/{code}/index.json
{CDN_BASE}/geo/v2/{code}/outline.geojson
{CDN_BASE}/geo/v2/{code}/ac/{acNo}.geojson
{CDN_BASE}/geo/v2/india-outline.geojson
```

## Development

```bash
npm install
npm run validate                          # structure, schema, counts, privacy (all data)
npm run validate:geometry -- --states tn  # self-intersections and overlaps (slower)
npm run build                             # generate dist/cdn and dist/backend
```

`data/known-issues.json` lists problems that existed at import (for example the Andaman and Nicobar outline). They show as warnings until fixed. Geometry checks report existing problems as warnings; in pull requests CI runs them only on the constituencies you changed, as errors.

State outlines (`outline.geojson`) and `india-outline.geojson` are source files, not generated. If you move a constituency's outer edge on a state border, update the state outline in the same pull request.

### Publishing (maintainers)

Merging to `main` runs `.github/workflows/publish.yml`: it bumps the versions of changed states (`npm run build:bump`), uploads only changed files to the CDN (`npm run publish:cdn`), commits the version bumps, and opens a pull request on the backend repo with the regenerated lookup files (`npm run sync:backend`). The workflow header lists the secrets and variables it needs.

To do the same by hand, copy `.env.example` to `.env` and run:

```bash
npm run build:bump
npm run publish:cdn:dry   # shows what would change
npm run publish:cdn
npm run sync:backend      # writes into BACKEND_REPO_DIR; review and commit there
```

## License and attribution

- **Data** (`data/`) and documentation: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). You may use it commercially; give credit and share adapted versions under the same license.
- **Code** (`scripts/`, `schema/`, workflows): [MIT](LICENSES/MIT.txt).

The data is derived from the open datasets listed in [SOURCES.md](SOURCES.md); their attribution requirements apply too. See [LICENSE](LICENSE) for details.

When using this data, please credit:

> Boundary data: India Electoral Boundaries contributors (Whistling Citizen), CC BY-SA 4.0, derived from the sources listed in SOURCES.md.
