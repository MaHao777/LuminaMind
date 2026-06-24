const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function decodeRgbaPng(png) {
  assert.equal(
    png.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "ICO image must use a PNG payload",
  );

  let width;
  let height;
  const compressed = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "PNG must use 8-bit channels");
      assert.equal(data[9], 6, "PNG must use RGBA color");
      assert.equal(data[12], 0, "interlaced PNG is not supported");
    } else if (type === "IDAT") {
      compressed.push(data);
    }
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const source = raw[sourceOffset + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft =
        y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value;
      if (filter === 0) value = source;
      else if (filter === 1) value = source + left;
      else if (filter === 2) value = source + above;
      else if (filter === 3) value = source + Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        value =
          source +
          (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
            ? left
            : aboveDistance <= upperLeftDistance
              ? above
              : upperLeft);
      } else {
        assert.fail(`unsupported PNG filter ${filter}`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
    sourceOffset += stride;
  }
  return { width, height, pixels };
}

function alphaAt(image, x, y) {
  return image.pixels[(y * image.width + x) * 4 + 3];
}

const frontendRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(frontendRoot, "package.json"), "utf8"),
);
const configuredIcon = packageJson.build?.win?.icon;

for (const scriptName of ["dist:dir", "dist:win"]) {
  assert.match(
    packageJson.scripts?.[scriptName] || "",
    /electron-builder@26\.15\.3/,
    `${scriptName} must use the Windows toolset-aware electron-builder version`,
  );
}
assert.equal(
  packageJson.build?.toolsets?.winCodeSign,
  "1.1.0",
  "Windows builds must use the split winCodeSign toolset",
);
assert.equal(
  configuredIcon,
  "build/icon.ico",
  "electron-builder must use build/icon.ico for Windows builds",
);
assert.notEqual(
  packageJson.build?.win?.signAndEditExecutable,
  false,
  "Windows executable resource editing must remain enabled for icon stamping",
);
assert.equal(
  packageJson.build?.nsis?.installerIcon,
  "build/icon.ico",
  "the NSIS installer must use build/icon.ico",
);
assert.equal(
  packageJson.build?.nsis?.uninstallerIcon,
  "build/icon.ico",
  "the NSIS uninstaller must use build/icon.ico",
);

const iconPath = path.join(frontendRoot, configuredIcon);
assert.ok(fs.existsSync(iconPath), `${configuredIcon} is missing`);

const icon = fs.readFileSync(iconPath);
assert.ok(icon.length >= 6, "icon file is too small");
assert.equal(icon.readUInt16LE(0), 0, "invalid ICO reserved field");
assert.equal(icon.readUInt16LE(2), 1, "file is not a Windows ICO");

const imageCount = icon.readUInt16LE(4);
assert.ok(imageCount > 0, "ICO contains no images");
assert.ok(icon.length >= 6 + imageCount * 16, "ICO directory is truncated");

const sizes = [];
for (let index = 0; index < imageCount; index += 1) {
  const offset = 6 + index * 16;
  sizes.push({
    width: icon[offset] || 256,
    height: icon[offset + 1] || 256,
  });
}

assert.ok(
  sizes.some(({ width, height }) => width >= 256 && height >= 256),
  `ICO must contain a 256x256 image; found ${sizes
    .map(({ width, height }) => `${width}x${height}`)
    .join(", ")}`,
);

const firstImageOffset = icon.readUInt32LE(18);
const firstImageSize = icon.readUInt32LE(14);
const image = decodeRgbaPng(
  icon.subarray(firstImageOffset, firstImageOffset + firstImageSize),
);
for (const [x, y] of [
  [0, 0],
  [image.width - 1, 0],
  [0, image.height - 1],
  [image.width - 1, image.height - 1],
]) {
  assert.ok(alphaAt(image, x, y) <= 16, `icon corner ${x},${y} must be transparent`);
}
assert.ok(
  alphaAt(image, Math.floor(image.width / 2), Math.floor(image.height / 2)) >=
    240,
  "icon center must remain opaque",
);

console.log(
  `Windows app icon verified: ${configuredIcon} (${sizes
    .map(({ width, height }) => `${width}x${height}`)
    .join(", ")})`,
);
