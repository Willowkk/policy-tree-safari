import { createHash } from "node:crypto";

/** Only deployment paths are accepted; an origin would break same-origin offline caching. */
export function normalizeBase(value = "/") {
  if (!value) return "/";
  if (!value.startsWith("/") || !/^[/a-zA-Z0-9_.-]+$/.test(value) || value.includes("//")
    || value.split("/").some(segment => segment === "." || segment === "..")) {
    throw new Error("POLICY_TREE_BASE must be an absolute path such as /policy-tree-safari/");
  }
  return value.endsWith("/") ? value : value + "/";
}

export function scopedCachePrefix(base: string) {
  return "policy-tree-local-" + createHash("sha256").update(base).digest("hex").slice(0, 12) + "-";
}

export function deploymentManifest<T extends { icons: Array<{ src: string }> }>(manifest: T, base: string) {
  return {
    ...manifest,
    id: base,
    start_url: base,
    scope: base,
    icons: manifest.icons.map(icon => ({ ...icon, src: base + icon.src.replace(/^\/+/, "") })),
  };
}

export function precachePaths(files: string[], base: string) {
  // Static hosts redirect index.html to the directory URL. Fetch only the canonical shell.
  return [base, ...files.filter(path => path !== "index.html").map(path => base + path)];
}
