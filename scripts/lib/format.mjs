/**
 * Diff-friendly JSON: 2-space indent, but numeric arrays (positions, bboxes)
 * stay on one line, so a boundary edit shows up as a few changed lines.
 */
function isNumberArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number")
  );
}

function serialize(value, indent) {
  if (isNumberArray(value)) {
    return `[${value.join(", ")}]`;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return "[]";
    }
    const inner = `${indent}  `;
    return `[\n${value.map((item) => inner + serialize(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([, item]) => item !== undefined,
    );
    if (!entries.length) {
      return "{}";
    }
    const inner = `${indent}  `;
    return `{\n${entries
      .map(([key, item]) => `${inner}${JSON.stringify(key)}: ${serialize(item, inner)}`)
      .join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function formatJson(value) {
  return `${serialize(value, "")}\n`;
}

export function compactJson(value) {
  return `${JSON.stringify(value)}\n`;
}
