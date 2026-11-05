// Identify the UE4SS loaders under Binaries\Win64. An experimental ProductVersion
// or directory name is left alone. A missing install, or a stable 3.0.1 loader,
// is offered the pinned 3.0.1-1208 zip. The zip hash is checked before anything
// is deleted or written. Yes refreshes built-in mod files. The settings ini,
// mods.txt, mods.json, and BPModLoaderMod\load_order.txt stay when they exist.
// A player mod folder stays. Binaries\Win64\Mods stays.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const PINNED_URL =
  "https://github.com/paulyusy/UE4SS_v3.0.1-1208-g6f8dc3cc-Experimental/releases/download/UE4SS_v3.0.1-1208-g6f8dc3cc/UE4SS_v3.0.1-1208-g6f8dc3cc.zip";
const PINNED_ZIP_SHA256 = "899b6dbe84539c0b19d5ef08eb3a6e99e2195ebc0706baf24fe5799e3a6888f8";
const PINNED_LABEL = "3.0.1-1208-g6f8dc3cc";
const PROXY_NAME = "dwmapi.dll";
const LOADER_NAME = "UE4SS.dll";
const UE4SS_DIR = "ue4ss";
const RELEASE_PROXY_SHA256 = "ce596412befa68c30b7f88f65beb77d9bdad55e9b96a276a5a9cf690c63f24bb";
const RELEASE_LOADER_SHA256 = "8ac18fbffc1ef96b0662d4a2d537b3f224c26d65caaba7989a9404c566102b26";
const KEPT_FILES = [
  [UE4SS_DIR, "UE4SS-settings.ini"],
  [UE4SS_DIR, "Mods", "mods.txt"],
];
// Relative to Binaries\Win64. An existing file is kept. A missing one is written.
const PRESERVE_KEYS = new Set([
  "ue4ss/ue4ss-settings.ini",
  "ue4ss/mods/mods.txt",
  "ue4ss/mods/mods.json",
  "ue4ss/mods/bpmodloadermod/load_order.txt",
]);
// 3.0.1-1208-gf6f8dc3cc, or the same text inside a folder name.
const EXPERIMENTAL_DESCRIBE = /(\d+\.\d+\.\d+-\d+-g[0-9a-f]{7,})/i;
// ProductVersion on the pinned loader is the bare commit hash.
const BARE_HASH = /^[0-9a-f]{7,40}$/i;
const STABLE_VERSION = /^\d+\.\d+\.\d+(\.\d+)?$/;
const PRODUCT_VERSION_KEY = Buffer.from("ProductVersion\0", "utf16le");

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
    "? Built-in mod files are refreshed. UE4SS-settings.ini, mods.txt, mods.json, and BPModLoaderMod\\load_order.txt stay when they exist. A player mod folder stays. Binaries\\Win64\\Mods stays." +
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

function readUtf16(buffer, offset) {
  if (offset < 0 || offset + 1 >= buffer.length) return "";
  let out = "";
  for (let i = offset; i + 1 < buffer.length && out.length < 80; i += 2) {
    const code = buffer.readUInt16LE(i);
    if (code === 0) return out;
    if (code < 32 || code > 126) return "";
    out += String.fromCharCode(code);
  }
  return "";
}

// A version-resource String has a 6-byte header before ProductVersion: length,
// value length in WORDs, and type 1. An empty value is skipped. A test file
// that only concatenates the key and the value is read directly.
function versionAt(buffer, at) {
  if (at >= 6) {
    const valueWords = buffer.readUInt16LE(at - 4);
    const type = buffer.readUInt16LE(at - 2);
    if (type === 1 && valueWords <= 64) {
      if (valueWords === 0) return "";
      const structStart = at - 6;
      const base = at + PRODUCT_VERSION_KEY.length;
      const misalign = (base - structStart) % 4;
      const pad = misalign === 0 ? 0 : 4 - misalign;
      const start = base + pad;
      const end = Math.min(buffer.length, start + valueWords * 2);
      return versionText(readUtf16(buffer.subarray(start, end), 0));
    }
  }
  for (let pad = 0; pad <= 3; pad++) {
    const value = versionText(readUtf16(buffer, at + PRODUCT_VERSION_KEY.length + pad));
    if (value) return value;
  }
  return "";
}

function readProductVersion(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PRODUCT_VERSION_KEY.length) return "";
  let from = 0;
  while (from <= buffer.length - PRODUCT_VERSION_KEY.length) {
    const at = buffer.indexOf(PRODUCT_VERSION_KEY, from);
    if (at < 0) return "";
    const value = versionAt(buffer, at);
    if (value) return value;
    from = at + 2;
  }
  return "";
}

function versionText(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80) return "";
  if (experimentalToken(text) || isStableVersion(text) || text === "0.0.0.0") return text;
  return "";
}

function experimentalToken(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  const described = EXPERIMENTAL_DESCRIBE.exec(value);
  if (described) return described[1];
  if (BARE_HASH.test(value)) return value;
  return null;
}

function isStableVersion(text) {
  const value = String(text || "").trim();
  if (!value || value === "0.0.0.0") return false;
  return STABLE_VERSION.test(value);
}

function isReleaseHash(hash) {
  return sameHash(hash, RELEASE_LOADER_SHA256) || sameHash(hash, RELEASE_PROXY_SHA256);
}

function classifyOne(loader) {
  if (!loader || loader.present !== true) return "absent";
  const signals = [];
  if (loader.productVersion) signals.push(loader.productVersion);
  const names = Array.isArray(loader.dirNames) ? loader.dirNames : [];
  for (const name of names) signals.push(name);
  for (const signal of signals) {
    if (experimentalToken(signal)) return "experimental";
  }
  if (isStableVersion(loader.productVersion) || isReleaseHash(loader.hash)) return "stable";
  return "other";
}

function tokenFromLoader(loader) {
  if (!loader || loader.present !== true) return null;
  const fromVersion = experimentalToken(loader.productVersion);
  if (fromVersion) return fromVersion;
  const names = Array.isArray(loader.dirNames) ? loader.dirNames : [];
  for (const name of names) {
    const token = experimentalToken(name);
    if (token) return token;
  }
  return null;
}

// Experimental wins, including over a leftover stable loader. Anything that
// is neither experimental nor stable is left alone. The proxy is not a loader.
function classifyLoaders(input) {
  const found = input || {};
  const nested = classifyOne(found.nested);
  const flat = classifyOne(found.flat);
  const present = [];
  if (nested !== "absent") present.push(nested);
  if (flat !== "absent") present.push(flat);
  if (present.some((kind) => kind === "experimental")) {
    return {
      action: "quiet",
      id: "experimental",
      token: tokenFromLoader(found.nested) || tokenFromLoader(found.flat),
      nested,
      flat,
    };
  }
  if (present.length === 0) {
    return { action: "ask", id: "missing", token: null, nested, flat };
  }
  if (present.every((kind) => kind === "stable")) {
    return {
      action: "ask",
      id: nested === "stable" ? "release-nested" : "release-flat",
      token: null,
      nested,
      flat,
    };
  }
  return { action: "quiet", id: "other", token: null, nested, flat };
}

function dirNamesWithin(gamePath, filePath) {
  const root = path.resolve(gamePath);
  const rel = path.relative(root, path.dirname(path.resolve(filePath)));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return [];
  return rel.split(path.sep).filter((part) => part && part !== ".");
}

function emptyLoader() {
  return { present: false, productVersion: "", dirNames: [], hash: null };
}

function describeLoader(gamePath, filePath) {
  if (!fs.existsSync(filePath)) return emptyLoader();
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return emptyLoader();
    throw err;
  }
  if (!stat.isFile()) return emptyLoader();
  const body = fs.readFileSync(filePath);
  return {
    present: true,
    productVersion: readProductVersion(body),
    dirNames: dirNamesWithin(gamePath, filePath),
    hash: sha256Buffer(body),
  };
}

// Hashes the loader only so an empty version resource can still match 3.0.1.
// dwmapi.dll is ignored. Its ProductVersion is 0.0.0.0.
function readLoaders(gamePath) {
  const root = win64Dir(gamePath);
  return {
    nested: describeLoader(gamePath, path.join(root, UE4SS_DIR, LOADER_NAME)),
    flat: describeLoader(gamePath, path.join(root, LOADER_NAME)),
  };
}

function displayToken(token) {
  return String(token || "").replace(/^UE4SS_v/i, "");
}

function formatBuildLabel(found) {
  if (found.id === "experimental") {
    const token = displayToken(found.token);
    return token ? "experimental " + token : "experimental";
  }
  if (found.id === "missing") return "not installed";
  if (found.id === "release-flat") return "3.0.1 beside the exe";
  if (found.id === "release-nested" && found.flat === "stable") {
    return "3.0.1, plus 3.0.1 beside the exe";
  }
  if (found.id === "release-nested") return "3.0.1";
  return "unrecognized build";
}

function readInstalledBuildLabel(gamePath, options) {
  const opts = options || {};
  return formatBuildLabel(classifyLoaders(opts.loaders || readLoaders(gamePath)));
}

function productVersionInZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const loaderKey = (UE4SS_DIR + "/" + LOADER_NAME).toLowerCase();
  for (const entry of listZip(buffer)) {
    const parts = destinationParts(entry.name);
    if (!parts) continue;
    if (parts.join("/").toLowerCase() !== loaderKey) continue;
    return readProductVersion(entryBytes(buffer, entry));
  }
  return "";
}

// Overwrite zip files. The four saved files stay when they already exist.
// A file inside a mod folder the zip contains is removed when the zip no
// longer has it. A player folder the zip does not contain is not walked.
function extractPinned(zipPath, win64) {
  const buffer = fs.readFileSync(zipPath);
  const root = path.resolve(win64);
  const rootKey = (root + path.sep).toLowerCase();
  const zipKeys = new Set();
  const builtinFolders = new Set();
  const planned = [];
  for (const entry of listZip(buffer)) {
    const parts = destinationParts(entry.name);
    if (!parts) continue;
    const key = parts.join("/").toLowerCase();
    zipKeys.add(key);
    if (
      parts.length >= 4 &&
      parts[0].toLowerCase() === UE4SS_DIR &&
      parts[1].toLowerCase() === "mods"
    ) {
      builtinFolders.add(parts[2]);
    }
    planned.push({ entry, parts, key });
  }
  const written = [];
  const skipped = [];
  for (const item of planned) {
    const dest = path.resolve(win64, ...item.parts);
    if (!dest.toLowerCase().startsWith(rootKey)) continue;
    const exists = fs.existsSync(dest) && fs.statSync(dest).isFile();
    if (PRESERVE_KEYS.has(item.key) && exists) {
      skipped.push(dest);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entryBytes(buffer, item.entry));
    written.push(dest);
  }
  const removed = [];
  for (const folder of builtinFolders) {
    const dir = path.join(root, UE4SS_DIR, "Mods", folder);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      let children = [];
      try {
        children = fs.readdirSync(current, { withFileTypes: true });
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) continue;
        throw err;
      }
      for (const child of children) {
        const full = path.join(current, child.name);
        if (child.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!child.isFile()) continue;
        const rel = path.relative(root, full).split(path.sep).join("/").toLowerCase();
        if (!rel || rel.startsWith("..")) continue;
        if (PRESERVE_KEYS.has(rel) || zipKeys.has(rel)) continue;
        fs.rmSync(full, { force: true });
        removed.push(full);
      }
    }
  }
  return { written, skipped, removed };
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

function offerSnapshot(found) {
  if (found.id === "missing") {
    return { proxy: "missing", loader: "missing", flat: "missing", gaps: [] };
  }
  if (found.id === "release-flat") {
    return { proxy: "release", loader: "missing", flat: "release", gaps: [] };
  }
  return {
    proxy: "release",
    loader: "release",
    flat: found.flat === "stable" ? "release" : "missing",
    gaps: [],
  };
}

async function ensureUe4ss(gamePath, api, options) {
  const opts = options || {};
  const found = classifyLoaders(opts.loaders || readLoaders(gamePath));
  if (found.action === "quiet") return { asked: false, id: found.id, removed: [] };
  const offer = diagnose(offerSnapshot(found), PINNED_LABEL);
  const result = await api.showDialog("question", "Permafrost", { text: offer.text }, [
    { label: "No" },
    { label: "Yes" },
  ]);
  if (!result || result.action !== "Yes") {
    if (found.id === "missing") throw declined(offer.text);
    return { asked: true, declined: true, id: found.id, removed: [] };
  }
  const download = opts.download || ((url) => downloadFile(url, defaultZipDest()));
  let zipPath = null;
  try {
    zipPath = await download(PINNED_URL);
    if (!zipPath) throw new Error("UE4SS download returned no file.");
    const actual = sha256File(zipPath);
    const expected = String(opts.zipSha256 || PINNED_ZIP_SHA256).toLowerCase();
    if (!actual || actual.toLowerCase() !== expected) {
      fs.rmSync(zipPath, { force: true });
      zipPath = null;
      throw new Error("UE4SS download hash did not match the pinned build.");
    }
    const root = win64Dir(gamePath);
    const removed = removeFile(path.join(root, LOADER_NAME));
    extractPinned(zipPath, root);
    const proxyPath = path.join(root, PROXY_NAME);
    const loaderPath = path.join(root, UE4SS_DIR, LOADER_NAME);
    if (!fs.existsSync(proxyPath) || !fs.existsSync(loaderPath)) {
      throw new Error("UE4SS experimental is still incomplete.");
    }
    return { asked: true, id: found.id, removed };
  } finally {
    if (zipPath && opts.cleanupDownload) fs.rmSync(zipPath, { force: true });
  }
}

module.exports = {
  PINNED_URL,
  PINNED_ZIP_SHA256,
  PINNED_LABEL,
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
  extractPinned,
  identitiesFromZip,
  readProductVersion,
  experimentalToken,
  classifyLoaders,
  readLoaders,
  readInstalledBuildLabel,
  productVersionInZip,
  ensureUe4ss,
  downloadFile,
};
