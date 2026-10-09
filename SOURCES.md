# Data Sources

This dataset is licensed under [CC BY-SA 4.0](LICENSE). It is derived from the sources below. Every constituency and ward feature has a `sources` field; features imported in version 0.1.0 still say `"TBD"` until their exact upstream is confirmed.

CC BY-SA 4.0 was chosen because it is compatible with every source listed here: CC0 and CC BY 4.0 data can be included, and CC BY-SA 2.5 India explicitly allows adaptations under later versions of the license.

---

## Assembly and parliamentary constituencies

### `datameet-maps`

| Field | Value |
|---|---|
| Publisher / author | DataMeet community / DataMeet Trust, Bangalore |
| Original URL | https://github.com/datameet/maps |
| License | CC BY 4.0 or CC BY-SA 2.5 India, depending on the file (see the upstream README) |
| Required attribution | "Data from DataMeet India community, https://github.com/datameet/maps" |
| Share-alike | yes, for CC BY-SA 2.5 India files |
| Commercial use | permitted |

### `indian-admin-boundaries`

| Field | Value |
|---|---|
| Publisher / author | ramSeraph, compiled from Election Commission of India and Local Government Directory publications |
| Original URL | https://github.com/ramSeraph/indian_admin_boundaries |
| License | CC0 1.0 |
| Required attribution | none (credit to ramSeraph and DataMeet appreciated) |
| Share-alike | no |
| Commercial use | permitted |

### `india-geodata`

| Field | Value |
|---|---|
| Publisher / author | india-geodata contributors (aggregation of the two sources above, ECI and LGD) |
| Original URL | https://github.com/yashveeeeeeer/india-geodata |
| License | CC BY 4.0 (repository); individual datasets keep their upstream license |
| Required attribution | "India Geodata, https://github.com/yashveeeeeeer/india-geodata" |
| Share-alike | no |
| Commercial use | permitted |

## Wards

### `tbd-wards`

Chennai, Coimbatore and Bengaluru ward geometry was imported from the Whistling Citizen backend. The original publisher (municipal corporation open data portal, DataMeet or another source) must be recorded here.

---

## Template for new sources

| Field | Value |
|---|---|
| Source ID | `source-id` (used in feature `sources`) |
| Publisher / author | |
| Original URL | |
| Version / commit | |
| Downloaded | YYYY-MM-DD |
| License | name and URL; must be compatible with CC BY-SA 4.0 |
| Required attribution | exact wording requested by the source |
| Share-alike | yes / no |
| Commercial use | permitted / not permitted |
| Used in | e.g. `data/states/tn/ac/*.geojson` |

## Modifications by Whistling Citizen

- Normalized property names (`AC_NAME` to `acName`, ...) and removed unused fields
- Deduplicated features by constituency number
- Edited boundaries in several states to match the map shown in the Whistling Citizen app
- Split into one file per constituency
- Removed personal data (councillor names, phone numbers, addresses) from ward files
