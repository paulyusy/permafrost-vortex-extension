const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildPeWithExports,
  buildZip,
  mergeIni,
  mergeIniTaking,
  openIniConflicts,
  rememberKeptConflicts,
  dropKeptConflicts,
  planIniMerge,
  modLoaderApiPrompt,
  modLoaderOwnershipConflicts,
  peExportNames,
  planModLoaderTool,
  prepareModLoader,
  MODLOADER_TOOL_ID,
} = require("./modloader");
const { GAME_ID, installPak, installScripts, testModLoader, testPak } = require("./install");

const API = ["PermafrostModQuery", "PermafrostModLoad", "PermafrostModUnload"];
const INI = [
  "[Mods]",
  "permafrost.chestsize=1",
  "",
  "[Mod.permafrost.chestsize]",
  "SmallWoodenChestSlots=30",
  "WoodenChestSlots=60",
  "",
].join("\r\n");

function zipOf(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-ml-"));
  const zipPath = path.join(dir, "mod.zip");
  fs.writeFileSync(zipPath, buildZip(files));
  return { dir, zipPath, names: files.map((file) => file.name) };
}

test("peExportNames reads Mod API exports and ignores an image with none", () => {
  assert.deepEqual(peExportNames(buildPeWithExports(API)).sort(), [...API].sort());
  assert.deepEqual(peExportNames(buildPeWithExports([])), []);
  assert.deepEqual(peExportNames(Buffer.from("not a pe")), []);
});

test("an API DLL deploys to Mods and warns when no ini ships", () => {
  const packed = zipOf([
    { name: "PermafrostChestSize.dll", data: buildPeWithExports(API), deflate: true },
  ]);
  try {
    const prepared = prepareModLoader(packed.names, null, packed.zipPath);
    assert.equal(prepared.claim, true);
    assert.deepEqual(prepared.apiDlls, ["PermafrostChestSize.dll"]);
    assert.equal(prepared.needsManualIni, true);
    assert.equal(prepared.iniText, null);
    const copy = prepared.instructions.find((item) => item.type === "copy");
    assert.equal(copy.destination, path.join("Mods", "PermafrostChestSize.dll"));
    assert.equal(prepared.instructions.find((item) => item.type === "setmodtype").value, "permafrost-modloader");
  } finally {
    fs.rmSync(packed.dir, { recursive: true, force: true });
  }
});

test("the loader package keeps the game-root layout and does not merge the example ini", () => {
  const packed = zipOf([
    { name: "PermafrostModLoader.exe", data: "exe" },
    { name: "PermafrostModHost.dll", data: buildPeWithExports([]) },
    { name: "Config/PermafrostModLoader.ini.example", data: INI },
    { name: "README.txt", data: "readme" },
    { name: "VALIDATION.txt", data: "ok" },
    { name: "SHA256SUMS.txt", data: "sums" },
  ]);
  try {
    const prepared = prepareModLoader(packed.names, null, packed.zipPath);
    assert.equal(prepared.claim, true);
    assert.deepEqual(prepared.apiDlls, []);
    assert.equal(prepared.needsManualIni, false);
    assert.equal(prepared.iniText, null);
    const dests = prepared.instructions.filter((item) => item.type === "copy").map((item) => item.destination);
    assert.deepEqual(dests.sort(), [
      "PermafrostModHost.dll",
      "PermafrostModLoader.exe",
      "README.txt",
      "SHA256SUMS.txt",
      "VALIDATION.txt",
      path.join("Config", "PermafrostModLoader.ini.example"),
    ].sort());
  } finally {
    fs.rmSync(packed.dir, { recursive: true, force: true });
  }
});

test("an ini at the archive root or under Config is stored for the merge", () => {
  const rootIni = zipOf([
    { name: "PermafrostChestSize.dll", data: buildPeWithExports(API) },
    { name: "PermafrostModLoader.ini", data: INI },
  ]);
  const configIni = zipOf([
    { name: "Chest/PermafrostChestSize.dll", data: buildPeWithExports(API) },
    { name: "Chest/Config/PermafrostModLoader.ini", data: INI },
  ]);
  try {
    const fromRoot = prepareModLoader(rootIni.names, null, rootIni.zipPath);
    assert.equal(fromRoot.needsManualIni, false);
    assert.equal(fromRoot.iniText, INI);
    assert.equal(
      fromRoot.instructions.some((item) => item.type === "copy" && item.destination.toLowerCase().endsWith(".ini")),
      false,
    );
    const fromConfig = prepareModLoader(configIni.names, null, configIni.zipPath);
    assert.equal(fromConfig.iniText, INI);
    assert.equal(fromConfig.instructions.find((item) => item.type === "copy").destination, path.join("Mods", "PermafrostChestSize.dll"));
  } finally {
    fs.rmSync(rootIni.dir, { recursive: true, force: true });
    fs.rmSync(configIni.dir, { recursive: true, force: true });
  }
});

test("ini merge creates, appends, keeps equal values, and leaves conflicts unchanged", () => {
  const created = mergeIni("", INI, false);
  assert.equal(created.created, true);
  assert.equal(created.text, INI);
  assert.deepEqual(created.conflicts, []);

  const existing = "[Mods]\r\npermafrost.chestsize=1\r\n";
  const incoming = "[Mods]\r\npermafrost.chestsize=1\r\nextra.mod=1\r\n\r\n[Mod.permafrost.chestsize]\r\nSmallWoodenChestSlots=40\r\n";
  const kept = mergeIni(existing, incoming, false);
  assert.equal(kept.conflicts.length, 0);
  assert.match(kept.text, /extra\.mod=1/);
  assert.match(kept.text, /\[Mod\.permafrost\.chestsize\]/);
  assert.match(kept.text, /SmallWoodenChestSlots=40/);
  assert.match(kept.text, /permafrost\.chestsize=1/);

  const clashExisting = "[Mod.permafrost.chestsize]\r\nSmallWoodenChestSlots=30\r\n";
  const clashIncoming = "[Mod.permafrost.chestsize]\r\nSmallWoodenChestSlots=99\r\nWoodenChestSlots=60\r\n";
  const held = mergeIni(clashExisting, clashIncoming, false);
  assert.deepEqual(held.conflicts, [
    {
      section: "Mod.permafrost.chestsize",
      key: "SmallWoodenChestSlots",
      existing: "30",
      incoming: "99",
    },
  ]);
  assert.match(held.text, /SmallWoodenChestSlots=30/);
  assert.match(held.text, /WoodenChestSlots=60/);
  const taken = mergeIni(clashExisting, clashIncoming, true);
  assert.match(taken.text, /SmallWoodenChestSlots=99/);
  assert.match(taken.text, /WoodenChestSlots=60/);
});

test("a kept AllowUnknownBuildMods choice is not asked again", () => {
  const existing = "[Compatibility]\r\nAllowUnknownBuildMods=1\r\n";
  const incoming = "[Compatibility]\r\nAllowUnknownBuildMods=0\r\nextra.mod=1\r\n";
  const merged = mergeIni(existing, incoming, false);
  assert.deepEqual(merged.conflicts, [
    {
      section: "Compatibility",
      key: "AllowUnknownBuildMods",
      existing: "1",
      incoming: "0",
    },
  ]);
  assert.match(merged.text, /AllowUnknownBuildMods=1/);
  assert.match(merged.text, /extra\.mod=1/);
  const kept = [{
    section: "compatibility",
    key: "allowunknownbuildmods",
    existing: "1",
    incoming: "0",
  }];
  assert.deepEqual(openIniConflicts(merged.conflicts, kept), []);
  const remembered = rememberKeptConflicts([], merged.conflicts);
  assert.deepEqual(openIniConflicts(merged.conflicts, remembered), []);

  const edited = mergeIni("[Compatibility]\r\nAllowUnknownBuildMods=5\r\n", incoming, false);
  assert.equal(openIniConflicts(edited.conflicts, kept).length, 1);
  const moved = mergeIni(existing, "[Compatibility]\r\nAllowUnknownBuildMods=2\r\n", false);
  assert.equal(openIniConflicts(moved.conflicts, kept).length, 1);
});

test("an already deployed ini is not merged again until its stored text changes", () => {
  const ini = "[Mod.myway.direct]\r\nMeleeMultiplier=1\r\n";
  assert.deepEqual(planIniMerge({ ini, alreadyDeployed: true, applied: null }), { merge: false, stamp: true });
  assert.deepEqual(planIniMerge({ ini, alreadyDeployed: true, applied: ini }), { merge: false, stamp: false });
  assert.deepEqual(
    planIniMerge({ ini: ini + "RangedMultiplier=1\r\n", alreadyDeployed: true, applied: ini }),
    { merge: true, stamp: true },
  );
  assert.deepEqual(planIniMerge({ ini, alreadyDeployed: false, applied: null }), { merge: true, stamp: true });
  assert.deepEqual(planIniMerge({ ini, alreadyDeployed: false, applied: ini }), { merge: true, stamp: false });
  assert.deepEqual(planIniMerge({ ini: "", alreadyDeployed: true, applied: null }), { merge: false, stamp: false });
});

test("a chest fragment does not conflict on MyWayDirect multipliers", () => {
  const live = [
    "[Mod.myway.direct]",
    "MeleeMultiplier=3",
    "RangedMultiplier=3",
    "ChopMultiplier=3",
    "MiningMultiplier=3",
    "SkillExperienceGain=10",
    "",
    "[Mod.permafrost.chestsize]",
    "SmallWoodenChestSlots=20",
    "WoodenChestSlots=40",
    "",
  ].join("\r\n");
  const chest = [
    "[Mods]",
    "permafrost.chestsize=1",
    "",
    "[Mod.permafrost.chestsize]",
    "SmallWoodenChestSlots=0",
    "WoodenChestSlots=0",
    "",
  ].join("\r\n");
  const myway = [
    "[Mod.myway.direct]",
    "MeleeMultiplier=1",
    "RangedMultiplier=1",
    "ChopMultiplier=1",
    "MiningMultiplier=1",
    "SkillExperienceGain=1",
    "",
  ].join("\r\n");
  const fromChest = mergeIni(live, chest, false);
  assert.deepEqual(fromChest.conflicts.map((item) => item.key), ["SmallWoodenChestSlots", "WoodenChestSlots"]);
  const fromMyway = mergeIni(live, myway, false);
  assert.deepEqual(
    fromMyway.conflicts.map((item) => item.key),
    ["MeleeMultiplier", "RangedMultiplier", "ChopMultiplier", "MiningMultiplier", "SkillExperienceGain"],
  );
  assert.equal(planIniMerge({ ini: myway, alreadyDeployed: true, applied: null }).merge, false);
});

test("a fragment that omits AllowUnknownBuildMods has no conflict for that key", () => {
  const existing = "[Compatibility]\r\nAllowUnknownBuildMods=1\r\n";
  const fragment = "[Mods]\r\npermafrost.mywaydirect=1\r\n";
  const merged = mergeIni(existing, fragment, false);
  assert.deepEqual(merged.conflicts, []);
  assert.match(merged.text, /AllowUnknownBuildMods=1/);
  assert.match(merged.text, /permafrost\.mywaydirect=1/);
});

test("Use the mod values rewrites the chosen key and drops that remembered choice", () => {
  const existing = "[Compatibility]\r\nAllowUnknownBuildMods=1\r\nOther=1\r\n";
  const incoming = "[Compatibility]\r\nAllowUnknownBuildMods=0\r\nOther=2\r\n";
  const merged = mergeIni(existing, incoming, false);
  const other = merged.conflicts.filter((item) => item.key === "Other");
  const taken = mergeIniTaking(existing, incoming, other);
  assert.match(taken.text, /AllowUnknownBuildMods=1/);
  assert.match(taken.text, /Other=2/);
  const kept = rememberKeptConflicts([], merged.conflicts);
  assert.deepEqual(dropKeptConflicts(kept, other), [{
    section: "Compatibility",
    key: "AllowUnknownBuildMods",
    existing: "1",
    incoming: "0",
  }]);
  const all = mergeIni(existing, incoming, true);
  assert.match(all.text, /AllowUnknownBuildMods=0/);
  assert.match(all.text, /Other=2/);
  assert.deepEqual(dropKeptConflicts(kept, all.conflicts), []);
});

test("a pak archive that also contains a DLL is rejected and is not a pak install", async () => {
  const files = ["Something.pak", "PermafrostChestSize.dll"];
  const pak = await testPak(files, GAME_ID);
  assert.equal(pak.supported, true);
  await assert.rejects(installPak(files, "Something.zip"), /PermafrostChestSize\.dll/);
  const packed = zipOf([{ name: "PermafrostChestSize.dll", data: buildPeWithExports(API) }, { name: "Something.pak", data: "pak" }]);
  try {
    const claim = await testModLoader(packed.names, GAME_ID, packed.zipPath);
    assert.equal(claim.supported, false);
  } finally {
    fs.rmSync(packed.dir, { recursive: true, force: true });
  }
});

test("a lone DLL is not a pak, and a UE4SS dlls folder still installs", async () => {
  const lone = await testPak(["PermafrostChestSize.dll"], GAME_ID);
  assert.equal(lone.supported, false);
  const dlls = await installScripts(["Widget/dlls/main.dll", "Widget/dlls/extra/plugin.dll"], "Widget.zip");
  const dests = dlls.instructions.filter((item) => item.type === "copy").map((item) => item.destination);
  assert.ok(dests.some((dest) => dest.endsWith(path.join("dlls", "main.dll"))));
  const withExe = await installScripts(
    ["Widget/Scripts/main.lua", "Widget/helper.exe"],
    "Widget.zip",
  );
  const exeDests = withExe.instructions.filter((item) => item.type === "copy").map((item) => item.destination);
  assert.ok(exeDests.some((dest) => dest.endsWith(path.join("Widget", "helper.exe"))));
  await assert.rejects(
    installScripts(["Widget/Scripts/main.lua", "PermafrostModLoader.exe"], "Widget.zip"),
    /PermafrostModLoader\.exe/,
  );
});

test("an API DLL skips the dialog when the loader exe and host are both present", () => {
  assert.equal(modLoaderApiPrompt(true, true), null);
  const neither = modLoaderApiPrompt(false, false);
  assert.equal(neither.title, "Install the ModLoader API first");
  assert.match(neither.text, /PermafrostModLoader\.exe and PermafrostModHost\.dll are not in the game folder/);
  assert.equal(neither.text.includes("[font="), false);
  assert.equal(neither.text.includes("PermafrostHost.dll"), false);
  const exeMissing = modLoaderApiPrompt(false, true);
  assert.match(exeMissing.text, /PermafrostModHost\.dll is in the game folder/);
  assert.match(exeMissing.text, /Install PermafrostModLoader\.exe/);
  assert.equal(exeMissing.text.includes("Install PermafrostModHost.dll"), false);
  const hostMissing = modLoaderApiPrompt(true, false);
  assert.match(hostMissing.text, /PermafrostModLoader\.exe is in the game folder/);
  assert.match(hostMissing.text, /Install PermafrostModHost\.dll/);
  assert.equal(hostMissing.text.includes("Install PermafrostModLoader.exe"), false);
});

test("the loader tool is pinned while its exe exists and a user choice is kept", () => {
  const fresh = planModLoaderTool({
    exeExists: true,
    discovered: null,
    primary: undefined,
    pinned: undefined,
    pinnedCount: 0,
  });
  assert.equal(fresh.register.id, MODLOADER_TOOL_ID);
  assert.equal(fresh.register.name, "Permafrost ModLoader API");
  assert.deepEqual(fresh.register.requiredFiles, ["PermafrostModLoader.exe"]);
  assert.equal(fresh.register.custom, false);
  assert.equal(fresh.pin, true);
  assert.equal(fresh.clearPrimary, false);
  assert.equal(fresh.forget, false);

  const unpinned = planModLoaderTool({
    exeExists: true,
    discovered: { custom: false },
    pinned: false,
    pinnedCount: 0,
  });
  assert.ok(unpinned.register);
  assert.equal(unpinned.pin, false);

  const already = planModLoaderTool({ exeExists: true, discovered: null, pinned: true, pinnedCount: 1 });
  assert.equal(already.pin, false);

  const full = planModLoaderTool({ exeExists: true, discovered: null, pinned: undefined, pinnedCount: 10 });
  assert.equal(full.pin, false);
  assert.ok(full.register);

  const edited = planModLoaderTool({
    exeExists: true,
    discovered: { custom: true, path: "C:\\kept\\PermafrostModLoader.exe", name: "Mine" },
    pinned: undefined,
    pinnedCount: 0,
  });
  assert.equal(edited.register, null);
  assert.equal(edited.pin, true);
  assert.equal(edited.clearPrimary, false);

  const userPrimary = planModLoaderTool({
    exeExists: true,
    discovered: { custom: false },
    primary: MODLOADER_TOOL_ID,
    pinned: undefined,
    pinnedCount: 0,
  });
  assert.equal(userPrimary.clearPrimary, false);
  assert.equal(userPrimary.pin, true);

  const autoPrimary = planModLoaderTool({
    exeExists: true,
    discovered: { custom: false, ownedPrimary: true },
    primary: MODLOADER_TOOL_ID,
    pinned: true,
    pinnedCount: 0,
  });
  assert.equal(autoPrimary.clearPrimary, true);
  assert.equal(autoPrimary.releaseOwnedPrimary, false);

  const userChanged = planModLoaderTool({
    exeExists: true,
    discovered: { ownedPrimary: true },
    primary: "other-tool",
    pinned: undefined,
    pinnedCount: 0,
  });
  assert.equal(userChanged.clearPrimary, false);
  assert.equal(userChanged.releaseOwnedPrimary, true);

  const gone = planModLoaderTool({
    exeExists: false,
    discovered: { custom: false, ownedPrimary: true },
    primary: MODLOADER_TOOL_ID,
  });
  assert.equal(gone.register, null);
  assert.equal(gone.pin, false);
  assert.equal(gone.clearPrimary, true);
  assert.equal(gone.forget, true);

  const userKept = planModLoaderTool({
    exeExists: false,
    discovered: { custom: false },
    primary: MODLOADER_TOOL_ID,
  });
  assert.equal(userKept.clearPrimary, false);
  assert.equal(userKept.forget, true);

  const editedStays = planModLoaderTool({
    exeExists: false,
    discovered: { custom: true },
    primary: MODLOADER_TOOL_ID,
  });
  assert.equal(editedStays.forget, false);
  assert.equal(editedStays.clearPrimary, false);
});

test("ownership keeps the deployed loader and cancels the new one", () => {
  const records = [
    { id: "old", name: "Loader Old", files: ["PermafrostModLoader.exe"], deployed: true },
    { id: "new", name: "Loader New", files: ["PermafrostModLoader.exe"], deployed: false },
  ];
  const conflicts = modLoaderOwnershipConflicts(records, ["old", "new"]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].modId, "new");
  assert.equal(conflicts[0].owner, "Loader Old");
});
