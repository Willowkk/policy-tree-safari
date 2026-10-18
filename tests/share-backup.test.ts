import test from "node:test";
import assert from "node:assert/strict";
import { shareOrDownloadBackup } from "../src/share-backup";

test("successful file sharing does not start a second download", async () => {
  let downloads = 0;
  assert.equal(await shareOrDownloadBackup(async () => {}, () => { downloads++; }), "shared");
  assert.equal(downloads, 0);
});

test("cancelling file sharing does not trigger an unwanted fallback", async () => {
  let downloads = 0;
  const cancelled = new Error("Cancelled");
  cancelled.name = "AbortError";
  assert.equal(await shareOrDownloadBackup(async () => { throw cancelled; }, () => { downloads++; }), "cancelled");
  assert.equal(downloads, 0);
});

test("a host that refuses file sharing falls back to the JSON download", async () => {
  let downloads = 0;
  assert.equal(await shareOrDownloadBackup(async () => { throw new Error("Permission denied"); }, () => { downloads++; }), "downloaded");
  assert.equal(downloads, 1);
});

test("download failure is reported rather than treated as a saved backup", async () => {
  await assert.rejects(shareOrDownloadBackup(undefined, () => { throw new Error("Download unavailable"); }), /Download unavailable/);
});
