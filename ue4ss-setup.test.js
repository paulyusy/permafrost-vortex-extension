const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const {
  PINNED_URL,
  PINNED_ZIP_SHA256,
  PINNED_LABEL,
  RELEASE_LOADER_SHA256,
  RELEASE_PROXY_SHA256,
  diagnose,
  installedBuildLabel,
  destinationParts,
  ensureUe4ss,
  extractMissing,
  inspectLayout,
  identitiesFromZip,
  readInstalledBuildLabel,
  readProductVersion,
  readLoaders,
  experimentalToken,
  classifyLoaders,
  productVersionInZip,
} = require("./ue4ss-setup");

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function makeZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime(new Date(2024, 1, 14, 12, 0, 0));
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.data);
    const method = file.deflate ? 8 : 0;
    const stored = method === 8 ? zlib.deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.day, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(stored.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([header, name, stored]);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.day, 14);
    centralHeader.writeUInt32LE(crc32(data), 16);
    centralHeader.writeUInt32LE(stored.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    local.push(localRecord);
    central.push(Buffer.concat([centralHeader, name]));
    offset += localRecord.length;
  }
  const centralDir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralDir, eocd]);
}

function sha(data) {
  return crypto.createHash("sha256").update(Buffer.from(data)).digest("hex");
}

const LABEL = "3.0.1-1183-gcdbc0b66";

const BUILT = {
  proxy: "experimental-proxy-1181",
  loader: "experimental-loader-1181",
  ini: "exp-settings",
  releaseProxy: "release-proxy-301",
  releaseLoader: "release-loader-301",
  otherLoader: "some-other-ue4ss",
};

function versioned(payload, productVersion) {
  const key = Buffer.from("ProductVersion\0", "utf16le");
  const value = Buffer.from(productVersion + "\0", "utf16le");
  return Buffer.concat([Buffer.from(payload), key, value]);
}

function testIdentities() {
  return {
    currentProxy: sha(BUILT.proxy),
    currentLoader: sha(BUILT.loader),
    releaseProxy: sha(BUILT.releaseProxy),
    releaseLoader: sha(BUILT.releaseLoader),
  };
}

function gameTree() {
  const gamePath = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ue4ss-"));
  const win64 = path.join(gamePath, "Permafrost", "Binaries", "Win64");
  fs.mkdirSync(win64, { recursive: true });
  fs.writeFileSync(path.join(win64, "Permafrost-Win64-Shipping.exe"), "exe");
  return { gamePath, win64 };
}

function writeCurrent(win64) {
  const mods = path.join(win64, "ue4ss", "Mods");
  fs.mkdirSync(mods, { recursive: true });
  fs.writeFileSync(path.join(win64, "dwmapi.dll"), BUILT.proxy);
  fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), BUILT.loader);
  fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS-settings.ini"), BUILT.ini);
  fs.writeFileSync(path.join(mods, "mods.txt"), "player-list");
}

function experimentalZip(dir) {
  const zipPath = path.join(dir, "experimental.zip");
  fs.writeFileSync(
    zipPath,
    makeZip([
      { name: "dwmapi.dll", data: BUILT.proxy },
      { name: "UE4SS.dll", data: "must-not-land" },
      { name: "ue4ss/UE4SS.dll", data: BUILT.loader, deflate: true },
      { name: "ue4ss/UE4SS-settings.ini", data: BUILT.ini },
      { name: "ue4ss/Mods/mods.txt", data: "stock-list" },
      { name: "ue4ss/Mods/mods.json", data: "stock-json" },
      { name: "ue4ss/Mods/BPModLoaderMod/load_order.txt", data: "stock-order" },
      { name: "ue4ss/Mods/BPModLoaderMod/Scripts/main.lua", data: "new-bpml" },
      { name: "ue4ss/Mods/CheatManagerEnablerMod/Scripts/main.lua", data: "return {}" },
      { name: "ue4ss/Mods/shared/UEHelpers/UEHelpers.lua", data: "return {}\n" },
    ]),
  );
  return zipPath;
}

function yesApi(seen) {
  return {
    showDialog: (_type, _title, body) => {
      seen.texts.push(body.text);
      return Promise.resolve({ action: "Yes" });
    },
  };
}

function acceptedZip(gamePath) {
  const zipPath = experimentalZip(gamePath);
  return {
    zipPath,
    options: {
      download: (url) => {
        assert.equal(url, PINNED_URL);
        return zipPath;
      },
      zipSha256: sha(fs.readFileSync(zipPath)),
      cleanupDownload: true,
    },
  };
}

function snap(over) {
  return Object.assign(
    {
      proxy: "missing",
      loader: "missing",
      flat: "missing",
      gaps: ["ue4ss/UE4SS-settings.ini", "ue4ss/Mods/mods.txt"],
    },
    over,
  );
}

describe("UE4SS layout", () => {
  it("keeps experimental archive paths and drops a root loader", () => {
    assert.deepEqual(destinationParts("dwmapi.dll"), ["dwmapi.dll"]);
    assert.equal(destinationParts("UE4SS.dll"), null);
    assert.deepEqual(destinationParts("ue4ss/UE4SS.dll"), ["ue4ss", "UE4SS.dll"]);
    assert.deepEqual(destinationParts("ue4ss/Mods/mods.txt"), ["ue4ss", "Mods", "mods.txt"]);
    assert.equal(destinationParts("../dwmapi.dll"), null);
    assert.equal(
      installedBuildLabel(snap({ proxy: "current", loader: "current", flat: "missing", gaps: [] }), LABEL),
      "experimental " + LABEL,
    );
    assert.equal(
      installedBuildLabel(snap({ proxy: "release", loader: "missing", flat: "release" })),
      "3.0.1 beside the exe",
    );
    assert.equal(
      installedBuildLabel(snap({ proxy: "release", loader: "release", flat: "missing", gaps: [] })),
      "3.0.1",
    );
    assert.equal(
      installedBuildLabel(snap({ proxy: "current", loader: "current", flat: "release", gaps: [] }), LABEL),
      "experimental " + LABEL + ", plus 3.0.1 beside the exe",
    );
    assert.equal(
      installedBuildLabel(snap({ proxy: "current", loader: "other", flat: "missing", gaps: [] })),
      "unrecognized build",
    );
    assert.equal(installedBuildLabel(snap({})), "not installed");
  });

  it("labels the result inspectLayout returns", () => {
    const { gamePath, win64 } = gameTree();
    try {
      writeCurrent(win64);
      const found = inspectLayout(gamePath, testIdentities());
      assert.equal(found.loader, "current");
      assert.equal(found.flat, "missing");
      assert.equal(installedBuildLabel(found, LABEL), "experimental " + LABEL);
      fs.writeFileSync(path.join(win64, "UE4SS.dll"), BUILT.releaseLoader);
      const both = inspectLayout(gamePath, testIdentities());
      assert.equal(installedBuildLabel(both, LABEL), "experimental " + LABEL + ", plus 3.0.1 beside the exe");
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("names a fix for each layout", () => {
    const current = diagnose(snap({
      proxy: "current",
      loader: "current",
      flat: "missing",
      gaps: [],
    }));
    assert.equal(current.id, "current");
    assert.deepEqual(current.fixes, {
      replaceProxy: false,
      replaceLoader: false,
      deleteFlatLoader: false,
      extractMissing: false,
    });

    const missing = diagnose(snap({}));
    assert.equal(missing.id, "missing");
    assert.equal(missing.fixes.replaceProxy, true);
    assert.equal(missing.fixes.replaceLoader, false);
    assert.equal(missing.fixes.extractMissing, true);
    assert.match(missing.text, /is not installed/);

    const releaseFlat = diagnose(snap({ proxy: "release", flat: "release" }));
    assert.equal(releaseFlat.id, "release-flat");
    assert.equal(releaseFlat.fixes.deleteFlatLoader, true);
    assert.equal(releaseFlat.fixes.replaceProxy, true);
    assert.equal(releaseFlat.fixes.replaceLoader, false);
    assert.match(releaseFlat.text, /UE4SS 3\.0\.1 is installed beside the exe/);
    assert.match(releaseFlat.text, /Reinstall script mods/);
    assert.match(releaseFlat.text, /Binaries\\Win64\\Mods stays/);

    const releaseProxyOnly = diagnose(snap({ proxy: "release", flat: "missing" }));
    assert.equal(releaseProxyOnly.id, "release-flat");
    assert.equal(releaseProxyOnly.fixes.deleteFlatLoader, false);

    const nested = diagnose(snap({
      proxy: "release",
      loader: "release",
      flat: "release",
      gaps: [],
    }));
    assert.equal(nested.id, "release-nested");
    assert.equal(nested.fixes.replaceLoader, true);
    assert.equal(nested.fixes.deleteFlatLoader, true);
    assert.match(nested.text, /inside Binaries\\Win64\\ue4ss/);

    const nestedCurrentProxy = diagnose(snap({
      proxy: "current",
      loader: "release",
      flat: "missing",
      gaps: [],
    }));
    assert.equal(nestedCurrentProxy.id, "release-nested");
    assert.equal(nestedCurrentProxy.fixes.replaceProxy, false);
    assert.equal(nestedCurrentProxy.fixes.replaceLoader, true);

    const stale = diagnose(snap({
      proxy: "current",
      loader: "other",
      flat: "missing",
      gaps: [],
    }), LABEL);
    assert.equal(stale.id, "stale");
    assert.equal(stale.fixes.replaceLoader, true);
    assert.equal(stale.fixes.replaceProxy, false);
    assert.match(stale.text, /not experimental 3\.0\.1-1183-gcdbc0b66/);

    const flatOther = diagnose(snap({ flat: "other" }));
    assert.equal(flatOther.id, "flat-layout");
    assert.equal(flatOther.fixes.deleteFlatLoader, true);
    assert.match(flatOther.text, /old layout/);

    const leftover = diagnose(snap({
      proxy: "current",
      loader: "current",
      flat: "other",
      gaps: [],
    }));
    assert.equal(leftover.id, "leftover-flat");
    assert.deepEqual(leftover.fixes, {
      replaceProxy: false,
      replaceLoader: false,
      deleteFlatLoader: true,
      extractMissing: false,
    });
    assert.match(leftover.text, /second UE4SS\.dll/);

    const gaps = diagnose(snap({
      proxy: "current",
      loader: "current",
      flat: "missing",
      gaps: ["ue4ss/UE4SS-settings.ini"],
    }));
    assert.equal(gaps.id, "incomplete");
    assert.equal(gaps.fixes.extractMissing, true);
    assert.equal(gaps.fixes.replaceLoader, false);
    assert.equal(gaps.fixes.replaceProxy, false);

    const foreignProxy = diagnose(snap({
      proxy: "other",
      loader: "current",
      flat: "missing",
      gaps: [],
    }));
    assert.equal(foreignProxy.id, "incomplete");
    assert.equal(foreignProxy.fixes.replaceProxy, true);
    assert.equal(foreignProxy.fixes.replaceLoader, false);
  });
});

function quietApi() {
  return {
    asked: 0,
    downloaded: 0,
    api: {
      showDialog: () => {
        throw new Error("asked");
      },
    },
    options: {
      download: () => {
        throw new Error("download");
      },
    },
  };
}

describe("UE4SS version gate", () => {
  it("reads a ProductVersion placed after the key, including a short pad", () => {
    assert.equal(readProductVersion(versioned("dll", "6f8dc3cc")), "6f8dc3cc");
    assert.equal(readProductVersion(versioned("dll", "3.0.1")), "3.0.1");
    const key = Buffer.from("ProductVersion\0", "utf16le");
    const value = Buffer.from("3.0.1.0\0", "utf16le");
    const padded = Buffer.concat([Buffer.from("x"), key, Buffer.from([0, 0]), value]);
    assert.equal(readProductVersion(padded), "3.0.1.0");
    assert.equal(readProductVersion(Buffer.from("nope")), "");
    assert.equal(experimentalToken("3.0.1-1208-gf6f8dc3cc"), "3.0.1-1208-gf6f8dc3cc");
    assert.equal(experimentalToken("UE4SS_v3.0.1-1181-g83330635"), "3.0.1-1181-g83330635");
    assert.equal(experimentalToken("6f8dc3cc"), "6f8dc3cc");
    assert.equal(experimentalToken("3.0.1"), null);
    assert.equal(experimentalToken("0.0.0.0"), null);
  });

  it("stays quiet for an experimental hash, a versioned folder, or an unrecognized loader", () => {
    const experimental = classifyLoaders({
      nested: { present: true, productVersion: "6f8dc3cc", dirNames: ["ue4ss"], hash: "abc" },
      flat: { present: true, productVersion: "3.0.1", dirNames: [], hash: RELEASE_LOADER_SHA256 },
    });
    assert.equal(experimental.action, "quiet");
    assert.equal(experimental.id, "experimental");
    assert.equal(experimental.token, "6f8dc3cc");

    const folder = classifyLoaders({
      nested: {
        present: true,
        productVersion: "",
        dirNames: ["Permafrost", "UE4SS_v3.0.1-1181-g83330635"],
        hash: "abc",
      },
      flat: { present: false },
    });
    assert.equal(folder.action, "quiet");
    assert.equal(folder.token, "3.0.1-1181-g83330635");

    const other = classifyLoaders({
      nested: { present: true, productVersion: "", dirNames: ["ue4ss"], hash: "abc" },
      flat: { present: false },
    });
    assert.equal(other.action, "quiet");
    assert.equal(other.id, "other");

    const proxyVersion = classifyLoaders({
      nested: { present: true, productVersion: "0.0.0.0", dirNames: [], hash: "abc" },
      flat: { present: false },
    });
    assert.equal(proxyVersion.action, "quiet");
    assert.equal(proxyVersion.id, "other");
  });

  it("asks for a dotted stable version or a stored 3.0.1 hash", () => {
    const dotted = classifyLoaders({
      nested: { present: true, productVersion: "3.0.1", dirNames: ["ue4ss"], hash: "abc" },
      flat: { present: false },
    });
    assert.equal(dotted.action, "ask");
    assert.equal(dotted.id, "release-nested");

    const dottedFlat = classifyLoaders({
      nested: { present: false },
      flat: { present: true, productVersion: "3.0.1.0", dirNames: [], hash: "abc" },
    });
    assert.equal(dottedFlat.id, "release-flat");

    const hashed = classifyLoaders({
      nested: { present: true, productVersion: "", dirNames: ["ue4ss"], hash: RELEASE_LOADER_SHA256 },
      flat: { present: true, productVersion: "", dirNames: [], hash: RELEASE_PROXY_SHA256 },
    });
    assert.equal(hashed.action, "ask");
    assert.equal(hashed.id, "release-nested");
    assert.equal(hashed.flat, "stable");

    const missing = classifyLoaders({
      nested: { present: false },
      flat: { present: false },
    });
    assert.equal(missing.action, "ask");
    assert.equal(missing.id, "missing");
  });
});

describe("UE4SS setup", () => {
  it("leaves an experimental ProductVersion alone", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      const loader = path.join(win64, "ue4ss", "UE4SS.dll");
      fs.mkdirSync(path.dirname(loader), { recursive: true });
      fs.writeFileSync(loader, versioned(BUILT.loader, "6f8dc3cc"));
      fs.writeFileSync(path.join(win64, "UE4SS.dll"), "extra-loader");
      const gate = quietApi();
      const result = await ensureUe4ss(gamePath, gate.api, gate.options);
      assert.equal(result.asked, false);
      assert.equal(result.id, "experimental");
      assert.equal(readInstalledBuildLabel(gamePath), "experimental 6f8dc3cc");
      assert.equal(fs.readFileSync(path.join(win64, "UE4SS.dll"), "utf8"), "extra-loader");
      assert.deepEqual(readLoaders(gamePath).nested.dirNames, ["Permafrost", "Binaries", "Win64", "ue4ss"]);
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("leaves a versioned folder and an unrecognized loader alone", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      const folderLabel = readInstalledBuildLabel(gamePath, {
        loaders: {
          nested: {
            present: true,
            productVersion: "",
            dirNames: ["UE4SS_v3.0.1-1181-g83330635"],
            hash: "abc",
          },
          flat: { present: false },
        },
      });
      assert.equal(folderLabel, "experimental 3.0.1-1181-g83330635");
      const gate = quietApi();
      const quiet = await ensureUe4ss(gamePath, gate.api, {
        loaders: {
          nested: {
            present: true,
            productVersion: "",
            dirNames: ["UE4SS_v3.0.1-1181-g83330635"],
            hash: "abc",
          },
          flat: { present: false },
        },
        download: gate.options.download,
      });
      assert.equal(quiet.asked, false);
      assert.equal(quiet.id, "experimental");

      writeCurrent(win64);
      fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), BUILT.otherLoader);
      let asked = 0;
      const result = await ensureUe4ss(gamePath, {
        showDialog: () => {
          asked += 1;
          return Promise.resolve({ action: "Yes" });
        },
      }, {
        download: () => {
          throw new Error("download");
        },
      });
      assert.equal(asked, 0);
      assert.equal(result.id, "other");
      assert.equal(readInstalledBuildLabel(gamePath), "unrecognized build");
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.otherLoader);
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "player-list");
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("asks with the missing-install text, and No writes nothing", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      fs.writeFileSync(path.join(win64, "dwmapi.dll"), versioned("proxy", "0.0.0.0"));
      let downloaded = 0;
      await assert.rejects(
        () => ensureUe4ss(gamePath, {
          showDialog: (_type, _title, body) => {
            assert.match(body.text, /is not installed/);
            assert.ok(body.text.includes(PINNED_LABEL));
            return Promise.resolve({ action: "No" });
          },
        }, {
          download: () => {
            downloaded += 1;
            throw new Error("download");
          },
        }),
        (err) => err.code === "UE4SS_DECLINED",
      );
      assert.equal(downloaded, 0);
      assert.equal(readInstalledBuildLabel(gamePath), "not installed");
      assert.equal(fs.existsSync(path.join(win64, "ue4ss")), false);
      assert.equal(fs.readFileSync(path.join(win64, "dwmapi.dll"), "utf8").includes("proxy"), true);
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("keeps a stable install when the answer is No", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      const loader = path.join(win64, "ue4ss", "UE4SS.dll");
      const body = versioned(BUILT.releaseLoader, "3.0.1");
      fs.mkdirSync(path.dirname(loader), { recursive: true });
      fs.writeFileSync(loader, body);
      let downloaded = 0;
      const result = await ensureUe4ss(gamePath, {
        showDialog: (_type, _title, dialog) => {
          assert.match(dialog.text, /inside Binaries\\Win64\\ue4ss/);
          return Promise.resolve({ action: "No" });
        },
      }, {
        download: () => {
          downloaded += 1;
          throw new Error("download");
        },
      });
      assert.equal(downloaded, 0);
      assert.deepEqual(result, { asked: true, declined: true, id: "release-nested", removed: [] });
      assert.equal(readInstalledBuildLabel(gamePath), "3.0.1");
      assert.deepEqual(fs.readFileSync(loader), body);

      const hashed = await ensureUe4ss(gamePath, {
        showDialog: () => Promise.resolve({ action: "No" }),
      }, {
        loaders: {
          nested: { present: true, productVersion: "", dirNames: [], hash: RELEASE_LOADER_SHA256 },
          flat: { present: false },
        },
        download: () => {
          downloaded += 1;
          throw new Error("download");
        },
      });
      assert.equal(downloaded, 0);
      assert.equal(hashed.declined, true);
      assert.equal(hashed.id, "release-nested");
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("writes nothing when the zip hash differs", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      const loader = path.join(win64, "ue4ss", "UE4SS.dll");
      const body = versioned(BUILT.releaseLoader, "3.0.1");
      fs.mkdirSync(path.dirname(loader), { recursive: true });
      fs.writeFileSync(loader, body);
      const zipPath = experimentalZip(gamePath);
      await assert.rejects(
        () => ensureUe4ss(gamePath, yesApi({ texts: [] }), {
          download: (url) => {
            assert.equal(url, PINNED_URL);
            return zipPath;
          },
          zipSha256: "0123456789abcdef".repeat(4),
          cleanupDownload: false,
        }),
        /hash did not match/,
      );
      assert.equal(fs.existsSync(zipPath), false);
      assert.deepEqual(fs.readFileSync(loader), body);
      assert.equal(fs.existsSync(path.join(win64, "dwmapi.dll")), false);
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("switches a flat 3.0.1 install and keeps both mods lists", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      fs.writeFileSync(path.join(win64, "dwmapi.dll"), BUILT.releaseProxy);
      fs.writeFileSync(path.join(win64, "UE4SS.dll"), versioned(BUILT.releaseLoader, "3.0.1"));
      fs.writeFileSync(path.join(win64, "UE4SS-settings.ini"), "flat-settings");
      fs.mkdirSync(path.join(win64, "Mods"), { recursive: true });
      fs.writeFileSync(path.join(win64, "Mods", "mods.txt"), "flat-list");
      fs.mkdirSync(path.join(win64, "ue4ss", "Mods"), { recursive: true });
      fs.writeFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "player-list");
      const seen = { texts: [] };
      const packed = acceptedZip(gamePath);
      const result = await ensureUe4ss(gamePath, yesApi(seen), packed.options);
      assert.equal(result.id, "release-flat");
      assert.match(seen.texts[0], /beside the exe/);
      assert.equal(fs.existsSync(path.join(win64, "UE4SS.dll")), false);
      assert.equal(fs.readFileSync(path.join(win64, "dwmapi.dll"), "utf8"), BUILT.proxy);
      assert.equal(fs.readFileSync(path.join(win64, "UE4SS-settings.ini"), "utf8"), "flat-settings");
      assert.equal(fs.readFileSync(path.join(win64, "Mods", "mods.txt"), "utf8"), "flat-list");
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.loader);
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "utf8"), BUILT.ini);
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "player-list");
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.json"), "utf8"), "stock-json");
      assert.equal(
        fs.readFileSync(path.join(win64, "ue4ss", "Mods", "BPModLoaderMod", "load_order.txt"), "utf8"),
        "stock-order",
      );
      assert.equal(
        fs.readFileSync(path.join(win64, "ue4ss", "Mods", "CheatManagerEnablerMod", "Scripts", "main.lua"), "utf8"),
        "return {}",
      );
      assert.equal(fs.existsSync(packed.zipPath), false);
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("refreshes built-in files and keeps the saved lists and a player folder", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      writeCurrent(win64);
      const loader = path.join(win64, "ue4ss", "UE4SS.dll");
      fs.writeFileSync(loader, versioned(BUILT.releaseLoader, "3.0.1"));
      fs.writeFileSync(path.join(win64, "UE4SS.dll"), versioned(BUILT.releaseLoader, "3.0.1"));
      fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "player-settings");
      const mods = path.join(win64, "ue4ss", "Mods");
      fs.writeFileSync(path.join(mods, "mods.txt"), "player-list");
      fs.writeFileSync(path.join(mods, "mods.json"), "player-json");
      const bp = path.join(mods, "BPModLoaderMod");
      fs.mkdirSync(path.join(bp, "Scripts"), { recursive: true });
      fs.writeFileSync(path.join(bp, "load_order.txt"), "player-order");
      fs.writeFileSync(path.join(bp, "Scripts", "main.lua"), "old-bpml");
      fs.writeFileSync(path.join(bp, "Scripts", "obsolete.lua"), "gone");
      const shared = path.join(mods, "shared", "UEHelpers");
      fs.mkdirSync(shared, { recursive: true });
      fs.writeFileSync(path.join(shared, "old.lua"), "gone");
      const player = path.join(mods, "PlayerMod");
      fs.mkdirSync(path.join(player, "Scripts"), { recursive: true });
      fs.writeFileSync(path.join(player, "Scripts", "main.lua"), "player");
      fs.writeFileSync(path.join(player, "config.lua"), "keep-me");
      const seen = { texts: [] };
      assert.equal(readInstalledBuildLabel(gamePath), "3.0.1, plus 3.0.1 beside the exe");
      const result = await ensureUe4ss(gamePath, yesApi(seen), acceptedZip(gamePath).options);
      assert.equal(result.id, "release-nested");
      assert.match(seen.texts[0], /inside Binaries\\Win64\\ue4ss/);
      assert.equal(fs.existsSync(path.join(win64, "dwmapi.dll")), true);
      assert.equal(fs.existsSync(path.join(win64, "UE4SS.dll")), false);
      assert.equal(fs.readFileSync(loader, "utf8"), BUILT.loader);
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "utf8"), "player-settings");
      assert.equal(fs.readFileSync(path.join(mods, "mods.txt"), "utf8"), "player-list");
      assert.equal(fs.readFileSync(path.join(mods, "mods.json"), "utf8"), "player-json");
      assert.equal(fs.readFileSync(path.join(bp, "load_order.txt"), "utf8"), "player-order");
      assert.equal(fs.readFileSync(path.join(bp, "Scripts", "main.lua"), "utf8"), "new-bpml");
      assert.equal(fs.existsSync(path.join(bp, "Scripts", "obsolete.lua")), false);
      assert.equal(fs.readFileSync(path.join(shared, "UEHelpers.lua"), "utf8"), "return {}\n");
      assert.equal(fs.existsSync(path.join(shared, "old.lua")), false);
      assert.equal(fs.readFileSync(path.join(player, "Scripts", "main.lua"), "utf8"), "player");
      assert.equal(fs.readFileSync(path.join(player, "config.lua"), "utf8"), "keep-me");
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });
});

describe("experimental UE4SS zip", () => {
  const zipPath = "C:/Users/Paulyus/Downloads/PERMAFROST/MODS/UE4SS_v3.0.1-1181/UE4SS_v3.0.1-1181-g83330635.zip";

  it("places the pinned build beside the exe and under ue4ss", (t) => {
    if (!fs.existsSync(zipPath)) {
      t.skip("experimental zip is not on disk");
      return;
    }
    const { gamePath, win64 } = gameTree();
    try {
      fs.mkdirSync(path.join(win64, "ue4ss", "Mods"), { recursive: true });
      fs.writeFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "live-list");
      fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "stale-loader");
      const first = extractMissing(zipPath, win64);
      assert.equal(fs.existsSync(path.join(win64, "UE4SS.dll")), false);
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), "stale-loader");
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "live-list");
      assert.ok(first.skipped.some((file) => file.endsWith(path.join("ue4ss", "UE4SS.dll"))));
      fs.rmSync(path.join(win64, "ue4ss", "UE4SS.dll"));
      extractMissing(zipPath, win64);
      const ids = identitiesFromZip(zipPath);
      assert.equal(sha(fs.readFileSync(path.join(win64, "dwmapi.dll"))), ids.currentProxy);
      assert.equal(sha(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"))), ids.currentLoader);
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "live-list");
      const found = inspectLayout(gamePath, ids);
      assert.equal(found.id, "current");
      const second = extractMissing(zipPath, win64);
      assert.equal(second.written.length, 0);
    } finally {
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });
});


describe("zip identities", () => {
  it("reads the proxy and nested loader from the zip and ignores a root loader", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ue4ss-zip-"));
    try {
      const ids = identitiesFromZip(experimentalZip(dir));
      assert.equal(ids.currentProxy, sha(BUILT.proxy));
      assert.equal(ids.currentLoader, sha(BUILT.loader));
      assert.notEqual(ids.currentLoader, sha("must-not-land"));
      assert.equal(ids.releaseProxy, RELEASE_PROXY_SHA256);
      assert.equal(ids.releaseLoader, RELEASE_LOADER_SHA256);
      const bare = path.join(dir, "bare.zip");
      fs.writeFileSync(bare, makeZip([{ name: "dwmapi.dll", data: BUILT.proxy }]));
      assert.throws(() => identitiesFromZip(bare), /missing dwmapi\.dll or ue4ss\/UE4SS\.dll/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pinned local zips", () => {
  const zip1208 = "C:/Users/Paulyus/Documents/My Games/Permafrost/UE4SS Experimental/UE4SS_v3.0.1-1208-g6f8dc3cc.zip";
  const zip1181 = "C:/Users/Paulyus/Downloads/PERMAFROST/MODS/UE4SS_v3.0.1-1181/UE4SS_v3.0.1-1181-g83330635.zip";

  it("matches the pinned zip hash and reads ProductVersion 6f8dc3cc", (t) => {
    if (!fs.existsSync(zip1208)) {
      t.skip("pinned zip is not on disk");
      return;
    }
    assert.equal(sha(fs.readFileSync(zip1208)), PINNED_ZIP_SHA256);
    assert.equal(productVersionInZip(zip1208), "6f8dc3cc");
  });

  it("does not treat the 1181 loader version as a stable release", (t) => {
    if (!fs.existsSync(zip1181)) {
      t.skip("1181 zip is not on disk");
      return;
    }
    const version = productVersionInZip(zip1181);
    assert.equal(/^\d+\.\d+\.\d+(\.\d+)?$/.test(version), false);
    assert.equal(experimentalToken(version), null);
  });
});
