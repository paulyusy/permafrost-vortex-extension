// Archive layout detection and install instructions. Vortex is not required.
// A mixed archive cannot be handed to two Vortex installers, so the script
// installer calls the pak installer and rebases both results onto one mod.

const fs = require("fs");
const path = require("path");
const { isBuiltin, updateModsTxt } = require("./mods-txt");
const { blockedBinaryMessage, prepareModLoader, MODLOADER_ID } = require("./modloader");

const GAME_ID = "permafrost";
const SCRIPTS_ID = "permafrost-scripts";
const PAK_ID = "permafrost-pak";
const LOGIC_ID = "permafrost-logicmods";
const MIXED_ID = "permafrost-mixed";

const PROJECT = "Permafrost";
// Experimental UE4SS loads UE4SS.dll from Win64\ue4ss and reads Mods there.
const MODS_IN_PROJECT = path.join("Binaries", "Win64", "ue4ss", "Mods");
const MODS_REL = path.join(PROJECT, MODS_IN_PROJECT);
const PAKS_REL = path.join(PROJECT, "Content", "Paks");
const LOGIC_REL = path.join(PAKS_REL, "LogicMods");
const PAKS_DIR = path.join("Content", "Paks");
const LOGIC_DIR = path.join("Content", "Paks", "LogicMods");

const SHIPPING = new Set([
  "permafrost-windows.pak",
  "permafrost-windows.ucas",
  "permafrost-windows.utoc",
  "global.ucas",
  "global.utoc",
]);

const CONTAINER_EXT = new Set([".pak", ".ucas", ".utoc"]);
const ARCHIVE_EXT = new Set([".zip", ".7z", ".rar"]);
const LOOSE_TEXT_EXT = new Set([".txt", ".md"]);
const MARKER_DIRS = new Set(["scripts", "dlls", "logicmods"]);

function normalize(file) {
  return String(file).replace(/\\/g, "/").replace(/^\.\//, "");
}

function isDirEntry(file) {
  const norm = normalize(file);
  return norm.endsWith("/") || norm.endsWith("\\") || norm === "";
}

function basename(file) {
  const norm = normalize(file).replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function extname(file) {
  const base = basename(file);
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx).toLowerCase();
}

function isShippingName(name) {
  return SHIPPING.has(String(name).toLowerCase());
}

function isLooseText(file) {
  const base = basename(file);
  if (!base || base === "." || base === "..") return false;
  const ext = extname(file);
  return ext === "" || LOOSE_TEXT_EXT.has(ext);
}

function isFomod(files) {
  return files.some((file) => {
    if (isDirEntry(file)) return false;
    if (basename(file).toLowerCase() !== "moduleconfig.xml") return false;
    const norm = normalize(file);
    const parent = norm.slice(0, norm.lastIndexOf("/"));
    return basename(parent).toLowerCase() === "fomod";
  });
}

function archiveBase(fileName) {
  const base = basename(fileName || "Mod");
  return (
    base
      .replace(/(\.installing)+$/i, "")
      .replace(/\.(zip|rar|7z)$/i, "")
      .trim() || "Mod"
  );
}

function partsOf(file) {
  return normalize(file).replace(/\/+$/, "").split("/").filter(Boolean);
}

// The mod root is the single top-level folder, unless that folder is itself
// Scripts, dlls, or LogicMods. Otherwise the archive root is the mod root.
function modRootPrefix(files) {
  const tops = new Set();
  for (const file of files) {
    const parts = partsOf(file);
    if (parts.length === 0) continue;
    tops.add(parts[0]);
  }
  const dirs = [];
  for (const top of tops) {
    const asFile = files.some((file) => !isDirEntry(file) && partsOf(file).length === 1 && partsOf(file)[0] === top);
    const asDir = files.some((file) => partsOf(file)[0] === top && (isDirEntry(file) || partsOf(file).length > 1));
    if (asDir && !asFile) dirs.push(top);
  }
  if (dirs.length === 1 && !MARKER_DIRS.has(dirs[0].toLowerCase())) return dirs[0];
  return "";
}

function findAnchor(files) {
  let dlls = null;
  for (const file of files) {
    if (isDirEntry(file)) continue;
    const parts = partsOf(file);
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i].toLowerCase();
      const base = parts[parts.length - 1].toLowerCase();
      if (seg === "scripts" && base === "main.lua") {
        return { index: i, parts, kind: "scripts" };
      }
      if (seg === "dlls" && base === "main.dll" && !dlls) {
        dlls = { index: i, parts, kind: "dlls" };
      }
    }
  }
  return dlls;
}

function underPrefix(parts, prefixParts) {
  if (prefixParts.length > parts.length) return false;
  for (let i = 0; i < prefixParts.length; i++) {
    if (parts[i] !== prefixParts[i]) return false;
  }
  return true;
}

function hasLogicSegment(parts) {
  return parts.some((seg) => seg.toLowerCase() === "logicmods");
}

function classify(files, fileName) {
  const list = files || [];
  const anchor = findAnchor(list);
  const rootPrefix = modRootPrefix(list);
  const rootParts = rootPrefix ? [rootPrefix] : [];
  const anchorPrefix = anchor ? anchor.parts.slice(0, anchor.index) : [];
  const folderName = anchor
    ? anchor.index === 0
      ? archiveBase(fileName)
      : anchor.parts[anchor.index - 1]
    : rootPrefix || archiveBase(fileName);

  const scriptFiles = [];
  const pakEntries = [];
  const rejectedShipping = [];
  let hasContainer = false;
  let hasLooseText = false;
  let hasLogic = false;
  let sawArchive = false;
  const blockedBinaries = [];

  for (const file of list) {
    if (isDirEntry(file)) continue;
    const parts = partsOf(file);
    if (parts.length === 0) continue;
    const name = parts[parts.length - 1];
    const ext = extname(name);
    if (CONTAINER_EXT.has(ext)) hasContainer = true;
    if (ARCHIVE_EXT.has(ext)) {
      sawArchive = true;
      continue;
    }
    if (isShippingName(name)) {
      rejectedShipping.push(file);
      continue;
    }
    if (hasLogicSegment(parts) && CONTAINER_EXT.has(ext)) hasLogic = true;

    const inAnchorTree =
      anchor &&
      underPrefix(parts, anchor.parts.slice(0, anchor.index + 1)) &&
      parts.length > anchor.index + 1;
    const inModFolder = anchor && underPrefix(parts, anchorPrefix.length ? anchorPrefix : rootParts);
    const atModRoot =
      parts.length === rootParts.length + 1 && underPrefix(parts, rootParts);

    if (inAnchorTree) {
      if (name.toLowerCase() === "enabled.txt" || name.toLowerCase() === "mods.txt") continue;
      // UE4SS loads Mods\<ModName>\Scripts\main.lua and Mods\<ModName>\dlls\main.dll.
      const relParts = parts.slice(anchor.index);
      if (relParts.length === 0) continue;
      scriptFiles.push({ source: file, rel: relParts.join("/") });
      continue;
    }

    // A DLL inside the mod folder that owns the anchor stays with that UE4SS mod.
    // dlls\main.dll beside Scripts\main.lua is that case. A binary outside the folder is not.
    if ((ext === ".dll" || ext === ".exe") && !(anchor && inModFolder)) {
      blockedBinaries.push(name);
      continue;
    }

    if (hasLogicSegment(parts)) {
      pakEntries.push({ source: file, dir: LOGIC_DIR, name });
      continue;
    }

    if (CONTAINER_EXT.has(ext)) {
      pakEntries.push({ source: file, dir: PAKS_DIR, name });
      continue;
    }

    if (atModRoot && isLooseText(name)) {
      hasLooseText = true;
      pakEntries.push({ source: file, dir: PAKS_DIR, name });
      continue;
    }

    if (anchor && (anchorPrefix.length === 0 || inModFolder)) {
      if (name.toLowerCase() === "enabled.txt" || name.toLowerCase() === "mods.txt") continue;
      const relParts = anchorPrefix.length ? parts.slice(anchorPrefix.length) : parts;
      if (relParts.length === 0) continue;
      scriptFiles.push({ source: file, rel: relParts.join("/") });
      continue;
    }
  }

  const realFiles = list.filter((file) => !isDirEntry(file));
  const onlyShipping =
    rejectedShipping.length > 0 &&
    scriptFiles.length === 0 &&
    pakEntries.length === 0 &&
    realFiles.every((file) => isShippingName(basename(file)) || ARCHIVE_EXT.has(extname(file)));
  const onlyArchive =
    sawArchive && scriptFiles.length === 0 && pakEntries.length === 0 && rejectedShipping.length === 0;

  return {
    isFomod: isFomod(list),
    hasScripts: !!anchor && scriptFiles.length > 0,
    hasLogic,
    hasContainer,
    hasLooseText,
    hasPakLike: hasContainer || rejectedShipping.length > 0,
    folderName,
    scriptFiles,
    pakEntries,
    rejectedShipping,
    blockedBinaries,
    onlyShipping,
    onlyArchive,
  };
}

function dedupePakEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = path.normalize(entry.dir).toLowerCase() + "|" + entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function pakAttribute(entries) {
  return {
    type: "attribute",
    key: "pakFiles",
    value: entries.map((entry) => ({ dir: entry.dir, name: entry.name })),
  };
}

function scriptDestination(folderName, rel) {
  return path.join(folderName, ...rel.split("/"));
}

function render(plan, includeScripts) {
  const entries = dedupePakEntries(plan.pakEntries);
  const useScripts = includeScripts && plan.scriptFiles.length > 0;
  const dirs = new Set(entries.map((entry) => path.normalize(entry.dir).toLowerCase()));
  const multi =
    (useScripts && entries.length > 0) ||
    dirs.size > 1;
  const instructions = [];

  if (useScripts) {
    for (const file of plan.scriptFiles) {
      const relative = scriptDestination(plan.folderName, file.rel);
      instructions.push({
        type: "copy",
        source: file.source,
        destination: multi ? path.join(MODS_REL, relative) : relative,
      });
    }
  }
  for (const entry of entries) {
    let destination;
    if (multi) {
      destination =
        path.normalize(entry.dir).toLowerCase() === path.normalize(LOGIC_DIR).toLowerCase()
          ? path.join(LOGIC_REL, entry.name)
          : path.join(PAKS_REL, entry.name);
    } else if (path.normalize(entry.dir).toLowerCase() === path.normalize(LOGIC_DIR).toLowerCase()) {
      destination = entry.name;
    } else {
      destination = entry.name;
    }
    instructions.push({ type: "copy", source: entry.source, destination });
  }

  let modType = PAK_ID;
  if (multi) modType = MIXED_ID;
  else if (useScripts) modType = SCRIPTS_ID;
  else if (dirs.size === 1 && [...dirs][0] === path.normalize(LOGIC_DIR).toLowerCase()) modType = LOGIC_ID;

  instructions.push({ type: "setmodtype", value: modType });
  if (useScripts) {
    instructions.push({ type: "attribute", key: "ue4ssModFolder", value: plan.folderName });
  }
  if (entries.length > 0) instructions.push(pakAttribute(entries));
  return { instructions };
}

function rejectMessage(plan) {
  if (plan.blockedBinaries && plan.blockedBinaries.length > 0) {
    return blockedBinaryMessage(plan.blockedBinaries);
  }
  if (plan.onlyShipping) {
    return "This archive only contains Permafrost's own pak files (Permafrost-Windows or global). Those files were not installed.";
  }
  if (plan.onlyArchive) {
    return "This archive only contains another archive. Extract the mod and install that folder.";
  }
  return "Nothing in this archive can be installed. Shipping containers are left untouched, and a nested archive is not deployed.";
}

function installPak(files, fileName) {
  const plan = classify(files, fileName);
  if (plan.isFomod) {
    return Promise.reject(new Error("FOMOD archives are not installed by the Permafrost pak installer."));
  }
  if (plan.blockedBinaries.length > 0) {
    return Promise.reject(new Error(blockedBinaryMessage(plan.blockedBinaries)));
  }
  if (plan.pakEntries.length === 0) {
    return Promise.reject(new Error(rejectMessage(plan)));
  }
  return Promise.resolve(render(plan, false));
}

function installScripts(files, fileName) {
  const plan = classify(files, fileName);
  if (!plan.hasScripts) {
    return Promise.reject(new Error("No Scripts\\main.lua or dlls\\main.dll folder was found."));
  }
  if (plan.blockedBinaries.length > 0) {
    return Promise.reject(new Error(blockedBinaryMessage(plan.blockedBinaries)));
  }
  // Vortex runs only this installer for a mixed archive. Claim the pak side too.
  return installPak(files, fileName).then(
    () => render(plan, true),
    (err) => {
      if (plan.pakEntries.length === 0) return render(plan, true);
      throw err;
    },
  );
}

function installLogic(files, fileName) {
  const plan = classify(files, fileName);
  if (!plan.hasLogic) {
    return Promise.reject(new Error("No LogicMods pak was found."));
  }
  return installPak(files, fileName);
}

function testResult(supported) {
  return Promise.resolve({ supported: !!supported, requiredFiles: [] });
}

function testScripts(files, gameId) {
  const plan = classify(files);
  return testResult(gameId === GAME_ID && plan.hasScripts && !plan.isFomod);
}

function testPak(files, gameId) {
  const plan = classify(files);
  const supported =
    gameId === GAME_ID &&
    !plan.isFomod &&
    (plan.hasPakLike || plan.hasLooseText);
  return testResult(supported);
}

function testLogic(files, gameId) {
  const plan = classify(files);
  return testResult(gameId === GAME_ID && plan.hasLogic && !plan.isFomod);
}

function testReject(files, gameId) {
  if (gameId !== GAME_ID) return testResult(false);
  const plan = classify(files);
  if (plan.isFomod) return testResult(false);
  const claimed = plan.hasScripts || plan.hasLogic || plan.hasPakLike || plan.hasLooseText || plan.pakEntries.length > 0;
  return testResult(!claimed);
}

function installReject(files, fileName) {
  const plan = classify(files, fileName);
  return Promise.reject(new Error(rejectMessage(plan)));
}

function isSafeSegment(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/]/.test(name) &&
    !isBuiltin(name) &&
    name.toLowerCase() !== "shared"
  );
}

function isAllowedPakDir(dir) {
  const norm = path.normalize(String(dir || "")).toLowerCase();
  return (
    norm === path.normalize(PAKS_DIR).toLowerCase() ||
    norm === path.normalize(LOGIC_DIR).toLowerCase()
  );
}

function fileParts(name) {
  if (typeof name !== "string" || !isSafeSegment(name) || isShippingName(name)) return null;
  const ext = path.extname(name);
  const lower = ext.toLowerCase();
  if (!CONTAINER_EXT.has(lower) && !isLooseText(name)) return null;
  const stem = ext ? name.slice(0, name.length - ext.length) : name;
  if (!stem) return null;
  return { stem, ext };
}

function pakOwnerKey(dir, name) {
  if (!fileParts(name) || !CONTAINER_EXT.has(path.extname(name).toLowerCase())) return null;
  if (!isAllowedPakDir(dir)) return null;
  return path.normalize(dir).toLowerCase() + "|" + name.toLowerCase();
}

// Pak, ucas, utoc, and loose text. Shipping names are excluded.
function claimedFileKey(dir, name) {
  if (!fileParts(name) || !isAllowedPakDir(dir)) return null;
  return path.normalize(dir).toLowerCase() + "|" + name.toLowerCase();
}

// Names and script folders recorded by any mod except modId.
// Removing a new mod must not delete the installed mod's copies of those names.
function claimsHeldByOthers(modId, mods) {
  const pakFiles = [];
  const folders = [];
  const seenPak = new Set();
  const seenFolder = new Set();
  const list = mods && typeof mods === "object" ? Object.values(mods) : [];
  for (const mod of list) {
    if (!mod || mod.id === modId) continue;
    const attributes = mod.attributes || mod;
    const folder = attributes.ue4ssModFolder;
    if (typeof folder === "string" && isSafeSegment(folder)) {
      const key = folder.toLowerCase();
      if (!seenFolder.has(key)) {
        seenFolder.add(key);
        folders.push(folder);
      }
    }
    const files = attributes.pakFiles;
    if (!Array.isArray(files)) continue;
    for (const entry of files) {
      if (!entry) continue;
      const key = claimedFileKey(entry.dir, entry.name);
      if (!key || seenPak.has(key)) continue;
      seenPak.add(key);
      pakFiles.push({ dir: entry.dir, name: entry.name });
    }
  }
  return { pakFiles, folders };
}

function listSharedFiles(projectRoot, keyFor) {
  const found = new Set();
  const root = path.resolve(projectRoot);
  for (const dir of [PAKS_DIR, LOGIC_DIR]) {
    const folder = path.join(root, dir);
    if (!existsUnder(root, folder)) continue;
    let names = [];
    try {
      names = fs.readdirSync(folder);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) continue;
      throw err;
    }
    for (const name of names) {
      const key = keyFor(dir, name);
      if (key) found.add(key);
    }
  }
  return found;
}

// Container files currently in Content\Paks and Content\Paks\LogicMods.
function listPakContainers(projectRoot) {
  return listSharedFiles(projectRoot, pakOwnerKey);
}

// Containers and loose text. Auto-rename treats both as taken names.
function listPakNames(projectRoot) {
  return listSharedFiles(projectRoot, claimedFileKey);
}

// A deploying mod's pak, ucas, utoc, or loose text matches a file on disk that another mod owns.
// The deploying mod's own file is a replacement and is not a conflict.
function findPakConflicts(mods, deployingIds, existingKeys) {
  const owners = new Map();
  const byId = new Map();
  for (const mod of mods || []) {
    if (!mod || !mod.id) continue;
    byId.set(mod.id, mod);
    const files = Array.isArray(mod.pakFiles) ? mod.pakFiles : [];
    for (const entry of files) {
      if (!entry) continue;
      const key = claimedFileKey(entry.dir, entry.name);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, []);
      const list = owners.get(key);
      if (list.some((item) => item.id === mod.id)) continue;
      list.push({
        id: mod.id,
        name: mod.name || mod.id,
        dir: path.normalize(entry.dir),
        file: entry.name,
      });
    }
  }

  const deploying = deployingIds instanceof Set ? deployingIds : new Set(deployingIds || []);
  const present = existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
  const conflicts = [];
  const seen = new Set();
  for (const id of deploying) {
    const mod = byId.get(id);
    if (!mod || !Array.isArray(mod.pakFiles)) continue;
    for (const entry of mod.pakFiles) {
      if (!entry) continue;
      const key = claimedFileKey(entry.dir, entry.name);
      const seenKey = id + "\0" + key;
      if (!key || seen.has(seenKey) || !present.has(key)) continue;
      const others = (owners.get(key) || [])
        .filter((item) => item.id !== id)
        .map((item) => ({ id: item.id, name: item.name }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      if (others.length === 0) continue;
      seen.add(seenKey);
      conflicts.push({
        modId: id,
        dir: path.normalize(entry.dir),
        name: entry.name,
        owners: others,
      });
    }
  }
  conflicts.sort((a, b) =>
    (a.dir + "\0" + a.name + "\0" + a.modId).localeCompare(b.dir + "\0" + b.name + "\0" + b.modId),
  );
  return conflicts;
}

// One line per file and owner. When the last deploy names a keeper, that mod is the owner.
function pakConflictLines(conflicts, keepers) {
  const lines = [];
  const seen = new Set();
  for (const conflict of conflicts || []) {
    const file = path.join(conflict.dir, conflict.name);
    let owners = Array.isArray(conflict.owners) ? conflict.owners.filter(Boolean) : [];
    const key = claimedFileKey(conflict.dir, conflict.name);
    const keeper = keepers && key && typeof keepers.get === "function" ? keepers.get(key) : undefined;
    if (keeper) {
      const kept = owners.filter((owner) => owner.id === keeper);
      if (kept.length > 0) owners = kept;
    }
    for (const owner of owners) {
      const line = file + " owned by " + (owner.name || owner.id);
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

function occupiedPakKeys(mods, extra) {
  const keys = new Set(extra || []);
  for (const mod of mods || []) {
    const files = mod && Array.isArray(mod.pakFiles) ? mod.pakFiles : [];
    for (const entry of files) {
      if (!entry) continue;
      const key = claimedFileKey(entry.dir, entry.name);
      if (key) keys.add(key);
    }
  }
  return keys;
}

// Mod ids that already have files in the previous deployment. Those mods are not renamed or removed.
function protectedModIds(lastDeployment, mods) {
  const ids = new Set();
  if (!lastDeployment || typeof lastDeployment !== "object") return ids;
  for (const files of Object.values(lastDeployment)) {
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      const modId = modIdForDeploySource(mods, file && file.source);
      if (modId) ids.add(modId);
    }
  }
  return ids;
}

// The mod that already deployed the file keeps its name. Everyone else is incoming.
function withoutPakKeepers(conflicts, keepers) {
  if (!keepers || typeof keepers.get !== "function" || keepers.size === 0) return conflicts || [];
  return (conflicts || []).filter((conflict) => {
    if (!conflict) return false;
    const key = claimedFileKey(conflict.dir, conflict.name);
    return !key || keepers.get(key) !== conflict.modId;
  });
}

function deployedPakDir(typeId, relPath) {
  const rel = path.normalize(String(relPath || ""));
  const base = path.basename(rel);
  if (!fileParts(base)) return null;
  if (typeId === LOGIC_ID) return LOGIC_DIR;
  if (typeId === PAK_ID) return PAKS_DIR;
  if (typeId !== MIXED_ID) return null;
  const lower = rel.toLowerCase();
  if (lower.includes(path.normalize(LOGIC_DIR).toLowerCase())) return LOGIC_DIR;
  if (lower.includes(path.normalize(PAKS_DIR).toLowerCase())) return PAKS_DIR;
  return null;
}

function modIdForDeploySource(mods, source) {
  const value = String(source || "").replace(/\//g, "\\").toLowerCase();
  if (!value) return null;
  let found = null;
  let length = -1;
  for (const mod of mods || []) {
    if (!mod || !mod.installationPath) continue;
    const inst = String(mod.installationPath).replace(/\//g, "\\").toLowerCase();
    if (!inst) continue;
    if (value === inst || value.startsWith(inst + "\\")) {
      if (inst.length > length) {
        found = mod.id;
        length = inst.length;
      }
    }
  }
  return found;
}

// lastDeployment is the previous manifest. source is the mod installationPath.
function keepersFromDeployment(lastDeployment, mods) {
  const keepers = new Map();
  if (!lastDeployment || typeof lastDeployment !== "object") return keepers;
  for (const [typeId, files] of Object.entries(lastDeployment)) {
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      if (!file || typeof file.relPath !== "string") continue;
      const modId = modIdForDeploySource(mods, file.source);
      if (!modId) continue;
      const dir = deployedPakDir(typeId, file.relPath);
      if (!dir) continue;
      const key = claimedFileKey(dir, path.basename(file.relPath));
      if (key && !keepers.has(key)) keepers.set(key, modId);
    }
  }
  return keepers;
}

function counterSuffix(n) {
  return "_" + String(n).padStart(2, "0");
}

// One number per base name. Every file with that stem, in either pak directory, shares it.
function chooseCounter(files, occupied) {
  const stem = files[0].stem;
  for (let n = 1; n <= 9999; n++) {
    const suffix = counterSuffix(n);
    const tagged = files.map((file) => ({
      dir: file.dir,
      from: file.from,
      to: file.stem + suffix + file.ext,
    }));
    const local = new Set();
    let ok = tagged.length > 0;
    for (const item of tagged) {
      if (item.to.length > 240 || item.to.toLowerCase() === item.from.toLowerCase()) {
        ok = false;
        break;
      }
      const key = claimedFileKey(item.dir, item.to);
      if (!key || occupied.has(key) || local.has(key)) {
        ok = false;
        break;
      }
      local.add(key);
    }
    if (!ok) continue;
    for (const key of local) occupied.add(key);
    return tagged;
  }
  throw new Error("No free pak name for " + stem);
}

// Any collision renames every file that mod claims. The base name picks the counter.
function planPakRenames(mods, conflicts, occupiedKeys) {
  const byId = new Map();
  for (const mod of mods || []) {
    if (mod && mod.id) byId.set(mod.id, mod);
  }
  const occupied = occupiedPakKeys(mods, occupiedKeys);
  const incoming = new Set();
  for (const conflict of conflicts || []) {
    if (conflict && conflict.modId) incoming.add(conflict.modId);
  }
  const plan = [];
  const ids = [...incoming].sort((a, b) => a.localeCompare(b));
  for (const id of ids) {
    const mod = byId.get(id);
    if (!mod) continue;
    const groups = new Map();
    for (const entry of mod.pakFiles || []) {
      if (!entry) continue;
      const source = fileParts(entry.renamedFrom || entry.name);
      const current = fileParts(entry.name);
      if (!source || !current || !isAllowedPakDir(entry.dir)) continue;
      const groupKey = source.stem.toLowerCase();
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({
        dir: path.normalize(entry.dir),
        from: entry.name,
        stem: source.stem,
        ext: current.ext,
      });
    }
    const renames = [];
    const pathOrder = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
    for (const groupKey of [...groups.keys()].sort(pathOrder)) {
      const files = groups.get(groupKey).sort((a, b) => pathOrder(a.dir + "\0" + a.from, b.dir + "\0" + b.from));
      renames.push(...chooseCounter(files, occupied));
    }
    if (renames.length > 0) plan.push({ modId: id, name: mod.name || id, renames });
  }
  return plan;
}

function pakRenamePreviewLines(plan) {
  const lines = [];
  for (const item of plan || []) {
    const who = item.name || item.modId;
    for (const rename of item.renames || []) {
      lines.push(
        path.join(rename.dir, rename.from) +
          " from " +
          who +
          " deploys as " +
          path.join(rename.dir, rename.to),
      );
    }
  }
  return lines;
}

// name is what uninstall and purge delete. renamedFrom keeps the archive name.
function renamePakFiles(pakFiles, renames) {
  const map = new Map();
  for (const rename of renames || []) {
    const key = claimedFileKey(rename.dir, rename.from);
    if (key) map.set(key, rename.to);
  }
  return (pakFiles || []).map((entry) => {
    if (!entry) return entry;
    const key = claimedFileKey(entry.dir, entry.name);
    const to = key && map.get(key);
    if (!to || to === entry.name) return entry;
    return { dir: entry.dir, name: to, renamedFrom: entry.renamedFrom || entry.name };
  });
}

function modStagingRoot(stagingRoot, installationPath) {
  if (!stagingRoot || !installationPath) return null;
  const root = path.resolve(stagingRoot);
  const full = path.resolve(root, installationPath);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

function stagedPakMatches(modRoot, rename) {
  const root = path.resolve(modRoot);
  const candidates = [path.join(root, rename.from), path.join(root, PROJECT, rename.dir, rename.from)];
  const found = [];
  for (const candidate of candidates) {
    const full = path.resolve(candidate);
    const rel = path.relative(root, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (fs.existsSync(full)) found.push(full);
  }
  return found;
}

function rollbackStagedPakRenames(done) {
  for (let i = (done || []).length - 1; i >= 0; i--) {
    if (!fs.existsSync(done[i].from)) fs.renameSync(done[i].to, done[i].from);
  }
}

// Renames the staged copies Vortex hardlinks. Rolls back if any file in the set is missing.
function applyStagedPakRenames(modRoot, renames) {
  const done = [];
  try {
    for (const rename of renames || []) {
      const found = stagedPakMatches(modRoot, rename);
      if (found.length !== 1) {
        throw new Error("Expected one staged copy of " + rename.from + ", found " + found.length);
      }
      const target = path.join(path.dirname(found[0]), rename.to);
      const rel = path.relative(path.resolve(modRoot), path.resolve(target));
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Renamed pak left the mod folder");
      }
      if (fs.existsSync(target)) throw new Error("Staged pak already exists: " + rename.to);
      fs.renameSync(found[0], target);
      done.push({ from: found[0], to: target });
    }
  } catch (err) {
    try {
      rollbackStagedPakRenames(done);
    } catch (rollbackErr) {
      // The caller reports the original failure.
    }
    throw err;
  }
  return done;
}

function projectPaths(projectRoot) {
  const modsDir = path.join(projectRoot, MODS_IN_PROJECT);
  return {
    modsDir,
    modsTxt: path.join(modsDir, "mods.txt"),
    logicOrder: path.join(modsDir, "BPModLoaderMod", "load_order.txt"),
  };
}

const CONFIG_FILE = "config.lua";

function configParts() {
  return [[CONFIG_FILE], ["Scripts", CONFIG_FILE]];
}

function settingsDir(modsDir, folder) {
  return path.join(path.dirname(modsDir), "VortexSettings", folder);
}

// Copy a live config.lua out of Mods before that folder is deleted. A missing
// source does not replace a file already saved under VortexSettings.
function preserveModConfig(projectRoot, folder) {
  if (!folder || !isSafeSegment(folder)) return;
  const modsDir = projectPaths(projectRoot).modsDir;
  const stashRoot = settingsDir(modsDir, folder);
  for (const parts of configParts()) {
    const source = path.join(modsDir, folder, ...parts);
    if (!fs.existsSync(source)) continue;
    let stat;
    try {
      stat = fs.statSync(source);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) continue;
      throw err;
    }
    if (!stat.isFile()) continue;
    const dest = path.join(stashRoot, ...parts);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }
}

// Write the saved config back over the deployed file, then drop the stash so
// a later deploy does not freeze those settings.
function restoreModConfig(projectRoot, folder) {
  if (!folder || !isSafeSegment(folder)) return false;
  const modsDir = projectPaths(projectRoot).modsDir;
  const stashRoot = settingsDir(modsDir, folder);
  if (!fs.existsSync(stashRoot)) return false;
  let copied = false;
  for (const parts of configParts()) {
    const source = path.join(stashRoot, ...parts);
    if (!fs.existsSync(source)) continue;
    let stat;
    try {
      stat = fs.statSync(source);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) continue;
      throw err;
    }
    if (!stat.isFile()) continue;
    const dest = path.join(modsDir, folder, ...parts);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    copied = true;
  }
  if (copied) fs.rmSync(stashRoot, { recursive: true, force: true });
  return copied;
}

// Walk from a directory that exists. Never stat a path whose parent is already gone.
function existsUnder(root, target) {
  const base = path.resolve(root);
  const full = path.resolve(target);
  const rel = path.relative(base, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  let current = base;
  try {
    if (!fs.existsSync(current)) return false;
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return false;
    throw err;
  }
  for (const part of rel.split(path.sep)) {
    if (!part || part === ".") continue;
    current = path.join(current, part);
    try {
      if (!fs.existsSync(current)) return false;
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return false;
      throw err;
    }
  }
  return true;
}

function removeIfPresent(root, target, rmOptions, remove) {
  if (!existsUnder(root, target)) return;
  const rm = remove || fs.rmSync;
  try {
    rm(target, rmOptions);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return;
    throw err;
  }
}

// Vortex writes one of these into every directory its activator creates.
const VORTEX_DIR_TAGS = new Set(["__folder_managed_by_vortex", "__delete_if_empty"]);
// Node retries ENOTEMPTY only when maxRetries is set. The default is 0.
const TREE_RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
const TREE_RETRY_CODES = new Set(["ENOTEMPTY", "EPERM", "EBUSY", "EMFILE", "ENFILE"]);

function clearVortexTags(root, folder) {
  if (!existsUnder(root, folder)) return;
  const stack = [folder];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!existsUnder(root, dir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) continue;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (!existsUnder(root, full)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!VORTEX_DIR_TAGS.has(entry.name)) continue;
      try {
        fs.rmSync(full, { force: true });
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) continue;
      }
    }
  }
}

function payloadLeft(folder) {
  if (!fs.existsSync(folder)) return false;
  const stack = [folder];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
      else if (!VORTEX_DIR_TAGS.has(entry.name)) return true;
    }
  }
  return false;
}

// A stand-in remover does not get Node's maxRetries, so retry those codes here.
function removeTree(root, target, remove) {
  if (!remove) {
    removeIfPresent(root, target, TREE_RM);
    return;
  }
  for (let attempt = 0; attempt <= TREE_RM.maxRetries; attempt++) {
    try {
      removeIfPresent(root, target, TREE_RM, remove);
      return;
    } catch (err) {
      if (!err || !TREE_RETRY_CODES.has(err.code) || attempt === TREE_RM.maxRetries) throw err;
    }
  }
}

function modLineNames(options) {
  if (options.ue4ssModFolder && isSafeSegment(options.ue4ssModFolder)) return [options.ue4ssModFolder];
  return [];
}

// Drops the mods.txt line and leaves deployed files for the activator.
function dropModLine(options) {
  const paths = projectPaths(options.projectRoot);
  const removeNames = modLineNames(options);
  if (removeNames.length === 0 || !fs.existsSync(paths.modsTxt)) return null;
  const current = fs.readFileSync(paths.modsTxt, "utf8");
  const next = updateModsTxt(current, [], {
    remove: removeNames,
    folderExists: (name) => fs.existsSync(path.join(paths.modsDir, name)),
  });
  if (next !== current) fs.writeFileSync(paths.modsTxt, next, "utf8");
  return next;
}

// Deletes a recorded script folder and recorded pak and text files that are still on disk, then drops the mods.txt line.
// A path the activator already removed is left alone. Shipping basenames are never deleted.
// The script folder delete retries when Windows says the directory is not empty.
// Vortex's directory marker is not a failed uninstall. A payload file that is still there is.
// The mods.txt line is dropped even when a delete fails.
// A pak name or script folder recorded by another installed mod is left in place, line included.
// projectRoot is the inner Permafrost folder.
function removeDeployed(options) {
  const projectRoot = options.projectRoot;
  const paths = projectPaths(projectRoot);
  const root = path.resolve(projectRoot);
  const remove = typeof options.rmSync === "function" ? options.rmSync : null;
  const keptPak = new Set();
  for (const entry of options.keptPakFiles || []) {
    const key = entry && claimedFileKey(entry.dir, entry.name);
    if (key) keptPak.add(key);
  }
  const keptFolder = new Set(
    (options.keptFolders || []).map((name) => String(name).toLowerCase()),
  );
  const keepFolder = !!(
    options.ue4ssModFolder && keptFolder.has(String(options.ue4ssModFolder).toLowerCase())
  );
  let failure = null;
  let warning = null;

  try {
    if (options.ue4ssModFolder && isSafeSegment(options.ue4ssModFolder) && !keepFolder) {
      const folder = path.join(paths.modsDir, options.ue4ssModFolder);
      try {
        preserveModConfig(projectRoot, options.ue4ssModFolder);
        clearVortexTags(root, folder);
        removeTree(root, folder, remove);
      } catch (err) {
        if (!existsUnder(root, folder)) {
          // The folder is already gone.
        } else if (!payloadLeft(folder)) {
          warning = "Permafrost could not delete an empty mod folder: " + options.ue4ssModFolder;
        } else {
          failure = err;
        }
      }
    }

    const pakFiles = Array.isArray(options.pakFiles) ? options.pakFiles : [];
    for (const entry of pakFiles) {
      if (!entry || !isSafeSegment(entry.name) || isShippingName(entry.name)) continue;
      if (!isAllowedPakDir(entry.dir)) continue;
      const target = path.resolve(projectRoot, entry.dir, entry.name);
      const targetKey = target.toLowerCase();
      const rootKey = (root + path.sep).toLowerCase();
      if (!targetKey.startsWith(rootKey)) continue;
      if (keptPak.has(claimedFileKey(entry.dir, entry.name))) continue;
      try {
        removeIfPresent(root, target, { force: true });
      } catch (err) {
        if (!failure) failure = err;
      }
    }
  } finally {
    try {
      dropModLine(keepFolder ? { ...options, ue4ssModFolder: undefined } : options);
    } catch (err) {
      if (!failure) failure = err;
    }
  }

  if (failure) throw failure;
  return warning;
}

function ensureLogicModsDir(gamePath) {
  if (!gamePath) throw new Error("Permafrost is not discovered yet.");
  fs.mkdirSync(path.join(gamePath, LOGIC_REL), { recursive: true });
}

// Vortex tests these directories for write access before setup runs. A missing
// directory is reported as "Can't write to output directory."
function ensureDeployDirs(gamePath) {
  ensureLogicModsDir(gamePath);
  fs.mkdirSync(path.join(gamePath, MODS_REL), { recursive: true });
  fs.mkdirSync(path.join(gamePath, "Mods"), { recursive: true });
}

function testModLoader(files, gameId, archivePath) {
  if (gameId !== GAME_ID) return testResult(false);
  try {
    return testResult(prepareModLoader(files, null, archivePath).claim);
  } catch {
    return testResult(false);
  }
}

// Vortex prefixes the mod id when mergeMods is false. These types deploy
// straight into their target folders, including a mixed mod whose target is
// the Steam root and whose destinations already start with Permafrost\.
function modTypeOptions(name) {
  return { name, mergeMods: true };
}

function stripEnabledTxt(folder) {
  if (!folder || !fs.existsSync(folder)) return;
  const stack = [folder];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === "enabled.txt") fs.rmSync(full, { force: true });
    }
  }
}

module.exports = {
  GAME_ID,
  SCRIPTS_ID,
  PAK_ID,
  LOGIC_ID,
  MIXED_ID,
  MODLOADER_ID,
  MODS_REL,
  MODS_IN_PROJECT,
  PAKS_REL,
  LOGIC_REL,
  PAKS_DIR,
  LOGIC_DIR,
  classify,
  installPak,
  installScripts,
  installLogic,
  testScripts,
  testPak,
  testLogic,
  testModLoader,
  testReject,
  prepareModLoader,
  installReject,
  removeDeployed,
  preserveModConfig,
  restoreModConfig,
  claimsHeldByOthers,
  dropModLine,
  existsUnder,
  listPakContainers,
  listPakNames,
  findPakConflicts,
  pakConflictLines,
  withoutPakKeepers,
  keepersFromDeployment,
  protectedModIds,
  planPakRenames,
  pakRenamePreviewLines,
  renamePakFiles,
  modStagingRoot,
  applyStagedPakRenames,
  rollbackStagedPakRenames,
  ensureLogicModsDir,
  ensureDeployDirs,
  modTypeOptions,
  stripEnabledTxt,
  projectPaths,
  isShippingName,
  isSafeSegment,
};
