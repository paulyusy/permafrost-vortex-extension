// Pure mods.txt editor. Vortex is not required.
// The live file is UTF-8 with a BOM and CRLF. Built-in lines stay byte-for-byte.

const BOM = "\uFEFF";

const BUILTINS = new Set([
  "CheatManagerEnablerMod",
  "ActorDumperMod",
  "ConsoleCommandsMod",
  "ConsoleEnablerMod",
  "SplitScreenMod",
  "LineTraceMod",
  "BPModLoaderMod",
  "BPML_GenericFunctions",
  "jsbLuaProfilerMod",
  "Keybinds",
]);

const KEYBINDS_COMMENT = "; Built-in keybinds, do not move up!";

function isBuiltin(name) {
  return BUILTINS.has(name);
}

function splitText(text) {
  const raw = text || "";
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const nl = body.includes("\r\n") || body.length === 0 ? "\r\n" : "\n";
  const lines = body.length === 0 ? [] : body.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { bom, nl, lines };
}

function joinText(parts) {
  const body = parts.lines.length === 0 ? "" : parts.lines.join(parts.nl) + parts.nl;
  return (parts.bom ? BOM : "") + body;
}

// UE4SS ignores any line containing ";" and strips spaces before it splits on ":".
function lineName(line) {
  if (line == null) return null;
  if (line.includes(";")) return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx <= 0) return null;
  const name = trimmed.slice(0, idx).trim();
  if (!name) return null;
  return name;
}

function setBit(line, enabled) {
  const bit = enabled ? "1" : "0";
  if (/[01]\s*$/.test(line)) return line.replace(/[01](\s*)$/, bit + "$1");
  return line;
}

function findBoundary(lines) {
  const commentIdx = lines.findIndex(
    (line) => /^\s*;/.test(line) && /do not move up/i.test(line),
  );
  const keybindsIdx = lines.findIndex((line) => {
    const name = lineName(line);
    return name != null && name.toLowerCase() === "keybinds";
  });
  if (commentIdx >= 0) return { boundary: commentIdx, commentIdx, keybindsIdx };
  if (keybindsIdx >= 0) return { boundary: keybindsIdx, commentIdx, keybindsIdx };
  return { boundary: lines.length, commentIdx, keybindsIdx };
}

/**
 * @param {string} text
 * @param {{name: string, enabled: boolean}[]} owned  mods that should have a line
 * @param {{remove?: string[], folderExists?: (name: string) => boolean}} [options]
 * folderExists: a non-built-in line whose folder is missing is deleted.
 * An owned name whose folder is missing is not inserted.
 * remove: delete these names even when the folder is still there.
 */
function updateModsTxt(text, owned, options) {
  const opts = options || {};
  const parts = splitText(text);
  const remove = new Set((opts.remove || []).map((name) => String(name).toLowerCase()));
  const folderExists = typeof opts.folderExists === "function" ? opts.folderExists : null;

  const wanted = [];
  const wantedByName = new Map();
  for (const entry of owned || []) {
    if (!entry || !entry.name || isBuiltin(entry.name)) continue;
    if (remove.has(entry.name.toLowerCase())) continue;
    if (folderExists && !folderExists(entry.name)) continue;
    if (wantedByName.has(entry.name.toLowerCase())) continue;
    const copy = { name: entry.name, enabled: !!entry.enabled, placed: false };
    wanted.push(copy);
    wantedByName.set(copy.name.toLowerCase(), copy);
  }

  const lines = [];
  for (const line of parts.lines) {
    const name = lineName(line);
    if (!name || isBuiltin(name)) {
      lines.push(line);
      continue;
    }
    if (remove.has(name.toLowerCase())) continue;
    if (folderExists && !folderExists(name) && !wantedByName.has(name.toLowerCase())) continue;
    const ownedEntry = wantedByName.get(name.toLowerCase());
    if (ownedEntry) {
      lines.push(setBit(line, ownedEntry.enabled));
      ownedEntry.placed = true;
      continue;
    }
    lines.push(line);
  }

  const missing = wanted.filter((entry) => !entry.placed);
  if (missing.length > 0) {
    const { boundary, commentIdx, keybindsIdx } = findBoundary(lines);
    let insertAt = 0;
    for (let i = 0; i < boundary; i++) {
      if (lineName(lines[i])) insertAt = i + 1;
    }
    const added = missing.map((entry) => `${entry.name} : ${entry.enabled ? "1" : "0"}`);
    lines.splice(insertAt, 0, ...added);
    if (commentIdx < 0 && keybindsIdx < 0) lines.push("Keybinds : 1");
  }

  return joinText({ bom: parts.bom, nl: parts.nl, lines });
}

function orderValue(entry) {
  const value = entry && entry.order;
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function compareOrder(a, b) {
  const delta = orderValue(a) - orderValue(b);
  if (delta !== 0) return delta;
  const left = String(a.name || "").toLowerCase();
  const right = String(b.name || "").toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// A missing order follows the current mods.txt line, so the first move
// keeps the file order. A name that is not in the file sorts last.
function assignMissingOrder(entries, text) {
  const parts = splitText(text || "");
  const lineIndex = new Map();
  let next = 0;
  for (const line of parts.lines) {
    const name = lineName(line);
    if (!name || isBuiltin(name)) continue;
    const key = name.toLowerCase();
    if (lineIndex.has(key)) continue;
    lineIndex.set(key, next);
    next += 1;
  }
  return (entries || []).map((entry) => {
    if (!entry) return entry;
    if (typeof entry.order === "number" && Number.isFinite(entry.order)) return entry;
    const idx = lineIndex.get(String(entry.name || "").toLowerCase());
    return { ...entry, order: idx === undefined ? Number.POSITIVE_INFINITY : idx };
  });
}

function orderedNames(entries) {
  return enabledSorted(entries).map((entry) => entry.name);
}

function enabledSorted(entries) {
  return (entries || [])
    .filter((entry) => entry && entry.enabled === true && entry.name && !isBuiltin(entry.name))
    .slice()
    .sort(compareOrder);
}

function applyCheckedOrder(list, ordered) {
  const orderBy = new Map();
  ordered.forEach((entry, pos) => orderBy.set(String(entry.name).toLowerCase(), pos));
  return list.map((entry) => {
    const pos = orderBy.get(String((entry && entry.name) || "").toLowerCase());
    if (pos === undefined || !entry || entry.enabled !== true) return entry;
    return { ...entry, order: pos };
  });
}

// Lift one checked mod out and insert it at a 1-based index among checked mods.
// Disabled rows stay out of the move. After a real move, checked rows are
// numbered 0, 1, 2 so a new mod sorts last. The current index is left as-is.
function placeUe4ss(entries, name, oneBased) {
  const list = (entries || []).map((entry) => ({ ...entry }));
  const enabled = enabledSorted(list);
  const key = String(name || "").toLowerCase();
  const index = enabled.findIndex((entry) => String(entry.name).toLowerCase() === key);
  const dest = Number(oneBased) - 1;
  if (index < 0 || !Number.isInteger(dest) || dest < 0 || dest >= enabled.length || dest === index) {
    return list;
  }
  const next = enabled.slice();
  const held = next[index];
  next.splice(index, 1);
  next.splice(dest, 0, held);
  return applyCheckedOrder(list, next);
}

// Swap one checked mod with its neighbor. Disabled rows stay out of the move.
function moveUe4ss(entries, name, direction) {
  const enabled = enabledSorted(entries);
  const key = String(name || "").toLowerCase();
  const index = enabled.findIndex((entry) => String(entry.name).toLowerCase() === key);
  if (index < 0) return (entries || []).map((entry) => ({ ...entry }));
  return placeUe4ss(entries, name, index + Number(direction) + 1);
}

// Move the named lines among the slots they already occupy, above Keybinds.
// A name that is not already a line is ignored. Built-ins are ignored.
function reorderOwned(text, names) {
  const parts = splitText(text);
  const wanted = [];
  const seen = new Set();
  for (const name of names || []) {
    if (!name || isBuiltin(name)) continue;
    const key = String(name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  if (wanted.length === 0) return text;

  const { boundary } = findBoundary(parts.lines);
  const slots = [];
  const byName = new Map();
  for (let i = 0; i < boundary; i++) {
    const name = lineName(parts.lines[i]);
    if (!name || isBuiltin(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key) || byName.has(key)) continue;
    slots.push(i);
    byName.set(key, parts.lines[i]);
  }
  const present = wanted.filter((key) => byName.has(key));
  if (present.length === 0) return text;

  const lines = parts.lines.slice();
  present.forEach((key, idx) => {
    lines[slots[idx]] = byName.get(key);
  });
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== parts.lines[i]) return joinText({ bom: parts.bom, nl: parts.nl, lines });
  }
  return text;
}

function updateLogicOrder(text, keepNames) {
  const parts = splitText(text);
  const keep = new Set((keepNames || []).map((name) => String(name).toLowerCase()));
  const seen = new Set();
  const lines = [];
  for (const line of parts.lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";")) {
      lines.push(line);
      continue;
    }
    const name = lineName(line) || trimmed;
    if (!keep.has(name.toLowerCase())) continue;
    lines.push(line);
    seen.add(name.toLowerCase());
  }
  for (const name of keepNames || []) {
    if (seen.has(String(name).toLowerCase())) continue;
    lines.push(`${name} : 1`);
    seen.add(String(name).toLowerCase());
  }
  return joinText({ bom: parts.bom, nl: parts.lines.length === 0 && !(text || "").includes("\n") ? "\r\n" : parts.nl, lines });
}

module.exports = {
  BOM,
  BUILTINS,
  KEYBINDS_COMMENT,
  isBuiltin,
  lineName,
  assignMissingOrder,
  orderedNames,
  moveUe4ss,
  placeUe4ss,
  reorderOwned,
  updateModsTxt,
  updateLogicOrder,
};
