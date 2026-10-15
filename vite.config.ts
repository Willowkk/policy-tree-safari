import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { deploymentManifest, normalizeBase, precachePaths, scopedCachePrefix } from "./config/pwa-paths.ts";

const base = normalizeBase(process.env.POLICY_TREE_BASE);

export default defineConfig({
  base,
  plugins: [react(), {
    name: "policy-tree-offline-assets",
    apply: "build",
    async writeBundle(options) {
      const directory = options.dir!;
      const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
      await writeFile(join(directory, "manifest.webmanifest"), JSON.stringify(deploymentManifest(manifest, base), null, 2) + "\n");
      const list: string[] = [];
      async function visit(dir: string) {
        for (const item of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, item.name);
          if (item.isDirectory()) await visit(path);
          else if (item.name !== "sw.js") list.push(path);
        }
      }
      await visit(directory);
      list.sort();
      const digest = createHash("sha256");
      const template = await readFile("src/service-worker.template.js", "utf8");
      digest.update(base);
      digest.update(template);
      for (const file of list) {
        digest.update(relative(directory, file));
        digest.update(await readFile(file));
      }
      const assets = precachePaths(list.map(path => relative(directory, path).replaceAll("\\", "/")), base);
      const cachePrefix = scopedCachePrefix(base);
      const worker = template.replace("__RELEASE__", JSON.stringify(cachePrefix + digest.digest("hex").slice(0, 16)))
        .replace("__CACHE_PREFIX__", JSON.stringify(cachePrefix))
        .replace("__BASE__", JSON.stringify(base))
        .replace("__PRECACHE__", JSON.stringify(assets));
      await writeFile(join(directory, "sw.js"), worker);
    }
  }],
  build: { target: "es2022" },
});
