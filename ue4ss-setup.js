// Identify the UE4SS files under Binaries\Win64 and offer the fix for that
// case. The current build is the UE4SS_v3.0.1 zip on the experimental-latest
// release. The asset name is the label. dwmapi.dll and ue4ss/UE4SS.dll inside
// that zip are the hashes for this run. mods.txt, the settings ini, and
// installed mod folders stay. Binaries\Win64\Mods stays.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const RELEASES_API_URL =
  "https://api.github.com/repos/UE4SS-RE/RE-UE4SS/releases/tags/experimental-latest";
const EXPERIMENTAL_ASSET = /^UE4SS_v3\.0\.1-.+\.zip$/i;
const PROXY_NAME = "dwmapi.dll";
const LOADER_NAME = "UE4SS.dll";
const UE4SS_DIR = "ue4ss";
const RELEASE_PROXY_SHA256 = "ce596412befa68c30b7f88f65beb77d9bdad55e9b96a276a5a9cf690c63f24bb";
const RELEASE_LOADER_SHA256 = "8ac18fbffc1ef96b0662d4a2d537b3f224c26d65caaba7989a9404c566102b26";
const KEPT_FILES = [
  [UE4SS_DIR, "UE4SS-settings.ini"],
  [UE4SS_DIR, "Mods", "mods.txt"],
];

// Same asset name reuses the hashes already read in this process.
let publishedCache = null;

function win64Dir(gamePath) {
  return path.join(gamePath, "Permafrost", "Binaries", "Win64");
}

function sameHash(left, right) {
  return Boolean(left) && Boolean(right) && left.toLowerCase() === right.toLowerCase();
}

function identityOf(hash, current, release) {
  if (!hash) return "missing";
  if (sameHash(hash, current)) return "current";
  if (sameHash(hash, release)) return "release";
  return "other";
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (!fs.statSync(filePath).isFile()) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildName(label) {
  return label ? "experimental " + label : "experimental UE4SS";
}

function diagnosisText(id, fixes, label) {
  if (id === "current") return "";
  const build = buildName(label);
  const leads = {
    missing: build + " is not installed.",
    "release-flat": "UE4SS 3.0.1 is installed beside the exe.",
    "release-nested": "UE4SS 3.0.1 is inside Binaries\\Win64\\ue4ss.",
    stale: "The UE4SS loader inside Binaries\\Win64\\ue4ss is not " + build + ".",
    "flat-layout": "A UE4SS.dll beside the exe is the old layout.",
    "leftover-flat": build + " is installed, and a second UE4SS.dll is still beside the exe.",
    incomplete: build + " is incomplete.",
  };
  const actions = [];
  if (id === "leftover-flat") actions.push("Remove that extra loader");
  else if (fixes.replaceLoader) actions.push("Replace the loader inside ue4ss with " + build);
  else actions.push("Install " + build + " into Binaries\\Win64\\ue4ss");
  if (fixes.deleteFlatLoader && id !== "leftover-flat") actions.push("remove the UE4SS.dll beside the exe");
  if (fixes.replaceProxy && id !== "missing") actions.push("replace the proxy beside the exe");
  const question = actions[0] + (actions.length > 1 ? ", and " + actions.slice(1).join(", and ") : "");
  const reinstall = id === "release-flat" || id === "flat-layout"
    ? " Reinstall script mods so they deploy under ue4ss\\Mods."
    : "";
  return leads[id] + " " + question +
    "? mods.txt, the settings ini, and installed mod folders stay. Binaries\\Win64\\Mods stays." +
    reinstall + " Quit Permafrost first.";
}

// snapshot identities are "missing", "current", "release", or "other".
function diagnose(snapshot, label) {
  const proxy = snapshot.proxy;
  const loader = snapshot.loader;
  const flat = snapshot.flat;
  const gaps = snapshot.gaps ? snapshot.gaps.slice() : [];
  let id = "incomplete";
  if (loader === "release") id = "release-nested";
  else if (loader === "other") id = "stale";
  else if (loader === "missing" && (flat === "release" || proxy === "release")) id = "release-flat";
  else if (loader === "missing" && flat !== "missing") id = "flat-layout";
  else if (loader === "missing" && proxy === "missing") id = "missing";
  else if (loader === "current" && proxy === "current" && gaps.length === 0 && flat !== "missing") id = "leftover-flat";
  else if (loader === "current" && proxy === "current" && gaps.length === 0) id = "current";

  const fixes = {
    replaceProxy: false,
    replaceLoader: false,
    deleteFlatLoader: false,
    extractMissing: false,
  };
  if (id !== "current") {
    fixes.replaceProxy = proxy !== "current";
    fixes.replaceLoader = loader === "release" || loader === "other";
    fixes.deleteFlatLoader = flat !== "missing";
    if (id === "leftover-flat") {
      fixes.replaceProxy = false;
      fixes.replaceLoader = false;
      fixes.extractMissing = false;
    } else {
      fixes.extractMissing = fixes.replaceProxy || fixes.replaceLoader || loader === "missing" || gaps.length > 0;
    }
  }
  return { id, fixes, gaps, proxy, loader, flat, text: diagnosisText(id, fixes, label) };
}

// The loader inside ue4ss is the build the experimental proxy runs. A flat
// loader is named only when it is a different build, or the only loader.
function installedBuildLabel(snapshot, label) {
  const named = (kind) => {
    if (kind === "current") return buildName(label);
    if (kind === "release") return "3.0.1";
    if (kind === "other") return "unrecognized build";
    return "";
  };
  const nested = named(snapshot.loader);
  const flat = named(snapshot.flat);
  if (nested && flat && snapshot.loader !== snapshot.flat) return nested + ", plus " + flat + " beside the exe";
  if (nested) return nested;
  if (flat) return flat + " beside the exe";
  return "not installed";
}

function inspectLayout(gamePath, identities, label) {
  const ids = identities || {
    currentProxy: null,
    currentLoader: null,
    releaseProxy: RELEASE_PROXY_SHA256,
    releaseLoader: RELEASE_LOADER_SHA256,
  };
  const root = win64Dir(gamePath);
  const gaps = [];
  for (const parts of KEPT_FILES) {
    const file = path.join(root, ...parts);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) gaps.push(parts.join("/"));
  }
  return diagnose({
    proxy: identityOf(sha256File(path.join(root, PROXY_NAME)), ids.currentProxy, ids.releaseProxy),
    loader: identityOf(
      sha256File(path.join(root, UE4SS_DIR, LOADER_NAME)),
      ids.currentLoader,
      ids.releaseLoader,
    ),
    flat: identityOf(sha256File(path.join(root, LOADER_NAME)), ids.currentLoader, ids.releaseLoader),
    gaps,
  }, label);
}

// The experimental zip already stores dwmapi.dll at the root and every
// other file under ue4ss/. A root UE4SS.dll is the 3.0.1 loader, so it is
// not extracted.
function destinationParts(entryName) {
  const norm = String(entryName).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.endsWith("/")) return null;
  const parts = norm.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === "..")) return null;
  if (parts.length === 1 && parts[0].toLowerCase() === PROXY_NAME) return [PROXY_NAME];
  if (parts.length === 1 && parts[0].toLowerCase() === LOADER_NAME.toLowerCase()) return null;
  return parts;
}

function findEocd(buffer) {
  const sig = 0x06054b50;
  const start = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === sig) return i;
  }
  return -1;
}

function listZip(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("UE4SS archive is not a zip file.");
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("UE4SS archive has a broken central directory.");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLen);
    entries.push({ name, method, compSize, localOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryBytes(buffer, entry) {
  const local = entry.localOffset;
  if (buffer.readUInt32LE(local) !== 0x04034b50) {
    throw new Error("UE4SS archive has a broken file header for " + entry.name);
  }
  const nameLen = buffer.readUInt16LE(local + 26);
  const extraLen = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLen + extraLen;
  const compressed = buffer.subarray(start, start + entry.compSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error("UE4SS archive uses an unsupported compression method.");
}

// Write files from the archive that are not already on disk.
function extractMissing(zipPath, win64) {
  const buffer = fs.readFileSync(zipPath);
  const root = path.resolve(win64);
  const rootKey = (root + path.sep).toLowerCase();
  const written = [];
  const skipped = [];
  for (const entry of listZip(buffer)) {
    const parts = destinationParts(entry.name);
    if (!parts) continue;
    const dest = path.resolve(win64, ...parts);
    if (!dest.toLowerCase().startsWith(rootKey)) continue;
    if (fs.existsSync(dest)) {
      skipped.push(dest);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entryBytes(buffer, entry));
    written.push(dest);
  }
  return { written, skipped };
}

function removeFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
  fs.rmSync(filePath);
  return [filePath];
}

function declined(text) {
  const err = new Error(text || "UE4SS experimental is required before Permafrost can be modded.");
  err.code = "UE4SS_DECLINED";
  return err;
}

// UE4SS_v3.0.1-1183-gcdbc0b66.zip -> 3.0.1-1183-gcdbc0b66.
// A name that starts with zDEV- does not match EXPERIMENTAL_ASSET.
function labelFromAssetName(name) {
  const match = /^UE4SS_v(.+)\.zip$/i.exec(String(name));
  if (!match || !match[1]) throw new Error("UE4SS asset name has no version (" + name + ").");
  return match[1];
}

function pickExperimentalAsset(release) {
  const assets = release && Array.isArray(release.assets) ? release.assets : [];
  const names = [];
  const matches = [];
  for (const asset of assets) {
    const name = asset && typeof asset.name === "string" ? asset.name : "";
    if (name) names.push(name);
    if (name && EXPERIMENTAL_ASSET.test(name)) matches.push(asset);
  }
  if (matches.length !== 1) {
    const found = names.length ? names.join(", ") : "none";
    throw new Error(
      "UE4SS experimental-latest listed " + matches.length +
      " archives named UE4SS_v3.0.1-*.zip (" + found + ").",
    );
  }
  const asset = matches[0];
  const url = typeof asset.browser_download_url === "string" ? asset.browser_download_url.trim() : "";
  if (!url) {
    throw new Error("UE4SS experimental-latest asset has no download URL (" + asset.name + ").");
  }
  return { name: asset.name, url, label: labelFromAssetName(asset.name) };
}

async function fetchExperimentalRelease(fetchImpl) {
  const doFetch = fetchImpl || fetch;
  let response;
  try {
    response = await doFetch(RELEASES_API_URL, {
      headers: {
        "User-Agent": "permafrost-vortex",
        Accept: "application/vnd.github+json",
      },
      redirect: "follow",
    });
  } catch (err) {
    const detail = err && err.message ? err.message : "network";
    throw new Error("UE4SS release lookup failed (" + detail + ").");
  }
  if (!response || response.ok !== true) {
    const status = response && (response.status || response.status === 0) ? response.status : "no response";
    throw new Error("UE4SS release lookup failed (" + status + ").");
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error("UE4SS release lookup returned invalid JSON.");
  }
}

function identitiesFromZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const entries = listZip(buffer);
  let proxy = null;
  let loader = null;
  const loaderKey = (UE4SS_DIR + "/" + LOADER_NAME).toLowerCase();
  for (const entry of entries) {
    const parts = destinationParts(entry.name);
    if (!parts) continue;
    const key = parts.join("/").toLowerCase();
    if (key === PROXY_NAME) proxy = sha256Buffer(entryBytes(buffer, entry));
    else if (key === loaderKey) loader = sha256Buffer(entryBytes(buffer, entry));
  }
  if (!proxy || !loader) {
    throw new Error("UE4SS archive is missing dwmapi.dll or ue4ss/UE4SS.dll.");
  }
  return {
    currentProxy: proxy,
    currentLoader: loader,
    releaseProxy: RELEASE_PROXY_SHA256,
    releaseLoader: RELEASE_LOADER_SHA256,
  };
}

function defaultZipDest() {
  return path.join(
    os.tmpdir(),
    "permafrost-UE4SS-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + ".zip",
  );
}

async function downloadFile(url, dest) {
  const response = await fetch(url, {
    headers: { "User-Agent": "permafrost-vortex", Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error("UE4SS download failed (" + response.status + ").");
  const data = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  return dest;
}

function clearPublishedBuild() {
  publishedCache = null;
}

// Injected identities skip the network. Otherwise the release is read first,
// and a download starts only after exactly one matching asset is chosen.
async function resolvePublishedBuild(options) {
  const opts = options || {};
  if (opts.identities) {
    return {
      identities: {
        currentProxy: opts.identities.currentProxy,
        currentLoader: opts.identities.currentLoader,
        releaseProxy: opts.identities.releaseProxy || RELEASE_PROXY_SHA256,
        releaseLoader: opts.identities.releaseLoader || RELEASE_LOADER_SHA256,
      },
      label: typeof opts.label === "string" ? opts.label : "",
      url: null,
      name: null,
      zipPath: null,
    };
  }
  const release = await fetchExperimentalRelease(opts.fetchRelease);
  const asset = pickExperimentalAsset(release);
  if (publishedCache && publishedCache.name === asset.name && publishedCache.identities) {
    return {
      identities: publishedCache.identities,
      label: asset.label,
      url: asset.url,
      name: asset.name,
      zipPath: null,
    };
  }
  const download = opts.download || ((url) => downloadFile(url, defaultZipDest()));
  const zipPath = await download(asset.url);
  if (!zipPath) throw new Error("UE4SS download returned no file.");
  let identities;
  try {
    identities = identitiesFromZip(zipPath);
  } catch (err) {
    fs.rmSync(zipPath, { force: true });
    throw err;
  }
  publishedCache = { name: asset.name, identities, label: asset.label };
  if (opts.keepDownload) {
    return { identities, label: asset.label, url: asset.url, name: asset.name, zipPath };
  }
  fs.rmSync(zipPath, { force: true });
  return { identities, label: asset.label, url: asset.url, name: asset.name, zipPath: null };
}

async function readInstalledBuildLabel(gamePath, options) {
  const published = await resolvePublishedBuild(options);
  return installedBuildLabel(inspectLayout(gamePath, published.identities), published.label);
}

async function ensureUe4ss(gamePath, api, options) {
  const opts = options || {};
  const published = await resolvePublishedBuild(Object.assign({}, opts, {
    keepDownload: !opts.identities,
  }));
  let zipPath = published.zipPath;
  try {
    const found = inspectLayout(gamePath, published.identities, published.label);
    if (found.id === "current") return { asked: false, id: found.id, removed: [] };
    const result = await api.showDialog("question", "Permafrost", { text: found.text }, [
      { label: "No" },
      { label: "Yes" },
    ]);
    if (!result || result.action !== "Yes") throw declined(found.text);
    const removed = [];
    const root = win64Dir(gamePath);
    if (found.fixes.deleteFlatLoader) removed.push(...removeFile(path.join(root, LOADER_NAME)));
    if (found.fixes.replaceProxy) removed.push(...removeFile(path.join(root, PROXY_NAME)));
    if (found.fixes.replaceLoader) removed.push(...removeFile(path.join(root, UE4SS_DIR, LOADER_NAME)));
    if (found.fixes.extractMissing) {
      if (!zipPath) {
        const download = opts.download || ((url) => downloadFile(url, defaultZipDest()));
        zipPath = await download(published.url);
      }
      extractMissing(zipPath, root);
    }
    const after = inspectLayout(gamePath, published.identities, published.label);
    if (after.id !== "current") {
      throw new Error("UE4SS experimental is still incomplete (" + after.id + ").");
    }
    return { asked: true, id: found.id, removed };
  } finally {
    if (zipPath && opts.cleanupDownload) fs.rmSync(zipPath, { force: true });
  }
}

module.exports = {
  RELEASES_API_URL,
  RELEASE_PROXY_SHA256,
  RELEASE_LOADER_SHA256,
  UE4SS_DIR,
  PROXY_NAME,
  LOADER_NAME,
  win64Dir,
  diagnose,
  installedBuildLabel,
  inspectLayout,
  destinationParts,
  extractMissing,
  labelFromAssetName,
  pickExperimentalAsset,
  identitiesFromZip,
  resolvePublishedBuild,
  readInstalledBuildLabel,
  clearPublishedBuild,
  ensureUe4ss,
  downloadFile,
};
