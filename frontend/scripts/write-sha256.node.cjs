const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("writes checksums only for the current release artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luminamind-checksums-"));
  const frontendDir = path.join(root, "frontend");
  const scriptsDir = path.join(frontendDir, "scripts");
  const releaseDir = path.join(frontendDir, "release");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  fs.copyFileSync(
    path.join(__dirname, "write-sha256.cjs"),
    path.join(scriptsDir, "write-sha256.cjs"),
  );
  fs.writeFileSync(
    path.join(frontendDir, "package.json"),
    JSON.stringify({ version: "0.1.1" }),
  );

  for (const name of [
    "LuminaMind-0.1.0-Setup.exe",
    "LuminaMind-0.1.0-Setup.exe.blockmap",
    "LuminaMind-0.1.1-Setup.exe",
    "LuminaMind-0.1.1-Setup.exe.blockmap",
    "builder-debug.yml",
  ]) {
    fs.writeFileSync(path.join(releaseDir, name), name);
  }

  const result = spawnSync(process.execPath, [path.join(scriptsDir, "write-sha256.cjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const entries = fs
    .readFileSync(path.join(releaseDir, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.slice(line.indexOf("  ") + 2));

  assert.deepEqual(entries, [
    "LuminaMind-0.1.1-Setup.exe",
    "LuminaMind-0.1.1-Setup.exe.blockmap",
  ]);
});
