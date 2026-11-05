// Permafrost ModLoader packages and API DLLs. Vortex is not required.
// An API DLL exports both PermafrostModQuery and PermafrostModLoad.
// The host DLL contains those names as text and exports neither of them.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MODLOADER_ID = "permafrost-modloader";
const MODLOADER_TOOL_ID = "permafrost-modloader-api";
const MODLOADER_TOOL_NAME = "Permafrost ModLoader API";
const MODLOADER_EXE_FILE = "PermafrostModLoader.exe";
const MODLOADER_HOST_FILE = "PermafrostModHost.dll";
const API_EXPORTS = ["PermafrostModQuery", "PermafrostModLoad"];
const LOADER_EXE = "permafrostmodloader.exe";
const HOST_DLL = "permafrostmodhost.dll";
const INI_NAME = "permafrostmodloader.ini";
const DOC_NAMES = new Set(["readme.txt", "validation.txt", "sha256sums.txt"]);
const WRAPPER_SKIP = new Set(["scripts", "dlls", "logicmods", "config", "mods"]);

function normalizeRel(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isDirEntry(file) {
  const norm = String(file || "").replace(/\\/g, "/");
  return norm.endsWith("/") || norm === "";
}

function partsOf(file) {
  return normalizeRel(file).split("/").filter(Boolean);
}

function basename(file) {
  const parts = partsOf(file);
  return parts.length ? parts[parts.length - 1] : "";
}

function samePath(left, right) {
  return normalizeRel(left).toLowerCase() === normalizeRel(right).toLowerCase();
}

function readU16(buf, offset) {
  return buf.readUInt16LE(offset);
}

function readU32(buf, offset) {
  return buf.readUInt32LE(offset);
}

function rvaToOffset(rva, sections) {
  for (const section of sections) {
    if (rva >= section.va && rva < section.va + section.rawSize) {
      return section.raw + (rva - section.va);
    }
  }
  return -1;
}

function cString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end += 1;
  return buf.toString("utf8", offset, end);
}

// Named exports from a PE32 or PE32+ image. An image with no export table returns [].
function peExportNames(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return [];
  const pe = buf.readInt32LE(0x3c);
  if (pe < 0 || pe + 24 > buf.length || readU32(buf, pe) !== 0x00004550) return [];
  const sectionCount = readU16(buf, pe + 6);
  const optionalSize = readU16(buf, pe + 20);
  const magic = readU16(buf, pe + 24);
  const directory = magic === 0x20b ? pe + 24 + 112 : pe + 24 + 96;
  if (directory + 8 > buf.length) return [];
  const exportRva = readU32(buf, directory);
  if (exportRva === 0) return [];
  const sectionTable = pe + 24 + optionalSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const off = sectionTable + i * 40;
    if (off + 24 > buf.length) return [];
    sections.push({
      va: readU32(buf, off + 12),
      rawSize: readU32(buf, off + 16),
      raw: readU32(buf, off + 20),
    });
  }
  const exp = rvaToOffset(exportRva, sections);
  if (exp < 0 || exp + 40 > buf.length) return [];
  const nameCount = readU32(buf, exp + 24);
  const namesRva = readU32(buf, exp + 32);
  const namesOff = rvaToOffset(namesRva, sections);
  if (namesOff < 0) return [];
  const names = [];
  for (let i = 0; i < nameCount; i += 1) {
    const slot = namesOff + i * 4;
    if (slot + 4 > buf.length) break;
    const nameOff = rvaToOffset(readU32(buf, slot), sections);
    if (nameOff < 0) continue;
    names.push(cString(buf, nameOff));
  }
  return names;
}

function isApiExportList(names) {
  const have = new Set((names || []).map((name) => String(name).toLowerCase()));
  return API_EXPORTS.every((name) => have.has(name.toLowerCase()));
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (readU32(buf, i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("ZIP end of central directory was not found.");
  const count = readU16(buf, eocd + 10);
  let offset = readU32(buf, eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buf.length || readU32(buf, offset) !== 0x02014b50) {
      throw new Error("ZIP central directory is not valid.");
    }
    const method = readU16(buf, offset + 10);
    const compSize = readU32(buf, offset + 20);
    const nameLen = readU16(buf, offset + 28);
    const extraLen = readU16(buf, offset + 30);
    const commentLen = readU16(buf, offset + 32);
    const localOff = readU32(buf, offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen).replace(/\\/g, "/");
    const localNameLen = readU16(buf, localOff + 26);
    const localExtraLen = readU16(buf, localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    let data = buf.subarray(dataOff, dataOff + compSize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error("ZIP method " + method + " is not supported.");
    entries.push({ name, data: Buffer.from(data) });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function fileBytes(tempPath, zipEntries, relative) {
  const rel = normalizeRel(relative);
  if (tempPath) {
    const full = path.join(tempPath, ...rel.split("/"));
    try {
      if (fs.statSync(full).isFile()) return fs.readFileSync(full);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
  }
  if (!zipEntries) return null;
  const hit = zipEntries.find((entry) => samePath(entry.name, rel));
  return hit ? hit.data : null;
}

function wrapperPrefix(files) {
  let rootFile = false;
  const dirs = new Set();
  for (const file of files || []) {
    const parts = partsOf(file);
    if (parts.length === 0) continue;
    if (!isDirEntry(file) && parts.length === 1) rootFile = true;
    if (isDirEntry(file) || parts.length > 1) dirs.add(parts[0]);
  }
  if (rootFile || dirs.size !== 1) return "";
  const only = [...dirs][0];
  if (WRAPPER_SKIP.has(only.toLowerCase())) return "";
  return only;
}

function strippedParts(file, wrapper) {
  const parts = partsOf(file);
  if (wrapper) {
    if (parts[0] !== wrapper) return null;
    return parts.slice(1);
  }
  return parts;
}

function hasForeignPayload(files) {
  for (const file of files || []) {
    if (isDirEntry(file)) continue;
    const rel = normalizeRel(file).toLowerCase();
    const base = basename(rel);
    if (base.endsWith(".pak") || base.endsWith(".ucas") || base.endsWith(".utoc")) return true;
    if (rel === "scripts/main.lua" || rel.endsWith("/scripts/main.lua")) return true;
    if (rel === "dlls/main.dll" || rel.endsWith("/dlls/main.dll")) return true;
  }
  return false;
}

function isLiveIni(parts) {
  if (!parts || parts.length === 0) return false;
  const base = parts[parts.length - 1].toLowerCase();
  if (base !== INI_NAME) return false;
  if (parts.length === 1) return true;
  return parts.length === 2 && parts[0].toLowerCase() === "config";
}

function isLoaderDoc(parts) {
  if (!parts || parts.length !== 1) return false;
  const lower = parts[0].toLowerCase();
  return DOC_NAMES.has(lower) || lower.endsWith(".ini.example");
}

function isAllowed(parts, apiDll) {
  if (!parts || parts.length === 0) return false;
  const lower = parts[parts.length - 1].toLowerCase();
  if (lower === LOADER_EXE || lower === HOST_DLL) return parts.length === 1;
  if (apiDll) return true;
  if (isLiveIni(parts)) return true;
  if (parts[0].toLowerCase() === "config") return true;
  return isLoaderDoc(parts);
}

function blockedBinaryMessage(names) {
  const list = (names || []).join(", ");
  return (
    list +
    " cannot be installed as a content pack. A DLL that exports PermafrostModQuery and PermafrostModLoad goes in the game folder's Mods directory. PermafrostModLoader.exe and PermafrostModHost.dll go in the game folder."
  );
}

function destinationFor(parts, apiDll) {
  const base = parts[parts.length - 1];
  const lower = base.toLowerCase();
  if (apiDll) return path.join("Mods", base);
  if (lower === LOADER_EXE || lower === HOST_DLL) return base;
  if (isLiveIni(parts)) return null;
  if (parts[0].toLowerCase() === "config" || isLoaderDoc(parts)) return parts.join(path.sep);
  return null;
}

// claim is true only for a loader package, an API DLL, or both, with no pak and no UE4SS anchor.
function prepareModLoader(files, tempPath, archivePath) {
  const empty = {
    claim: false,
    apiDlls: [],
    iniText: null,
    needsManualIni: false,
    instructions: [],
  };
  const list = files || [];
  if (hasForeignPayload(list)) return empty;
  let zipEntries = null;
  if (archivePath) {
    try {
      zipEntries = readZipEntries(archivePath);
    } catch {
      zipEntries = null;
    }
  }
  const wrapper = wrapperPrefix(list);
  const apiSources = new Set();
  for (const file of list) {
    if (isDirEntry(file)) continue;
    if (basename(file).toLowerCase().endsWith(".dll") === false) continue;
    const bytes = fileBytes(tempPath, zipEntries, file);
    if (bytes && isApiExportList(peExportNames(bytes))) apiSources.add(normalizeRel(file).toLowerCase());
  }
  const copies = [];
  const guarded = [];
  const apiDlls = [];
  let iniFile = null;
  for (const file of list) {
    if (isDirEntry(file)) continue;
    const parts = strippedParts(file, wrapper);
    if (!parts || parts.length === 0) return empty;
    const apiDll = apiSources.has(normalizeRel(file).toLowerCase());
    if (!isAllowed(parts, apiDll)) return empty;
    if (apiDll) apiDlls.push(parts[parts.length - 1]);
    if (isLiveIni(parts)) {
      const preferConfig = parts.length === 2;
      if (!iniFile || preferConfig) iniFile = file;
      continue;
    }
    const destination = destinationFor(parts, apiDll);
    if (!destination) continue;
    copies.push({ source: file, destination });
    const lower = parts[parts.length - 1].toLowerCase();
    if (apiDll || lower === LOADER_EXE || lower === HOST_DLL) guarded.push(destination);
  }
  const hasLoader = copies.some((item) => {
    const base = basename(item.destination).toLowerCase();
    return base === LOADER_EXE || base === HOST_DLL;
  });
  if (apiDlls.length === 0 && !hasLoader) return empty;
  let iniText = null;
  if (iniFile) {
    const bytes = fileBytes(tempPath, zipEntries, iniFile);
    if (bytes) iniText = bytes.toString("utf8");
  }
  const instructions = copies.map((item) => ({
    type: "copy",
    source: item.source,
    destination: item.destination,
  }));
  instructions.push({ type: "setmodtype", value: MODLOADER_ID });
  if (guarded.length > 0) {
    instructions.push({ type: "attribute", key: "modLoaderFiles", value: guarded });
  }
  if (iniText != null) {
    instructions.push({ type: "attribute", key: "modLoaderIni", value: iniText });
  }
  const needsManualIni = apiDlls.length > 0 && iniText == null;
  if (needsManualIni) {
    instructions.push({ type: "attribute", key: "modLoaderNeedsManualIni", value: true });
  }
  return { claim: true, apiDlls, iniText, needsManualIni, instructions };
}

function splitIni(text) {
  const raw = String(text == null ? "" : text);
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  return { bom, newline, lines: body.split(/\r?\n/) };
}

function sectionName(line) {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  return match ? match[1].trim() : null;
}

function keyValue(line) {
  if (/^\s*[;#]/.test(line)) return null;
  const match = /^\s*([^=;#][^=]*?)\s*=\s*(.*)$/.exec(line);
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

function iniTable(text) {
  const sections = new Map();
  let current = null;
  for (const line of splitIni(text).lines) {
    const sec = sectionName(line);
    if (sec != null) {
      const id = sec.toLowerCase();
      if (!sections.has(id)) sections.set(id, { name: sec, keys: new Map() });
      current = sections.get(id);
      continue;
    }
    if (!current) continue;
    const kv = keyValue(line);
    if (!kv) continue;
    current.keys.set(kv.key.toLowerCase(), kv);
  }
  return sections;
}

function iniChoiceId(section, key) {
  return String(section == null ? "" : section).trim().toLowerCase() + "\0" + String(key == null ? "" : key).trim().toLowerCase();
}

function keptChoice(item) {
  if (!item || item.section == null || item.key == null) return null;
  if (item.incoming == null || item.existing == null) return null;
  return {
    section: String(item.section),
    key: String(item.key),
    incoming: String(item.incoming).trim(),
    existing: String(item.existing).trim(),
  };
}

function normalizeKept(kept) {
  if (!Array.isArray(kept)) return [];
  return kept.map(keptChoice).filter(Boolean);
}

function sameKept(entry, conflict) {
  return iniChoiceId(entry.section, entry.key) === iniChoiceId(conflict.section, conflict.key)
    && entry.incoming === String(conflict.incoming == null ? "" : conflict.incoming).trim()
    && entry.existing === String(conflict.existing == null ? "" : conflict.existing).trim();
}

// A conflict stays open unless this mod already kept the same live value against the same stored value.
function openIniConflicts(conflicts, kept) {
  const list = normalizeKept(kept);
  return (conflicts || []).filter((conflict) => conflict && !list.some((entry) => sameKept(entry, conflict)));
}

function rememberKeptConflicts(kept, conflicts) {
  let next = normalizeKept(kept);
  for (const conflict of conflicts || []) {
    const entry = keptChoice(conflict);
    if (!entry) continue;
    const id = iniChoiceId(entry.section, entry.key);
    next = next.filter((item) => iniChoiceId(item.section, item.key) !== id);
    next.push(entry);
  }
  return next;
}

function dropKeptConflicts(kept, conflicts) {
  const drop = new Set((conflicts || []).map((conflict) => conflict && iniChoiceId(conflict.section, conflict.key)));
  return normalizeKept(kept).filter((entry) => !drop.has(iniChoiceId(entry.section, entry.key)));
}

// alreadyDeployed means the mod's files were in the previous ModLoader deployment.
// applied is the stored ini last reconciled, or null when this build has not stamped it.
// An already deployed mod with no stamp is adopted and is not merged.
// A changed stored text merges. A mod missing from the previous deployment merges.
function planIniMerge(input) {
  const ini = input && typeof input.ini === "string" ? input.ini : "";
  if (!ini) return { merge: false, stamp: false };
  const hasApplied = !!(input && typeof input.applied === "string");
  const applied = hasApplied ? input.applied : null;
  const already = !!(input && input.alreadyDeployed);
  if (already && (!hasApplied || applied === ini)) {
    return { merge: false, stamp: !hasApplied };
  }
  return { merge: true, stamp: applied !== ini };
}

function sameKeptList(left, right) {
  const a = normalizeKept(left);
  const b = normalizeKept(right);
  if (a.length !== b.length) return false;
  return a.every((entry, index) => sameKept(entry, b[index]));
}

// Missing sections and keys are appended. An existing key keeps its value unless useModValues is set.
// takeKeys limits that rewrite to those section/key ids. Omit it to rewrite every conflict.
function mergeIni(existingText, incomingText, useModValues, takeKeys) {
  if (existingText == null || String(existingText) === "") {
    return {
      text: String(incomingText == null ? "" : incomingText),
      conflicts: [],
      created: true,
    };
  }
  const existing = splitIni(existingText);
  const incoming = iniTable(incomingText);
  const conflicts = [];
  const seen = new Set();
  const out = [];
  let current = null;
  let currentName = "";
  const finished = new Set();

  function flush(sectionLower) {
    if (sectionLower == null || finished.has(sectionLower)) return;
    finished.add(sectionLower);
    const sec = incoming.get(sectionLower);
    if (!sec) return;
    for (const [keyLower, key] of sec.keys) {
      if (seen.has(sectionLower + "\0" + keyLower)) continue;
      out.push(key.key + "=" + key.value);
    }
  }

  for (const line of existing.lines) {
    const sec = sectionName(line);
    if (sec != null) {
      flush(current);
      current = sec.toLowerCase();
      currentName = sec;
      out.push(line);
      continue;
    }
    const kv = current == null ? null : keyValue(line);
    if (kv) {
      const id = current + "\0" + kv.key.toLowerCase();
      if (!seen.has(id)) {
        seen.add(id);
        const incSection = incoming.get(current);
        const inc = incSection && incSection.keys.get(kv.key.toLowerCase());
        if (inc && inc.value !== kv.value) {
          conflicts.push({
            section: currentName,
            key: kv.key,
            existing: kv.value,
            incoming: inc.value,
          });
          const take = useModValues === true && (takeKeys == null || takeKeys.has(id));
          if (take) {
            out.push(kv.key + "=" + inc.value);
            continue;
          }
        }
      }
    }
    out.push(line);
  }
  flush(current);
  for (const [secLower, sec] of incoming) {
    if (finished.has(secLower)) continue;
    const missing = [];
    for (const [keyLower, key] of sec.keys) {
      if (seen.has(secLower + "\0" + keyLower)) continue;
      missing.push(key.key + "=" + key.value);
    }
    if (missing.length === 0) continue;
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push("[" + sec.name + "]");
    for (const line of missing) out.push(line);
  }
  let text = out.join(existing.newline);
  if (existing.bom) text = "\uFEFF" + text;
  return { text, conflicts, created: false };
}

function mergeIniTaking(existingText, incomingText, takeConflicts) {
  const ids = new Set((takeConflicts || []).map((item) => item && iniChoiceId(item.section, item.key)));
  return mergeIni(existingText, incomingText, true, ids);
}

// A mod that already deployed a guarded file keeps it. The other deploying mod is the conflict.
function modLoaderOwnershipConflicts(records, deployingIds) {
  const deploying = new Set(deployingIds || []);
  const out = [];
  const seen = new Set();
  for (const id of deployingIds || []) {
    const rec = (records || []).find((item) => item && item.id === id);
    if (!rec || rec.deployed) continue;
    for (const rel of rec.files || []) {
      const key = String(rel).replace(/\//g, "\\").toLowerCase();
      const other = (records || []).find((item) => {
        if (!item || item.id === id) return false;
        const owns = (item.files || []).some(
          (file) => String(file).replace(/\//g, "\\").toLowerCase() === key,
        );
        return owns && (item.deployed || deploying.has(item.id));
      });
      if (!other) continue;
      const mark = id + "|" + key;
      if (seen.has(mark)) continue;
      seen.add(mark);
      out.push({ modId: id, name: rec.name, file: rel, owner: other.name });
    }
  }
  return out;
}

function buildPeWithExports(names) {
  const list = names || [];
  const dir = Buffer.alloc(40);
  const funcs = Buffer.alloc(list.length * 4);
  const nameRvas = Buffer.alloc(list.length * 4);
  const ords = Buffer.alloc(list.length * 2);
  const strings = [];
  let cursor = 40 + funcs.length + nameRvas.length + ords.length;
  const baseRva = 0x1000;
  for (let i = 0; i < list.length; i += 1) {
    funcs.writeUInt32LE(baseRva, i * 4);
    nameRvas.writeUInt32LE(baseRva + cursor, i * 4);
    ords.writeUInt16LE(i, i * 2);
    const raw = Buffer.from(String(list[i]) + "\0", "utf8");
    strings.push(raw);
    cursor += raw.length;
  }
  dir.writeUInt32LE(1, 16);
  dir.writeUInt32LE(list.length, 20);
  dir.writeUInt32LE(list.length, 24);
  dir.writeUInt32LE(baseRva + 40, 28);
  dir.writeUInt32LE(baseRva + 40 + funcs.length, 32);
  dir.writeUInt32LE(baseRva + 40 + funcs.length + nameRvas.length, 36);
  const section = Buffer.concat([dir, funcs, nameRvas, ords, ...strings]);
  const file = Buffer.alloc(0x200 + section.length);
  file.writeUInt16LE(0x5a4d, 0);
  file.writeInt32LE(0x80, 0x3c);
  file.writeUInt32LE(0x00004550, 0x80);
  file.writeUInt16LE(0x8664, 0x84);
  file.writeUInt16LE(1, 0x86);
  file.writeUInt16LE(0xf0, 0x94);
  file.writeUInt16LE(0x20b, 0x98);
  file.writeUInt32LE(0x200, 0x98 + 36);
  file.writeUInt32LE(0x1000, 0x98 + 32);
  file.writeUInt32LE(16, 0x98 + 108);
  file.writeUInt32LE(0x1000, 0x98 + 112);
  file.writeUInt32LE(section.length, 0x98 + 116);
  const sectionHeader = 0x98 + 0xf0;
  file.write(".rdata", sectionHeader, 8, "ascii");
  file.writeUInt32LE(section.length, sectionHeader + 8);
  file.writeUInt32LE(0x1000, sectionHeader + 12);
  file.writeUInt32LE(section.length, sectionHeader + 16);
  file.writeUInt32LE(0x200, sectionHeader + 20);
  section.copy(file, 0x200);
  return file;
}

function buildZip(files) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const file of files || []) {
    const name = Buffer.from(String(file.name).replace(/\\/g, "/"), "utf8");
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const method = file.deflate ? 8 : 0;
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localStart = offset;
    parts.push(local, name, data);
    offset += local.length + name.length + data.length;
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localStart, 42);
    centrals.push(central, name);
  }
  const centralStart = offset;
  for (let i = 0; i < centrals.length; i += 2) {
    parts.push(centrals[i], centrals[i + 1]);
    offset += centrals[i].length + centrals[i + 1].length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = centrals.length / 2;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  parts.push(eocd);
  return Buffer.concat(parts);
}

function modLoaderApiPrompt(exePresent, hostPresent) {
  const exe = MODLOADER_EXE_FILE;
  const host = MODLOADER_HOST_FILE;
  const tail =
    "The DLL goes in that folder's Mods directory.\n\nCancel leaves this mod uninstalled. Continue installs the DLL anyway.";
  if (exePresent && hostPresent) return null;
  if (!exePresent && !hostPresent) {
    return {
      title: "Install the ModLoader API first",
      text:
        "This download includes a Permafrost ModLoader DLL. " +
        exe +
        " and " +
        host +
        " are not in the game folder. Install both in the game folder. " +
        tail,
    };
  }
  if (!exePresent) {
    return {
      title: "Permafrost ModLoader API is incomplete",
      text: host + " is in the game folder. " + exe + " is not. Install " + exe + " in the game folder. " + tail,
    };
  }
  return {
    title: "Permafrost ModLoader API is incomplete",
    text: exe + " is in the game folder. " + host + " is not. Install " + host + " in the game folder. " + tail,
  };
}

// pinned is the raw value. A missing key means never pinned. false means the user unpinned.
// ownedPrimary is written only in the same step that sets this tool as the primary launcher.
// A primary the user chose has no mark, and this sync does not set one.
function planModLoaderTool(input) {
  const exeExists = !!(input && input.exeExists);
  const discovered = input && input.discovered;
  const primary = input ? input.primary : undefined;
  const pinned = input ? input.pinned : undefined;
  const pinnedCount = input && Number.isFinite(input.pinnedCount) ? input.pinnedCount : 0;
  const custom = !!(discovered && discovered.custom === true);
  const ownedPrimary = !!(discovered && discovered.ownedPrimary === true);
  const register = exeExists && !custom
    ? {
        id: MODLOADER_TOOL_ID,
        name: MODLOADER_TOOL_NAME,
        requiredFiles: [MODLOADER_EXE_FILE],
        custom: false,
      }
    : null;
  return {
    register,
    pin: exeExists && pinned === undefined && pinnedCount < 10,
    clearPrimary: ownedPrimary && primary === MODLOADER_TOOL_ID,
    releaseOwnedPrimary: ownedPrimary && primary !== MODLOADER_TOOL_ID,
    forget: !exeExists && !!(discovered && !custom),
  };
}

module.exports = {
  MODLOADER_ID,
  MODLOADER_TOOL_ID,
  MODLOADER_TOOL_NAME,
  MODLOADER_EXE_FILE,
  MODLOADER_HOST_FILE,
  API_EXPORTS,
  peExportNames,
  isApiExportList,
  readZipEntries,
  prepareModLoader,
  mergeIni,
  mergeIniTaking,
  openIniConflicts,
  rememberKeptConflicts,
  dropKeptConflicts,
  sameKeptList,
  planIniMerge,
  modLoaderOwnershipConflicts,
  blockedBinaryMessage,
  modLoaderApiPrompt,
  planModLoaderTool,
  buildPeWithExports,
  buildZip,
};
