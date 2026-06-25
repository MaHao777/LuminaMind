const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const frontendDir = path.join(__dirname, "..");
const releaseDir = path.join(__dirname, "..", "release");
const checksumPath = path.join(releaseDir, "SHA256SUMS.txt");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(frontendDir, "package.json"), "utf8"),
);
const installerName = `LuminaMind-${packageJson.version}-Setup.exe`;
const releaseArtifacts = new Set([installerName, `${installerName}.blockmap`]);

if (!fs.existsSync(releaseDir)) {
  throw new Error(`Release directory does not exist: ${releaseDir}`);
}

const entries = fs
  .readdirSync(releaseDir)
  .filter((name) => releaseArtifacts.has(name))
  .filter((name) => fs.statSync(path.join(releaseDir, name)).isFile())
  .sort()
  .map((name) => {
    const filePath = path.join(releaseDir, name);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    return `${digest}  ${name}`;
  });

fs.writeFileSync(checksumPath, `${entries.join("\n")}\n`, "utf8");
