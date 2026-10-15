import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentManifest, normalizeBase, precachePaths, scopedCachePrefix } from "../config/pwa-paths";

test("deployment paths default to root and normalize a project path", () => {
  assert.equal(normalizeBase(), "/");
  assert.equal(normalizeBase(""), "/");
  assert.equal(normalizeBase("/policy-tree-safari"), "/policy-tree-safari/");
  assert.equal(normalizeBase("/policy-tree-safari/"), "/policy-tree-safari/");
  for (const invalid of ["https://other.test/", "relative/", "//other.test/", "/../", "/project/?x=1", "/project/#hash", "/project//nested/"]) {
    assert.throws(() => normalizeBase(invalid), /POLICY_TREE_BASE/);
  }
});

test("the manifest launches within the project path and preserves icon metadata", () => {
  const manifest = { name: "Policy Tree", id: "/", start_url: "/", scope: "/", icons: [{ src: "/icon.png", sizes: "192x192", purpose: "any maskable" }] };
  const result = deploymentManifest(manifest, "/policy-tree-safari/");
  assert.equal(result.id, "/policy-tree-safari/");
  assert.equal(result.start_url, result.id);
  assert.equal(result.scope, result.id);
  assert.deepEqual(result.icons, [{ src: "/policy-tree-safari/icon.png", sizes: "192x192", purpose: "any maskable" }]);
  assert.equal(manifest.icons[0].src, "/icon.png");
  assert.equal(deploymentManifest(manifest, "/").icons[0].src, "/icon.png");
});

test("precache URLs use the canonical directory shell and never its redirect alias", () => {
  const files = ["index.html", "assets/app.js", "manifest.webmanifest", "icon.png"];
  assert.deepEqual(precachePaths(files, "/policy-tree-safari/"), ["/policy-tree-safari/", "/policy-tree-safari/assets/app.js", "/policy-tree-safari/manifest.webmanifest", "/policy-tree-safari/icon.png"]);
  assert.deepEqual(precachePaths(files, "/"), ["/", "/assets/app.js", "/manifest.webmanifest", "/icon.png"]);
});

test("different install paths have separate cache namespaces", () => {
  const root = scopedCachePrefix("/");
  const project = scopedCachePrefix("/policy-tree-safari/");
  assert.equal(project, scopedCachePrefix("/policy-tree-safari/"));
  assert.notEqual(root, project);
  assert.ok(!root.startsWith(project));
  assert.ok(!project.startsWith(root));
});
