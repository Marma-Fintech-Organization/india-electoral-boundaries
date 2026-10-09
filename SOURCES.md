# Data Sources

Every constituency and ward feature has a `sources` field listing the source IDs below. Entries marked **TBD** must be completed (and licenses verified) before this repository is made public.

---

## TBD: original constituency boundary sources

The initial import (version 0.1.0) was taken from the Whistling Citizen backend, which assembled it from several public datasets. Each source must be identified and listed here using the template below, and the `sources` field of the affected features updated from `"TBD"` to the source ID.

---

## Template

| Field | Value |
|---|---|
| Source ID | `source-id` (used in feature `sources`) |
| Publisher / author | |
| Original URL | |
| Version / commit | |
| Downloaded | YYYY-MM-DD |
| SHA-256 of raw download | |
| License | name and URL |
| License snapshot | `LICENSES/<file>` |
| Required attribution | exact wording requested by the source |
| Share-alike | yes / no |
| Commercial use | permitted / not permitted |
| Used in | e.g. `data/states/tn/ac/*.geojson` |

### Modifications by Whistling Citizen

- Example: repaired invalid geometries
- Example: rounded coordinates to 5 decimals
- Example: renamed fields (`AC_NAME` to `acName`, ...)
- Example: removed fields (`OBJECTID`, `Shape_Area`, ...)
- Example: deduplicated features by constituency number
- Example: split into one file per constituency
