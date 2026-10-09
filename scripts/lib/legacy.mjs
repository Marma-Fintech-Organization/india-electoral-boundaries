/**
 * Mapping between the normalized source schema (what contributors edit) and
 * the legacy property names the Whistling Citizen app reads today.
 */

const CONSTITUENCY_FIELDS = [
  // [normalized, legacy]
  ["stateName", "ST_NAME"],
  ["stateCode", "ST_CODE"],
  ["districtName", "DIST_NAME"],
  ["acNo", "AC_NO"],
  ["acName", "AC_NAME"],
  ["seatType", "SEAT_TYPE"],
  ["pcNo", "PC_NO"],
  ["pcName", "PC_NAME"],
  ["hasMapInset", "HAS_MAP_INSET"],
  ["insetLabel", "INSET_LABEL"],
  ["nonTerritorial", "NON_TERRITORIAL"],
];

const OPTIONAL_CONSTITUENCY_FIELDS = new Set([
  "hasMapInset",
  "insetLabel",
  "nonTerritorial",
]);

function emptyToNull(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return value;
}

export function constituencyId(stateCode, acNo) {
  return `${stateCode.toUpperCase()}-AC-${acNo}`;
}

/** Legacy feature (regions/{code}/ac/{n}.geojson) -> normalized source feature. */
export function constituencyFromLegacy(legacyFeature, regionCode, defaults) {
  const legacy = legacyFeature.properties || {};
  const properties = {};
  for (const [normalized, legacyKey] of CONSTITUENCY_FIELDS) {
    const value = emptyToNull(legacy[legacyKey]);
    if (OPTIONAL_CONSTITUENCY_FIELDS.has(normalized) && value == null) {
      continue;
    }
    properties[normalized] = value;
  }
  properties.stateCode = (properties.stateCode || regionCode).toUpperCase();
  properties.acNo = Math.trunc(Number(properties.acNo));
  properties.quality = defaults.quality;
  properties.sources = [...defaults.sources];

  return {
    type: "Feature",
    id: constituencyId(properties.stateCode, properties.acNo),
    properties,
    geometry: legacyFeature.geometry,
  };
}

/** Normalized source feature -> legacy feature for the CDN / backend. */
export function constituencyToLegacy(feature) {
  const properties = {};
  for (const [normalized, legacyKey] of CONSTITUENCY_FIELDS) {
    const value = feature.properties[normalized];
    if (value != null) {
      properties[legacyKey] = value;
    }
  }
  return {
    type: "Feature",
    properties,
    geometry: feature.geometry,
  };
}

const WARD_FIELDS = [
  // [normalized, legacy (backend canonical), raw source aliases]
  ["wardNumber", "WARD_NO", ["WARD_NO", "wardNumber", "ward_no"]],
  ["slNo", "SL_NO", ["SL_NO", "slNo", "sl_no"]],
  ["wardId", "WARD_ID", ["WARD_ID", "wardId", "ward_id"]],
  ["bbmpWardNumber", "BBMP_WARD_NUMBER", ["BBMP_WARD_NUMBER", "bbmpWardNumber", "bbmp_ward_number"]],
  ["wardName", "WARD_NAME", ["WARD_NAME", "name", "ward_name", "wardName"]],
  ["wardNameKn", "WARD_NAME_KN", ["WARD_NAME_KN", "wardNameKn", "ward_name_kn"]],
  ["zoneNumber", "ZONE_NUMBER", ["ZONE_NUMBER", "zoneNumber", "zone_number"]],
  ["zoneName", "ZONE_NAME", ["ZONE_NAME", "zoneName", "zone_name"]],
  ["corporationId", "CORPORATION_ID", ["CORPORATION_ID", "corporationId", "corporation_id"]],
  ["corporation", "CORPORATION", ["CORPORATION", "corporation"]],
  ["corporationKn", "CORPORATION_KN", ["CORPORATION_KN", "corporationKn", "corporation_kn"]],
  ["acNo", "AC_NO", ["AC_NO", "acNumber", "ac_no"]],
  ["acName", "AC_NAME", ["AC_NAME", "acName", "ac_name"]],
  ["acNameKn", "AC_NAME_KN", ["AC_NAME_KN", "acNameKn", "ac_name_kn"]],
  ["townName", "TOWN_NAME", ["townname", "townName", "TOWN_NAME"]],
  ["lgdCode", "WARD_LGD_CODE", ["ward_lgd_code", "lgdCode", "WARD_LGD_CODE"]],
];

const WARD_NUMBER_FIELDS = new Set([
  "wardNumber",
  "slNo",
  "wardId",
  "bbmpWardNumber",
  "zoneNumber",
  "corporationId",
  "acNo",
  "lgdCode",
]);

/** Keys that must never appear in public ward data. */
export const FORBIDDEN_WARD_KEY_PATTERN =
  /phone|email|address|councillor|councilor|mobile|contact/i;

function pickFirst(raw, aliases) {
  for (const alias of aliases) {
    if (raw[alias] != null && raw[alias] !== "") {
      return raw[alias];
    }
  }
  return null;
}

/** Raw backend ward properties -> normalized (drops anything not whitelisted, incl. PII). */
export function wardPropertiesFromRaw(raw) {
  const out = {};
  for (const [normalized, , aliases] of WARD_FIELDS) {
    let value = emptyToNull(pickFirst(raw, aliases));
    if (value != null && WARD_NUMBER_FIELDS.has(normalized)) {
      value = Math.trunc(Number(value));
    }
    if (value != null || normalized === "wardName") {
      out[normalized] = value;
    }
  }
  return out;
}

/** Normalized ward properties -> backend canonical keys. */
export function wardPropertiesToLegacy(properties) {
  const out = {};
  for (const [normalized, legacyKey] of WARD_FIELDS) {
    const value = properties[normalized];
    if (value != null) {
      out[legacyKey] = value;
    }
  }
  return out;
}

/** JS port of the backend's normalizeWardGeoProperties (used for parity checks). */
export function backendNormalizeWard(raw) {
  const pickNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const pickString = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    WARD_NO: pickNumber(raw.WARD_NO ?? raw.wardNumber ?? raw.ward_no),
    SL_NO: pickNumber(raw.SL_NO ?? raw.slNo ?? raw.sl_no),
    WARD_ID: pickNumber(raw.WARD_ID ?? raw.wardId ?? raw.ward_id),
    BBMP_WARD_NUMBER: pickNumber(
      raw.BBMP_WARD_NUMBER ?? raw.bbmpWardNumber ?? raw.bbmp_ward_number,
    ),
    WARD_NAME: pickString(raw.WARD_NAME ?? raw.name ?? raw.ward_name ?? raw.wardName),
    WARD_NAME_KN: pickString(raw.WARD_NAME_KN ?? raw.wardNameKn ?? raw.ward_name_kn),
    ZONE_NUMBER: pickNumber(raw.ZONE_NUMBER ?? raw.zoneNumber ?? raw.zone_number),
    ZONE_NAME: pickString(raw.ZONE_NAME ?? raw.zoneName ?? raw.zone_name),
    CORPORATION_ID: pickNumber(
      raw.CORPORATION_ID ?? raw.corporationId ?? raw.corporation_id,
    ),
    CORPORATION: pickString(raw.CORPORATION ?? raw.corporation),
    CORPORATION_KN: pickString(
      raw.CORPORATION_KN ?? raw.corporationKn ?? raw.corporation_kn,
    ),
    AC_NO: pickNumber(raw.AC_NO ?? raw.acNumber ?? raw.ac_no),
    AC_NAME: pickString(raw.AC_NAME ?? raw.acName ?? raw.ac_name),
    AC_NAME_KN: pickString(raw.AC_NAME_KN ?? raw.acNameKn ?? raw.ac_name_kn),
  };
}
