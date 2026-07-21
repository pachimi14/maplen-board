function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readVersionedState(backend, { key, versionField, version, normalize, createDefault }) {
  let raw;
  try {
    raw = backend?.getItem(key);
  } catch {
    return { state: createDefault(), status: "storageError" };
  }
  if (!raw) return { state: createDefault(), status: "missing" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: createDefault(), status: "corrupt" };
  }
  if (!isObject(parsed) || !Object.hasOwn(parsed, versionField)) {
    return { state: createDefault(), status: "corrupt" };
  }
  if (parsed[versionField] !== version) {
    return { state: createDefault(), status: "unsupportedVersion" };
  }
  return { state: normalize(parsed), status: "ok" };
}

export function writeVersionedState(backend, key, state, normalize) {
  try {
    backend?.setItem(key, JSON.stringify(normalize(state)));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

