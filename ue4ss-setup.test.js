const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const {
  RELEASES_API_URL,
  RELEASE_LOADER_SHA256,
  RELEASE_PROXY_SHA256,
  diagnose,
  installedBuildLabel,
  destinationParts,
  ensureUe4ss,
  extractMissing,
  inspectLayout,
  identitiesFromZip,
  labelFromAssetName,
  pickExperimentalAsset,
  readInstalledBuildLabel,
  clearPublishedBuild,
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
      { name: "ue4ss/Mods/CheatManagerEnablerMod/Scripts/main.lua", data: "return {}" },
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

describe("UE4SS setup", () => {
  it("leaves a current install alone", async () => {
    const { gamePath, win64 } = gameTree();
    writeCurrent(win64);
    let asked = 0;
    const result = await ensureUe4ss(gamePath, {
      showDialog: () => { asked += 1; },
    }, {
      identities: testIdentities(),
      download: () => { throw new Error("download"); },
    });
    assert.equal(asked, 0);
    assert.equal(result.id, "current");
    fs.rmSync(gamePath, { recursive: true, force: true });
  });

  it("asks with the missing-install text, and No writes nothing", async () => {
    const { gamePath, win64 } = gameTree();
    await assert.rejects(
      () => ensureUe4ss(gamePath, {
        showDialog: (_type, _title, body) => {
          assert.match(body.text, /is not installed/);
          assert.ok(body.text.includes(LABEL));
          return Promise.resolve({ action: "No" });
        },
      }, {
        identities: testIdentities(),
        label: LABEL,
        download: () => { throw new Error("download"); },
      }),
      (err) => err.code === "UE4SS_DECLINED",
    );
    assert.equal(fs.existsSync(path.join(win64, "dwmapi.dll")), false);
    assert.equal(fs.existsSync(path.join(win64, "ue4ss")), false);
    fs.rmSync(gamePath, { recursive: true, force: true });
  });

  it("switches a flat 3.0.1 install and keeps both mods lists", async () => {
    const { gamePath, win64 } = gameTree();
    fs.writeFileSync(path.join(win64, "dwmapi.dll"), BUILT.releaseProxy);
    fs.writeFileSync(path.join(win64, "UE4SS.dll"), BUILT.releaseLoader);
    fs.writeFileSync(path.join(win64, "UE4SS-settings.ini"), "flat-settings");
    fs.mkdirSync(path.join(win64, "Mods"), { recursive: true });
    fs.writeFileSync(path.join(win64, "Mods", "mods.txt"), "flat-list");
    fs.mkdirSync(path.join(win64, "ue4ss", "Mods"), { recursive: true });
    fs.writeFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "player-list");
    const seen = { texts: [] };
    const result = await ensureUe4ss(gamePath, yesApi(seen), {
      identities: testIdentities(),
      download: () => experimentalZip(gamePath),
    });
    assert.equal(result.id, "release-flat");
    assert.match(seen.texts[0], /beside the exe/);
    assert.equal(fs.existsSync(path.join(win64, "UE4SS.dll")), false);
    assert.equal(fs.readFileSync(path.join(win64, "dwmapi.dll"), "utf8"), BUILT.proxy);
    assert.equal(fs.readFileSync(path.join(win64, "UE4SS-settings.ini"), "utf8"), "flat-settings");
    assert.equal(fs.readFileSync(path.join(win64, "Mods", "mods.txt"), "utf8"), "flat-list");
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.loader);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "utf8"), BUILT.ini);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "player-list");
    assert.equal(
      fs.readFileSync(path.join(win64, "ue4ss", "Mods", "CheatManagerEnablerMod", "Scripts", "main.lua"), "utf8"),
      "return {}",
    );
    fs.rmSync(gamePath, { recursive: true, force: true });
  });

  it("replaces a 3.0.1 loader inside ue4ss and keeps mods.txt", async () => {
    const { gamePath, win64 } = gameTree();
    writeCurrent(win64);
    fs.writeFileSync(path.join(win64, "dwmapi.dll"), BUILT.releaseProxy);
    fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), BUILT.releaseLoader);
    fs.writeFileSync(path.join(win64, "UE4SS.dll"), BUILT.releaseLoader);
    const seen = { texts: [] };
    const result = await ensureUe4ss(gamePath, yesApi(seen), {
      identities: testIdentities(),
      download: () => experimentalZip(gamePath),
    });
    assert.equal(result.id, "release-nested");
    assert.match(seen.texts[0], /inside Binaries\\Win64\\ue4ss/);
    assert.equal(fs.existsSync(path.join(win64, "UE4SS.dll")), false);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.loader);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "player-list");
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS-settings.ini"), "utf8"), BUILT.ini);
    fs.rmSync(gamePath, { recursive: true, force: true });
  });

  it("updates a loader that is neither 3.0.1 nor the pinned build", async () => {
    const { gamePath, win64 } = gameTree();
    writeCurrent(win64);
    fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), BUILT.otherLoader);
    const seen = { texts: [] };
    const result = await ensureUe4ss(gamePath, yesApi(seen), {
      identities: testIdentities(),
      download: () => experimentalZip(gamePath),
    });
    assert.equal(result.id, "stale");
    assert.equal(fs.readFileSync(path.join(win64, "dwmapi.dll"), "utf8"), BUILT.proxy);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.loader);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "Mods", "mods.txt"), "utf8"), "player-list");
    assert.match(seen.texts[0], /Update|Replace the loader/);
    fs.rmSync(gamePath, { recursive: true, force: true });
  });

  it("removes a leftover flat loader without downloading", async () => {
    const { gamePath, win64 } = gameTree();
    writeCurrent(win64);
    fs.writeFileSync(path.join(win64, "UE4SS.dll"), "extra-loader");
    let downloaded = 0;
    const result = await ensureUe4ss(gamePath, {
      showDialog: () => Promise.resolve({ action: "Yes" }),
    }, {
      identities: testIdentities(),
      download: () => {
        downloaded += 1;
        throw new Error("download");
      },
    });
    assert.equal(downloaded, 0);
    assert.equal(result.id, "leftover-flat");
    assert.equal(fs.existsSync(path.join(win64, "UE4SS.dll")), false);
    assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.loader);
    fs.rmSync(gamePath, { recursive: true, force: true });
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

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function publishedAssets(name, url) {
  return [
    { name: "zDEV-UE4SS_v3.0.1-1183-gcdbc0b66.zip", browser_download_url: "https://example.invalid/dev.zip" },
    { name, browser_download_url: url },
    { name: "zCustomGameConfigs.zip", browser_download_url: "https://example.invalid/cfg.zip" },
    { name: "zMapGenBP.zip", browser_download_url: "https://example.invalid/map.zip" },
  ];
}

describe("published experimental release", { concurrency: 1 }, () => {
  beforeEach(() => clearPublishedBuild());

  it("picks the one UE4SS_v3.0.1 zip and names the build from that file", () => {
    const picked = pickExperimentalAsset({
      assets: publishedAssets("UE4SS_v3.0.1-1183-gcdbc0b66.zip", "https://example.invalid/current.zip"),
    });
    assert.equal(picked.name, "UE4SS_v3.0.1-1183-gcdbc0b66.zip");
    assert.equal(picked.url, "https://example.invalid/current.zip");
    assert.equal(picked.label, LABEL);
    assert.equal(labelFromAssetName(picked.name), LABEL);
    assert.throws(
      () => pickExperimentalAsset({
        assets: [
          { name: "zDEV-UE4SS_v3.0.1-1183-gcdbc0b66.zip", browser_download_url: "https://example.invalid/dev.zip" },
          { name: "zMapGenBP.zip", browser_download_url: "https://example.invalid/map.zip" },
        ],
      }),
      /listed 0 archives named UE4SS_v3\.0\.1-\*\.zip \(zDEV-UE4SS_v3\.0\.1-1183-gcdbc0b66\.zip, zMapGenBP\.zip\)/,
    );
    assert.throws(
      () => pickExperimentalAsset({
        assets: [
          { name: "UE4SS_v3.0.1-1-ga.zip", browser_download_url: "https://example.invalid/1.zip" },
          { name: "UE4SS_v3.0.1-2-gb.zip", browser_download_url: "https://example.invalid/2.zip" },
        ],
      }),
      /listed 2 archives named UE4SS_v3\.0\.1-\*\.zip \(UE4SS_v3\.0\.1-1-ga\.zip, UE4SS_v3\.0\.1-2-gb\.zip\)/,
    );
    assert.throws(
      () => pickExperimentalAsset({ assets: [{ name: "UE4SS_v3.0.1-1183-gcdbc0b66.zip" }] }),
      /no download URL \(UE4SS_v3\.0\.1-1183-gcdbc0b66\.zip\)/,
    );
    assert.throws(
      () => pickExperimentalAsset(null),
      /listed 0 archives named UE4SS_v3\.0\.1-\*\.zip \(none\)/,
    );
  });

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

  it("stops before the download when the release lookup fails or the asset list is wrong", async () => {
    const cases = [
      {
        fetchRelease: async () => jsonResponse({}, 404),
        pattern: /release lookup failed \(404\)/,
      },
      {
        fetchRelease: async () => { throw new Error("offline"); },
        pattern: /release lookup failed \(offline\)/,
      },
      {
        fetchRelease: async () => ({ ok: true, status: 200, json: async () => { throw new Error("nope"); } }),
        pattern: /invalid JSON/,
      },
      {
        fetchRelease: async () => jsonResponse({
          assets: [
            { name: "zDEV-UE4SS_v3.0.1-1183-gcdbc0b66.zip", browser_download_url: "https://example.invalid/dev.zip" },
            { name: "zMapGenBP.zip", browser_download_url: "https://example.invalid/map.zip" },
          ],
        }),
        pattern: /listed 0 archives named UE4SS_v3\.0\.1-\*\.zip \(zDEV-UE4SS_v3\.0\.1-1183-gcdbc0b66\.zip, zMapGenBP\.zip\)/,
      },
      {
        fetchRelease: async () => jsonResponse({
          assets: [
            { name: "UE4SS_v3.0.1-1-ga.zip", browser_download_url: "https://example.invalid/1.zip" },
            { name: "UE4SS_v3.0.1-2-gb.zip", browser_download_url: "https://example.invalid/2.zip" },
          ],
        }),
        pattern: /listed 2 archives/,
      },
      {
        fetchRelease: async () => jsonResponse({
          assets: [{ name: "UE4SS_v3.0.1-1183-gcdbc0b66.zip" }],
        }),
        pattern: /no download URL/,
      },
    ];
    for (const item of cases) {
      clearPublishedBuild();
      const { gamePath } = gameTree();
      let downloads = 0;
      try {
        await assert.rejects(
          () => ensureUe4ss(gamePath, {
            showDialog: () => { throw new Error("asked"); },
          }, {
            fetchRelease: item.fetchRelease,
            download: () => {
              downloads += 1;
              throw new Error("download");
            },
            cleanupDownload: true,
          }),
          item.pattern,
        );
        assert.equal(downloads, 0);
      } finally {
        clearPublishedBuild();
        fs.rmSync(gamePath, { recursive: true, force: true });
      }
    }
  });

  it("leaves a disk install that matches the published zip and shares that label", async () => {
    const { gamePath, win64 } = gameTree();
    let downloads = 0;
    try {
      writeCurrent(win64);
      const fetchRelease = async (url, init) => {
        assert.equal(url, RELEASES_API_URL);
        assert.equal(init.headers.Accept, "application/vnd.github+json");
        assert.equal(init.headers["User-Agent"], "permafrost-vortex");
        return jsonResponse({
          assets: publishedAssets("UE4SS_v3.0.1-1183-gcdbc0b66.zip", "https://example.invalid/current.zip"),
        });
      };
      const download = (url) => {
        downloads += 1;
        assert.equal(url, "https://example.invalid/current.zip");
        return experimentalZip(gamePath);
      };
      const result = await ensureUe4ss(gamePath, {
        showDialog: () => { throw new Error("asked"); },
      }, {
        fetchRelease,
        download,
        cleanupDownload: true,
      });
      assert.equal(result.asked, false);
      assert.equal(result.id, "current");
      assert.equal(downloads, 1);
      assert.equal(fs.existsSync(path.join(gamePath, "experimental.zip")), false);
      const label = await readInstalledBuildLabel(gamePath, {
        fetchRelease,
        download: () => {
          downloads += 1;
          throw new Error("second download");
        },
      });
      assert.equal(label, "experimental " + LABEL);
      assert.equal(downloads, 1);
    } finally {
      clearPublishedBuild();
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("asks with the published name and extracts that zip once when the disk differs", async () => {
    const { gamePath, win64 } = gameTree();
    let downloads = 0;
    try {
      writeCurrent(win64);
      fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), BUILT.otherLoader);
      const seen = { texts: [] };
      const result = await ensureUe4ss(gamePath, yesApi(seen), {
        fetchRelease: async () => jsonResponse({
          assets: publishedAssets("UE4SS_v3.0.1-1183-gcdbc0b66.zip", "https://example.invalid/current.zip"),
        }),
        download: (url) => {
          downloads += 1;
          assert.equal(url, "https://example.invalid/current.zip");
          return experimentalZip(gamePath);
        },
        cleanupDownload: true,
      });
      assert.equal(downloads, 1);
      assert.equal(result.id, "stale");
      assert.ok(seen.texts[0].includes(LABEL));
      assert.equal(fs.readFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), "utf8"), BUILT.loader);
      assert.equal(fs.readFileSync(path.join(win64, "dwmapi.dll"), "utf8"), BUILT.proxy);
      const label = await readInstalledBuildLabel(gamePath, {
        fetchRelease: async () => jsonResponse({
          assets: publishedAssets("UE4SS_v3.0.1-1183-gcdbc0b66.zip", "https://example.invalid/current.zip"),
        }),
        download: () => {
          downloads += 1;
          throw new Error("second download");
        },
      });
      assert.equal(label, "experimental " + LABEL);
      assert.equal(downloads, 1);
    } finally {
      clearPublishedBuild();
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("downloads again when experimental-latest lists a new zip name", async () => {
    const { gamePath, win64 } = gameTree();
    let downloads = 0;
    let name = "UE4SS_v3.0.1-1183-gcdbc0b66.zip";
    try {
      writeCurrent(win64);
      const fetchRelease = async () => jsonResponse({
        assets: publishedAssets(name, "https://example.invalid/current.zip"),
      });
      const download = () => {
        downloads += 1;
        return experimentalZip(gamePath);
      };
      const first = await ensureUe4ss(gamePath, {
        showDialog: () => { throw new Error("asked"); },
      }, { fetchRelease, download, cleanupDownload: true });
      assert.equal(first.id, "current");
      assert.equal(downloads, 1);
      name = "UE4SS_v3.0.1-1184-gdeadbeef.zip";
      const second = await ensureUe4ss(gamePath, {
        showDialog: () => { throw new Error("asked"); },
      }, { fetchRelease, download, cleanupDownload: true });
      assert.equal(second.id, "current");
      assert.equal(downloads, 2);
    } finally {
      clearPublishedBuild();
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });

  it("reports an unrecognized build when the disk hashes differ from the published zip", async () => {
    const { gamePath, win64 } = gameTree();
    try {
      writeCurrent(win64);
      fs.writeFileSync(path.join(win64, "ue4ss", "UE4SS.dll"), BUILT.otherLoader);
      const label = await readInstalledBuildLabel(gamePath, {
        fetchRelease: async () => jsonResponse({
          assets: publishedAssets("UE4SS_v3.0.1-1183-gcdbc0b66.zip", "https://example.invalid/current.zip"),
        }),
        download: () => experimentalZip(gamePath),
      });
      assert.equal(label, "unrecognized build");
    } finally {
      clearPublishedBuild();
      fs.rmSync(gamePath, { recursive: true, force: true });
    }
  });
});
