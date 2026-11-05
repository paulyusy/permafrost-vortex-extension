const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { updateModsTxt } = require("./mods-txt");
const {
  GAME_ID,
  SCRIPTS_ID,
  PAK_ID,
  MIXED_ID,
  PAKS_DIR,
  LOGIC_REL,
  MODS_REL,
  installPak,
  installScripts,
  testPak,
  testScripts,
  removeDeployed,
  preserveModConfig,
  restoreModConfig,
  dropModLine,
  listPakContainers,
  findPakConflicts,
  pakConflictLines,
  withoutPakKeepers,
  keepersFromDeployment,
  protectedModIds,
  planPakRenames,
  pakRenamePreviewLines,
  renamePakFiles,
  applyStagedPakRenames,
  ensureLogicModsDir,
  ensureDeployDirs,
  modTypeOptions,
} = require("./install");

const FIXTURE_FILES = [
  "MoreBackpackSlots/Scripts/main.lua",
  "MoreBackpackSlots/readme.txt",
  "Something.pak",
  "Something.ucas",
  "Permafrost-Windows.pak",
];

function copies(instructions) {
  return instructions.filter((item) => item.type === "copy");
}

function attr(instructions, key) {
  return instructions.find((item) => item.type === "attribute" && item.key === key);
}

function modType(instructions) {
  return instructions.find((item) => item.type === "setmodtype").value;
}

function segments(dest) {
  return String(dest).split(/[\\/]/).filter(Boolean).map((part) => part.toLowerCase());
}

describe("mixed archive", () => {
  it("is claimed by both installers", async () => {
    const scripts = await testScripts(FIXTURE_FILES, GAME_ID);
    const pak = await testPak(FIXTURE_FILES, GAME_ID);
    assert.equal(scripts.supported, true);
    assert.equal(pak.supported, true);
  });

  it("installs the script folder and the pak side, and skips the shipping pak", async () => {
    const scriptResult = await installScripts(FIXTURE_FILES, "MoreBackpackSlots.zip");
    const pakResult = await installPak(FIXTURE_FILES, "MoreBackpackSlots.zip");
    const scriptCopies = copies(scriptResult.instructions);
    const pakCopies = copies(pakResult.instructions);

    const scriptDest = scriptCopies.map((item) => item.destination);
    assert.ok(
      scriptDest.includes(path.join("Permafrost", "Binaries", "Win64", "ue4ss", "Mods", "MoreBackpackSlots", "Scripts", "main.lua")),
    );
    assert.ok(scriptDest.includes(path.join("Permafrost", "Content", "Paks", "Something.pak")));
    assert.ok(scriptDest.includes(path.join("Permafrost", "Content", "Paks", "Something.ucas")));
    assert.ok(scriptDest.includes(path.join("Permafrost", "Content", "Paks", "readme.txt")));
    assert.ok(!scriptDest.some((dest) => /readme\.txt$/i.test(dest) && /Mods/.test(dest)));
    assert.ok(!scriptDest.some((dest) => /Permafrost-Windows/i.test(dest)));
    assert.equal(modType(scriptResult.instructions), MIXED_ID);

    const folder = attr(scriptResult.instructions, "ue4ssModFolder");
    const paks = attr(scriptResult.instructions, "pakFiles");
    assert.equal(folder.value, "MoreBackpackSlots");
    const names = paks.value.map((entry) => entry.name).sort();
    assert.deepEqual(names, ["Something.pak", "Something.ucas", "readme.txt"].sort());
    for (const entry of paks.value) {
      assert.equal(path.normalize(entry.dir), path.normalize(PAKS_DIR));
    }
    assert.ok(!paks.value.some((entry) => /Permafrost-Windows/i.test(entry.name)));
    for (const dest of scriptDest) {
      if (segments(dest).includes("main.lua")) assert.ok(segments(dest).includes("scripts"));
      else assert.ok(!segments(dest).includes("scripts"));
      assert.ok(!segments(dest).includes("dlls"));
    }

    const pakNames = pakCopies.map((item) => item.destination).sort();
    assert.deepEqual(pakNames, ["Something.pak", "Something.ucas", "readme.txt"].sort());
  });

  it("removes the folder, the pak, the readme, and the mods.txt line", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-ext-"));
    try {
      const modsDir = path.join(root, "Binaries", "Win64", "ue4ss", "Mods");
      const paksDir = path.join(root, "Content", "Paks");
      const modFolder = path.join(modsDir, "MoreBackpackSlots");
      fs.mkdirSync(modFolder, { recursive: true });
      fs.mkdirSync(paksDir, { recursive: true });
      fs.writeFileSync(path.join(modFolder, "main.lua"), "return {}\r\n");
      fs.writeFileSync(path.join(paksDir, "Something.pak"), "pak");
      fs.writeFileSync(path.join(paksDir, "readme.txt"), "hello");
      fs.writeFileSync(path.join(paksDir, "Permafrost-Windows.pak"), "shipping");

      const builtin = "\uFEFFCheatManagerEnablerMod : 1\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n";
      const withMod = updateModsTxt(builtin, [{ name: "MoreBackpackSlots", enabled: true }]);
      fs.writeFileSync(path.join(modsDir, "mods.txt"), withMod, "utf8");

      removeDeployed({
        projectRoot: root,
        ue4ssModFolder: "MoreBackpackSlots",
        pakFiles: [
          { dir: PAKS_DIR, name: "Something.pak" },
          { dir: PAKS_DIR, name: "readme.txt" },
          { dir: PAKS_DIR, name: "Permafrost-Windows.pak" },
        ],
      });

      assert.equal(fs.existsSync(path.join(modsDir, "MoreBackpackSlots")), false);
      assert.equal(fs.existsSync(path.join(paksDir, "Something.pak")), false);
      assert.equal(fs.existsSync(path.join(paksDir, "readme.txt")), false);
      assert.equal(fs.readFileSync(path.join(paksDir, "Permafrost-Windows.pak"), "utf8"), "shipping");
      const text = fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8");
      assert.ok(!text.includes("MoreBackpackSlots"));
      assert.ok(text.includes("Keybinds : 1"));
      assert.ok(text.includes("CheatManagerEnablerMod : 1"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops the mods.txt line and leaves the deployed folder for the activator", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-ext-"));
    try {
      const modsDir = path.join(root, "Binaries", "Win64", "ue4ss", "Mods");
      const modFolder = path.join(modsDir, "TestMod");
      fs.mkdirSync(path.join(modFolder, "lib"), { recursive: true });
      fs.writeFileSync(path.join(modFolder, "main.lua"), "return {}\r\n");
      fs.writeFileSync(path.join(modFolder, "lib", "util.lua"), "return {}\r\n");
      const builtin = "\uFEFFCheatManagerEnablerMod : 1\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n";
      const withMod = updateModsTxt(builtin, [{ name: "TestMod", enabled: true }]);
      fs.writeFileSync(path.join(modsDir, "mods.txt"), withMod, "utf8");

      dropModLine({ projectRoot: root, ue4ssModFolder: "TestMod" });

      assert.equal(fs.readFileSync(path.join(modFolder, "main.lua"), "utf8"), "return {}\r\n");
      assert.equal(fs.readFileSync(path.join(modFolder, "lib", "util.lua"), "utf8"), "return {}\r\n");
      assert.ok(!fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("TestMod"));
      const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
      assert.match(source, /dropModLine\(\{/);
      assert.match(source, /onAsync\("did-remove-mod"/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a script folder and pak the activator already removed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-ext-"));
    try {
      const modsDir = path.join(root, "Binaries", "Win64", "ue4ss", "Mods");
      const paksDir = path.join(root, "Content", "Paks");
      fs.mkdirSync(modsDir, { recursive: true });
      fs.mkdirSync(paksDir, { recursive: true });
      fs.writeFileSync(path.join(paksDir, "Permafrost-Windows.pak"), "shipping");
      const builtin = "\uFEFFCheatManagerEnablerMod : 1\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n";
      const withMod = updateModsTxt(builtin, [{ name: "TestMod", enabled: true }]);
      fs.writeFileSync(path.join(modsDir, "mods.txt"), withMod, "utf8");

      removeDeployed({
        projectRoot: root,
        ue4ssModFolder: "TestMod",
        pakFiles: [
          { dir: PAKS_DIR, name: "TestMod.pak" },
          { dir: PAKS_DIR, name: "TestMod.txt" },
          { dir: "Content\\Paks\\LogicMods", name: "TestMod.pak" },
          { dir: PAKS_DIR, name: "Permafrost-Windows.pak" },
        ],
      });

      assert.equal(fs.existsSync(path.join(modsDir, "TestMod")), false);
      assert.equal(fs.readFileSync(path.join(paksDir, "Permafrost-Windows.pak"), "utf8"), "shipping");
      assert.ok(!fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("TestMod"));
      assert.equal(fs.existsSync(path.join(paksDir, "LogicMods")), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function scriptFixture(name) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-ext-"));
    const modsDir = path.join(root, "Binaries", "Win64", "ue4ss", "Mods");
    const modFolder = path.join(modsDir, name);
    fs.mkdirSync(path.join(modFolder, "lib"), { recursive: true });
    const builtin = "\uFEFFCheatManagerEnablerMod : 1\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n";
    fs.writeFileSync(path.join(modsDir, "mods.txt"), updateModsTxt(builtin, [{ name, enabled: true }]), "utf8");
    return { root, modsDir, modFolder };
  }

  function emptyDirError() {
    const err = new Error("ENOTEMPTY");
    err.code = "ENOTEMPTY";
    return err;
  }

  it("removes a script folder that still holds Vortex directory markers", () => {
    const { root, modsDir, modFolder } = scriptFixture("ScriptOnly");
    try {
      fs.writeFileSync(path.join(modFolder, "main.lua"), "return {}\r\n");
      fs.writeFileSync(path.join(modFolder, "lib", "util.lua"), "return {}\r\n");
      fs.writeFileSync(path.join(modFolder, "__folder_managed_by_vortex"), "marker");
      fs.writeFileSync(path.join(modFolder, "lib", "__folder_managed_by_vortex"), "marker");
      fs.writeFileSync(path.join(modFolder, "__delete_if_empty"), "old");

      const note = removeDeployed({ projectRoot: root, ue4ssModFolder: "ScriptOnly" });

      assert.equal(note, null);
      assert.equal(fs.existsSync(modFolder), false);
      assert.ok(!fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("ScriptOnly"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a script folder that is briefly not empty and still drops the line", () => {
    const { root, modsDir, modFolder } = scriptFixture("DllOnly");
    try {
      fs.writeFileSync(path.join(modFolder, "main.lua"), "return {}\r\n");
      fs.writeFileSync(path.join(modFolder, "lib", "note.txt"), "note");
      fs.writeFileSync(path.join(modFolder, "__folder_managed_by_vortex"), "marker");
      let calls = 0;

      const note = removeDeployed({
        projectRoot: root,
        ue4ssModFolder: "DllOnly",
        rmSync(target, options) {
          calls += 1;
          assert.equal(options.maxRetries, 5);
          assert.equal(options.retryDelay, 100);
          assert.equal(options.recursive, true);
          if (calls === 1) throw emptyDirError();
          fs.rmSync(target, { recursive: true, force: true });
        },
      });

      assert.equal(note, null);
      assert.equal(calls, 2);
      assert.equal(fs.existsSync(modFolder), false);
      assert.ok(!fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("DllOnly"));
      const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
      assert.match(source, /if \(note\) log\("info", note\)/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops the mods.txt line when the script folder delete keeps failing", () => {
    const { root, modsDir, modFolder } = scriptFixture("ScriptOnly");
    try {
      fs.writeFileSync(path.join(modFolder, "main.lua"), "return {}\r\n");
      let calls = 0;

      assert.throws(
        () => removeDeployed({
          projectRoot: root,
          ue4ssModFolder: "ScriptOnly",
          rmSync() {
            calls += 1;
            throw emptyDirError();
          },
        }),
        (err) => err && err.code === "ENOTEMPTY",
      );

      assert.equal(calls, 6);
      assert.equal(fs.readFileSync(path.join(modFolder, "main.lua"), "utf8"), "return {}\r\n");
      assert.ok(!fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("ScriptOnly"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fail uninstall when only Vortex folder markers remain", () => {
    const { root, modsDir, modFolder } = scriptFixture("DllOnly");
    try {
      fs.writeFileSync(path.join(modFolder, "__folder_managed_by_vortex"), "marker");
      fs.writeFileSync(path.join(modFolder, "lib", "__delete_if_empty"), "old");

      const note = removeDeployed({
        projectRoot: root,
        ue4ssModFolder: "DllOnly",
        rmSync() {
          throw emptyDirError();
        },
      });

      assert.match(note, /empty mod folder: DllOnly/);
      assert.equal(fs.existsSync(path.join(modFolder, "main.lua")), false);
      assert.ok(!fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("DllOnly"));
      assert.ok(fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("Keybinds : 1"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves files and a script folder that another mod still records", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-ext-"));
    try {
      const modsDir = path.join(root, "Binaries", "Win64", "ue4ss", "Mods");
      const paksDir = path.join(root, "Content", "Paks");
      const logicDir = path.join(paksDir, "LogicMods");
      const folder = path.join(modsDir, "WideClaim");
      fs.mkdirSync(folder, { recursive: true });
      fs.mkdirSync(logicDir, { recursive: true });
      fs.writeFileSync(path.join(folder, "main.lua"), "keeper\r\n");
      fs.writeFileSync(path.join(paksDir, "Wide.pak"), "SMOKE WideClaim pak");
      fs.writeFileSync(path.join(logicDir, "Wide.pak"), "SMOKE WideClaim logic");
      fs.writeFileSync(path.join(paksDir, "OtherNote.txt"), "SMOKE WideIncoming extra");
      const builtin = "\uFEFFCheatManagerEnablerMod : 1\r\nWideClaim : 1\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n";
      fs.writeFileSync(path.join(modsDir, "mods.txt"), builtin, "utf8");

      const kept = [
        { dir: PAKS_DIR, name: "Wide.pak" },
        { dir: "Content\\Paks\\LogicMods", name: "Wide.pak" },
      ];
      removeDeployed({
        projectRoot: root,
        ue4ssModFolder: "WideClaim",
        pakFiles: kept.concat([{ dir: PAKS_DIR, name: "OtherNote.txt" }]),
        keptPakFiles: kept,
        keptFolders: ["wideclaim"],
      });

      assert.equal(fs.readFileSync(path.join(paksDir, "Wide.pak"), "utf8"), "SMOKE WideClaim pak");
      assert.equal(fs.readFileSync(path.join(logicDir, "Wide.pak"), "utf8"), "SMOKE WideClaim logic");
      assert.equal(fs.existsSync(path.join(paksDir, "OtherNote.txt")), false);
      assert.equal(fs.readFileSync(path.join(folder, "main.lua"), "utf8"), "keeper\r\n");
      assert.ok(fs.readFileSync(path.join(modsDir, "mods.txt"), "utf8").includes("WideClaim : 1"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps config.lua when the mod folder is deleted and writes it back", () => {
    const { root, modFolder } = scriptFixture("QuickStash");
    try {
      fs.mkdirSync(path.join(modFolder, "Scripts"), { recursive: true });
      fs.writeFileSync(path.join(modFolder, "config.lua"), "root-cfg");
      fs.writeFileSync(path.join(modFolder, "Scripts", "config.lua"), "script-cfg");
      fs.writeFileSync(path.join(modFolder, "Scripts", "main.lua"), "return {}\r\n");
      preserveModConfig(root, "QuickStash");
      fs.rmSync(path.join(modFolder, "config.lua"));
      preserveModConfig(root, "QuickStash");
      const stash = path.join(root, "Binaries", "Win64", "ue4ss", "VortexSettings", "QuickStash");
      assert.equal(fs.readFileSync(path.join(stash, "config.lua"), "utf8"), "root-cfg");

      removeDeployed({ projectRoot: root, ue4ssModFolder: "QuickStash" });
      assert.equal(fs.existsSync(modFolder), false);
      assert.equal(fs.readFileSync(path.join(stash, "config.lua"), "utf8"), "root-cfg");
      assert.equal(fs.readFileSync(path.join(stash, "Scripts", "config.lua"), "utf8"), "script-cfg");

      fs.mkdirSync(path.join(modFolder, "Scripts"), { recursive: true });
      fs.writeFileSync(path.join(modFolder, "config.lua"), "shipped");
      fs.writeFileSync(path.join(modFolder, "Scripts", "config.lua"), "shipped-script");
      assert.equal(restoreModConfig(root, "QuickStash"), true);
      assert.equal(fs.readFileSync(path.join(modFolder, "config.lua"), "utf8"), "root-cfg");
      assert.equal(fs.readFileSync(path.join(modFolder, "Scripts", "config.lua"), "utf8"), "script-cfg");
      assert.equal(fs.existsSync(stash), false);
      assert.equal(restoreModConfig(root, "QuickStash"), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the Scripts and dlls folders", async () => {
    const files = [
      "TestMod/Scripts/main.lua",
      "TestMod/Scripts/lib/util.lua",
      "TestMod/Scripts/notes.txt",
      "TestMod/TestMod.pak",
      "TestMod/TestMod.ucas",
      "TestMod/TestMod.utoc",
      "TestMod/TestMod.txt",
      "TestMod/LogicMods/TestMod.pak",
      "TestMod/Permafrost-Windows.pak",
    ];
    const result = await installScripts(files, "TestMod-mixed-fixture.zip");
    const dests = copies(result.instructions).map((item) => item.destination);
    assert.equal(modType(result.instructions), MIXED_ID);
    assert.equal(attr(result.instructions, "ue4ssModFolder").value, "TestMod");
    assert.deepEqual(dests.sort(), [
      path.join("Permafrost", "Binaries", "Win64", "ue4ss", "Mods", "TestMod", "Scripts", "main.lua"),
      path.join("Permafrost", "Binaries", "Win64", "ue4ss", "Mods", "TestMod", "Scripts", "lib", "util.lua"),
      path.join("Permafrost", "Binaries", "Win64", "ue4ss", "Mods", "TestMod", "Scripts", "notes.txt"),
      path.join("Permafrost", "Content", "Paks", "TestMod.pak"),
      path.join("Permafrost", "Content", "Paks", "TestMod.ucas"),
      path.join("Permafrost", "Content", "Paks", "TestMod.utoc"),
      path.join("Permafrost", "Content", "Paks", "TestMod.txt"),
      path.join("Permafrost", "Content", "Paks", "LogicMods", "TestMod.pak"),
    ].sort());
    const pakNames = attr(result.instructions, "pakFiles").value.map((entry) => entry.dir + "\\" + entry.name).sort();
    assert.deepEqual(pakNames, [
      "Content\\Paks\\TestMod.pak",
      "Content\\Paks\\TestMod.ucas",
      "Content\\Paks\\TestMod.utoc",
      "Content\\Paks\\TestMod.txt",
      "Content\\Paks\\LogicMods\\TestMod.pak",
    ].sort());
    for (const dest of dests) {
      const parts = segments(dest);
      if (parts.includes("main.lua") || parts.includes("util.lua") || parts.includes("notes.txt")) {
        assert.ok(parts.includes("scripts"));
      } else {
        assert.ok(!parts.includes("scripts"));
      }
    }
    assert.ok(!dests.some((dest) => /Permafrost-Windows/i.test(dest)));

    const dlls = await installScripts(
      ["Widget/dlls/main.dll", "Widget/dlls/extra/plugin.dll"],
      "Widget.zip",
    );
    const dllDests = copies(dlls.instructions).map((item) => item.destination);
    assert.deepEqual(dllDests.sort(), [
      path.join("Widget", "dlls", "extra", "plugin.dll"),
      path.join("Widget", "dlls", "main.dll"),
    ].sort());
    for (const dest of dllDests) assert.ok(segments(dest).includes("dlls"));

    const withScripts = await installScripts(
      [
        "Permafrost/Binaries/Win64/ue4ss/Mods/QuickStashMod/enabled.txt",
        "Permafrost/Binaries/Win64/ue4ss/Mods/QuickStashMod/config.lua",
        "Permafrost/Binaries/Win64/ue4ss/Mods/QuickStashMod/Scripts/main.lua",
        "Permafrost/Binaries/Win64/ue4ss/Mods/QuickStashMod/dlls/main.dll",
        "Permafrost/Binaries/Win64/ue4ss/Mods/QuickStashMod/icons/sort.png",
      ],
      "QuickStashMod.zip",
    );
    const stashDests = copies(withScripts.instructions).map((item) => item.destination);
    assert.equal(modType(withScripts.instructions), SCRIPTS_ID);
    assert.equal(attr(withScripts.instructions, "ue4ssModFolder").value, "QuickStashMod");
    assert.deepEqual(stashDests.sort(), [
      path.join("QuickStashMod", "config.lua"),
      path.join("QuickStashMod", "dlls", "main.dll"),
      path.join("QuickStashMod", "icons", "sort.png"),
      path.join("QuickStashMod", "Scripts", "main.lua"),
    ].sort());
    assert.ok(!stashDests.some((dest) => dest.toLowerCase().endsWith("enabled.txt")));

    await assert.rejects(
      installScripts(
        [
          "QuickStashMod/Scripts/main.lua",
          "QuickStashMod/dlls/main.dll",
          "PermafrostModLoader.exe",
        ],
        "QuickStashMod.zip",
      ),
      /PermafrostModLoader\.exe/,
    );
  });

  it("keeps a script-only archive on the script mod type", async () => {
    const files = ["MoreBackpackSlots/Scripts/main.lua"];
    const result = await installScripts(files, "MoreBackpackSlots.zip");
    assert.equal(modType(result.instructions), SCRIPTS_ID);
    assert.equal(attr(result.instructions, "pakFiles"), undefined);
    assert.equal(attr(result.instructions, "ue4ssModFolder").value, "MoreBackpackSlots");
    assert.equal(
      copies(result.instructions)[0].destination,
      path.join("MoreBackpackSlots", "Scripts", "main.lua"),
    );
  });

  it("keeps a cfg beside main.lua inside Scripts", async () => {
    const files = [
      "Permafrost-MyWay/Scripts/main.lua",
      "Permafrost-MyWay/Scripts/Permafrost-MyWay.cfg",
    ];
    const result = await installScripts(files, "Permafrost-MyWay-1.0.0.zip");
    const dests = copies(result.instructions).map((item) => item.destination).sort();
    assert.deepEqual(dests, [
      path.join("Permafrost-MyWay", "Scripts", "Permafrost-MyWay.cfg"),
      path.join("Permafrost-MyWay", "Scripts", "main.lua"),
    ].sort());
  });

  it("claims a pak and a readme with the pak installer only", async () => {
    const files = ["Something.pak", "readme.txt"];
    const scripts = await testScripts(files, GAME_ID);
    const pak = await testPak(files, GAME_ID);
    assert.equal(scripts.supported, false);
    assert.equal(pak.supported, true);
    const result = await installPak(files, "Something.zip");
    assert.equal(modType(result.instructions), PAK_ID);
    const dests = copies(result.instructions).map((item) => item.destination).sort();
    assert.deepEqual(dests, ["Something.pak", "readme.txt"].sort());
    assert.equal(path.normalize(attr(result.instructions, "pakFiles").value[1].dir), path.normalize(PAKS_DIR));
  });
});

describe("mod type deployment", () => {
  it("merges every mod type into its target folder", () => {
    for (const name of ["UE4SS Scripts", "Paks", "LogicMods", "Script and Pak"]) {
      assert.deepEqual(modTypeOptions(name), { name, mergeMods: true });
    }
    const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
    assert.match(source, /modTypeOptions\(name\)/);
  });
});

describe("logic mods directory", () => {
  it("creates Content\\Paks\\LogicMods under the project folder and leaves existing files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-logic-"));
    const paks = path.join(root, "Permafrost", "Content", "Paks");
    fs.mkdirSync(paks, { recursive: true });
    fs.writeFileSync(path.join(paks, "Permafrost-Windows.pak"), "shipping");
    ensureLogicModsDir(root);
    const logic = path.join(root, LOGIC_REL);
    assert.equal(fs.statSync(logic).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(logic), []);
    assert.equal(fs.readFileSync(path.join(paks, "Permafrost-Windows.pak"), "utf8"), "shipping");
    assert.equal(fs.existsSync(path.join(root, "Content", "Paks", "LogicMods")), false);
    ensureLogicModsDir(root);
    assert.equal(fs.statSync(logic).isDirectory(), true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("deploy directories", () => {
  it("creates ue4ss\\Mods and LogicMods and leaves an existing mods file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-deploy-"));
    const mods = path.join(root, MODS_REL);
    ensureDeployDirs(root);
    assert.equal(fs.statSync(mods).isDirectory(), true);
    fs.writeFileSync(path.join(mods, "mods.txt"), "player-list");
    ensureDeployDirs(root);
    assert.equal(fs.statSync(path.join(root, LOGIC_REL)).isDirectory(), true);
    assert.equal(fs.statSync(mods).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(mods, "mods.txt"), "utf8"), "player-list");
    assert.equal(fs.existsSync(path.join(root, "Permafrost", "Binaries", "Win64", "Mods")), false);
    assert.equal(fs.statSync(path.join(root, "Mods")).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(path.join(root, "Mods")), []);
    ensureDeployDirs(root);
    assert.equal(fs.readFileSync(path.join(mods, "mods.txt"), "utf8"), "player-list");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("pak conflicts", () => {
  const logicDir = path.join("Content", "Paks", "LogicMods");

  function key(dir, name) {
    return path.normalize(dir).toLowerCase() + "|" + name.toLowerCase();
  }

  it("skips a file the same mod is replacing", () => {
    const mods = [
      {
        id: "testmod",
        name: "TestMod",
        pakFiles: [
          { dir: PAKS_DIR, name: "TestMod.pak" },
          { dir: PAKS_DIR, name: "TestMod.ucas" },
          { dir: logicDir, name: "TestMod.pak" },
        ],
      },
    ];
    const existing = new Set([
      key(PAKS_DIR, "TestMod.pak"),
      key(PAKS_DIR, "TestMod.ucas"),
      key(logicDir, "TestMod.pak"),
    ]);
    assert.deepEqual(findPakConflicts(mods, ["testmod"], existing), []);
  });

  it("warns when another mod owns the file on disk", () => {
    const mods = [
      {
        id: "testmod",
        name: "TestMod",
        pakFiles: [
          { dir: PAKS_DIR, name: "TestMod.pak" },
          { dir: PAKS_DIR, name: "TestMod.ucas" },
          { dir: PAKS_DIR, name: "TestMod.txt" },
        ],
      },
      {
        id: "other",
        name: "OtherMod",
        pakFiles: [
          { dir: PAKS_DIR, name: "TestMod.pak" },
          { dir: PAKS_DIR, name: "TestMod.ucas" },
        ],
      },
    ];
    const existing = new Set([key(PAKS_DIR, "TestMod.pak")]);
    const conflicts = findPakConflicts(mods, ["testmod"], existing);
    assert.equal(conflicts.length, 1);
    assert.equal(path.join(conflicts[0].dir, conflicts[0].name), path.join(PAKS_DIR, "TestMod.pak"));
    assert.deepEqual(conflicts[0].owners, [{ id: "other", name: "OtherMod" }]);
  });

  it("names every colliding file with its owner", () => {
    const mods = [
      {
        id: "deploying",
        name: "Deploying",
        pakFiles: [
          { dir: PAKS_DIR, name: "TestMod.pak" },
          { dir: PAKS_DIR, name: "TestMod.ucas" },
        ],
      },
      { id: "one", name: "TestMod One", pakFiles: [{ dir: PAKS_DIR, name: "TestMod.pak" }] },
      { id: "two", name: "TestMod Two", pakFiles: [{ dir: PAKS_DIR, name: "TestMod.ucas" }] },
    ];
    const existing = new Set([key(PAKS_DIR, "TestMod.pak"), key(PAKS_DIR, "TestMod.ucas")]);
    const lines = pakConflictLines(findPakConflicts(mods, ["deploying"], existing));
    assert.deepEqual(lines, [
      path.join(PAKS_DIR, "TestMod.pak") + " owned by TestMod One",
      path.join(PAKS_DIR, "TestMod.ucas") + " owned by TestMod Two",
    ]);
  });

  it("does not warn when the other mod's file is absent", () => {
    const mods = [
      { id: "testmod", name: "TestMod", pakFiles: [{ dir: PAKS_DIR, name: "TestMod.pak" }] },
      { id: "other", name: "OtherMod", pakFiles: [{ dir: PAKS_DIR, name: "TestMod.pak" }] },
    ];
    assert.deepEqual(findPakConflicts(mods, ["testmod"], new Set()), []);
  });

  it("treats Content\\Paks and LogicMods as different files", () => {
    const mods = [
      { id: "testmod", name: "TestMod", pakFiles: [{ dir: logicDir, name: "TestMod.pak" }] },
      { id: "other", name: "OtherMod", pakFiles: [{ dir: PAKS_DIR, name: "TestMod.pak" }] },
    ];
    const existing = new Set([key(logicDir, "TestMod.pak"), key(PAKS_DIR, "TestMod.pak")]);
    assert.deepEqual(findPakConflicts(mods, ["testmod"], existing), []);
  });

  it("reads both pak directories and lists every other owner", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-paks-"));
    try {
      const paks = path.join(root, "Content", "Paks");
      const logic = path.join(paks, "LogicMods");
      fs.mkdirSync(logic, { recursive: true });
      fs.writeFileSync(path.join(paks, "Widget.pak"), "pak");
      fs.writeFileSync(path.join(paks, "Widget.txt"), "text");
      fs.writeFileSync(path.join(paks, "Permafrost-Windows.pak"), "shipping");
      fs.writeFileSync(path.join(logic, "Widget.utoc"), "utoc");
      const existing = listPakContainers(root);
      assert.equal(existing.has(key(PAKS_DIR, "Widget.pak")), true);
      assert.equal(existing.has(key(PAKS_DIR, "Widget.txt")), false);
      assert.equal(existing.has(key(PAKS_DIR, "Permafrost-Windows.pak")), false);
      assert.equal(existing.has(key(logicDir, "Widget.utoc")), true);
      const mods = [
        {
          id: "new",
          name: "NewMod",
          pakFiles: [
            { dir: PAKS_DIR, name: "Widget.pak" },
            { dir: logicDir, name: "Widget.utoc" },
          ],
        },
        { id: "a", name: "Alpha", pakFiles: [{ dir: PAKS_DIR, name: "Widget.pak" }] },
        {
          id: "b",
          name: "Beta",
          pakFiles: [
            { dir: PAKS_DIR, name: "Widget.pak" },
            { dir: logicDir, name: "Widget.utoc" },
          ],
        },
      ];
      const conflicts = findPakConflicts(mods, ["new"], existing);
      const pak = conflicts.find((item) => item.name === "Widget.pak");
      const utoc = conflicts.find((item) => item.name === "Widget.utoc");
      assert.deepEqual(pak.owners.map((owner) => owner.name), ["Alpha", "Beta"]);
      assert.deepEqual(utoc.owners, [{ id: "b", name: "Beta" }]);
      assert.deepEqual(listPakContainers(path.join(root, "missing")), new Set());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers cancel and auto-rename before deploy", () => {
    const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
    assert.match(source, /onAsync\("will-deploy"/);
    assert.match(source, /lastDeployment/);
    assert.match(source, /protectedModIds/);
    assert.match(source, /bbcode: pakConflictDialog/);
    assert.match(source, /label: "Auto-rename"/);
    assert.doesNotMatch(source, /label: "Overwrite"/);
    assert.match(source, /remove-mods/);
    assert.match(source, /remove-download/);
    assert.match(source, /claimsHeldByOthers/);
    assert.match(source, /installed mod is not renamed/);
    assert.match(source, /its files stay/);
    assert.match(source, /renamePakFiles/);
    assert.doesNotMatch(source, /ProcessCanceled\("Pak file conflict"\)/);
    assert.doesNotMatch(source, /ProcessCanceled\("Pak auto-rename failed"\)/);
  });

  function containers(dir, stem) {
    return [".pak", ".ucas", ".utoc"].map((ext) => ({ dir, name: stem + ext }));
  }

  it("keeps the deployed mod and renames the other two off the same pak name", () => {
    const mods = ["one", "two", "three"].map((id) => ({
      id,
      name: "TestMod " + id[0].toUpperCase() + id.slice(1),
      installationPath: "staged-" + id,
      pakFiles: containers(PAKS_DIR, "TestMod").concat([{ dir: PAKS_DIR, name: "TestMod.txt" }]),
    }));
    const existing = new Set(containers(PAKS_DIR, "TestMod").map((entry) => key(entry.dir, entry.name)));
    const conflicts = findPakConflicts(mods, ["one", "two", "three"], existing);
    const keepers = keepersFromDeployment(
      {
        [PAK_ID]: containers(PAKS_DIR, "TestMod").map((entry) => ({
          source: "staged-one",
          relPath: entry.name,
        })),
      },
      mods,
    );
    assert.equal(keepers.get(key(PAKS_DIR, "TestMod.pak")), "one");
    const incoming = withoutPakKeepers(conflicts, keepers);
    assert.deepEqual(
      [...new Set(incoming.map((conflict) => conflict.modId))].sort(),
      ["three", "two"],
    );
    const lines = pakConflictLines(incoming, keepers);
    assert.deepEqual(lines, [
      path.join(PAKS_DIR, "TestMod.pak") + " owned by TestMod One",
      path.join(PAKS_DIR, "TestMod.ucas") + " owned by TestMod One",
      path.join(PAKS_DIR, "TestMod.utoc") + " owned by TestMod One",
    ]);
    const plan = planPakRenames(mods, incoming, existing);
    const byId = new Map(plan.map((item) => [item.modId, item]));
    assert.equal(byId.has("one"), false);
    const deployment = {
      [PAK_ID]: containers(PAKS_DIR, "TestMod").map((entry) => ({
        source: "staged-one",
        relPath: entry.name,
      })),
    };
    const protectedIds = protectedModIds(deployment, mods);
    assert.equal(protectedIds.has("one"), true);
    const guarded = conflicts.filter((conflict) => !protectedIds.has(conflict.modId));
    const guardedPlan = planPakRenames(mods, guarded, existing);
    assert.equal(guardedPlan.some((item) => item.modId === "one"), false);
    assert.deepEqual(guardedPlan.map((item) => item.modId).sort(), ["three", "two"]);
    assert.deepEqual(
      byId.get("three").renames.map((rename) => rename.to),
      ["TestMod_01.pak", "TestMod_01.txt", "TestMod_01.ucas", "TestMod_01.utoc"],
    );
    assert.deepEqual(
      byId.get("two").renames.map((rename) => rename.to),
      ["TestMod_02.pak", "TestMod_02.txt", "TestMod_02.ucas", "TestMod_02.utoc"],
    );
    const preview = pakRenamePreviewLines(plan);
    assert.equal(preview.length, 8);
    assert.equal(
      preview[0],
      path.join(PAKS_DIR, "TestMod.pak") + " from TestMod Three deploys as " + path.join(PAKS_DIR, "TestMod_01.pak"),
    );
    const recorded = renamePakFiles(mods[1].pakFiles, byId.get("two").renames);
    assert.deepEqual(
      recorded.map((entry) => entry.name),
      ["TestMod_02.pak", "TestMod_02.ucas", "TestMod_02.utoc", "TestMod_02.txt"],
    );
    assert.equal(recorded[0].renamedFrom, "TestMod.pak");
    assert.equal(recorded[3].renamedFrom, "TestMod.txt");
  });

  it("renames the whole claim when only the pak collides", () => {
    const logicDir = path.join("Content", "Paks", "LogicMods");
    const claimed = containers(PAKS_DIR, "TestMod").concat([
      { dir: PAKS_DIR, name: "TestMod.txt" },
      { dir: logicDir, name: "TestMod.pak" },
      { dir: PAKS_DIR, name: "Notes.txt" },
    ]);
    const mods = [
      { id: "one", name: "TestMod One", pakFiles: containers(PAKS_DIR, "TestMod") },
      { id: "two", name: "TestMod Two", pakFiles: claimed },
      { id: "held", name: "Held", pakFiles: [{ dir: PAKS_DIR, name: "TestMod_01.txt" }] },
    ];
    const conflicts = [
      { modId: "two", dir: PAKS_DIR, name: "TestMod.pak", owners: [{ id: "one", name: "TestMod One" }] },
    ];
    const plan = planPakRenames(mods, conflicts, new Set([key(PAKS_DIR, "TestMod.pak")]));
    assert.deepEqual(
      plan[0].renames.map((rename) => path.join(rename.dir, rename.to)),
      [
        path.join(PAKS_DIR, "Notes_01.txt"),
        path.join(PAKS_DIR, "TestMod_02.pak"),
        path.join(PAKS_DIR, "TestMod_02.txt"),
        path.join(PAKS_DIR, "TestMod_02.ucas"),
        path.join(PAKS_DIR, "TestMod_02.utoc"),
        path.join(logicDir, "TestMod_02.pak"),
      ],
    );
    assert.equal(pakRenamePreviewLines(plan).length, plan[0].renames.length);
  });

  it("records the renamed pak so uninstall removes that name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-rename-"));
    try {
      const paksDir = path.join(root, "Content", "Paks");
      fs.mkdirSync(paksDir, { recursive: true });
      fs.writeFileSync(path.join(paksDir, "TestMod.pak"), "owner");
      fs.writeFileSync(path.join(paksDir, "TestMod.txt"), "owner");
      fs.writeFileSync(path.join(paksDir, "TestMod_01.pak"), "renamed");
      fs.writeFileSync(path.join(paksDir, "TestMod_01.ucas"), "renamed");
      fs.writeFileSync(path.join(paksDir, "TestMod_01.txt"), "renamed");
      const recorded = renamePakFiles(
        containers(PAKS_DIR, "TestMod").concat([{ dir: PAKS_DIR, name: "TestMod.txt" }]),
        [
          { dir: PAKS_DIR, from: "TestMod.pak", to: "TestMod_01.pak" },
          { dir: PAKS_DIR, from: "TestMod.ucas", to: "TestMod_01.ucas" },
          { dir: PAKS_DIR, from: "TestMod.utoc", to: "TestMod_01.utoc" },
          { dir: PAKS_DIR, from: "TestMod.txt", to: "TestMod_01.txt" },
        ],
      );
      removeDeployed({ projectRoot: root, pakFiles: recorded });
      assert.equal(fs.readFileSync(path.join(paksDir, "TestMod.pak"), "utf8"), "owner");
      assert.equal(fs.readFileSync(path.join(paksDir, "TestMod.txt"), "utf8"), "owner");
      assert.equal(fs.existsSync(path.join(paksDir, "TestMod_01.pak")), false);
      assert.equal(fs.existsSync(path.join(paksDir, "TestMod_01.ucas")), false);
      assert.equal(fs.existsSync(path.join(paksDir, "TestMod_01.txt")), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("renames the staged pak and rolls back when the set is incomplete", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "permafrost-stage-"));
    try {
      const mixed = path.join(root, "mixed", "Permafrost", "Content", "Paks");
      fs.mkdirSync(mixed, { recursive: true });
      fs.writeFileSync(path.join(mixed, "TestMod.pak"), "pak");
      fs.writeFileSync(path.join(mixed, "TestMod.ucas"), "ucas");
      const renames = [
        { dir: PAKS_DIR, from: "TestMod.pak", to: "TestMod_01.pak" },
        { dir: PAKS_DIR, from: "TestMod.ucas", to: "TestMod_01.ucas" },
      ];
      applyStagedPakRenames(path.join(root, "mixed"), renames);
      assert.equal(fs.readFileSync(path.join(mixed, "TestMod_01.pak"), "utf8"), "pak");
      assert.equal(fs.existsSync(path.join(mixed, "TestMod.pak")), false);

      const flat = path.join(root, "flat");
      fs.mkdirSync(flat, { recursive: true });
      fs.writeFileSync(path.join(flat, "TestMod.pak"), "pak");
      assert.throws(() =>
        applyStagedPakRenames(flat, [
          { dir: PAKS_DIR, from: "TestMod.pak", to: "TestMod_01.pak" },
          { dir: PAKS_DIR, from: "TestMod.ucas", to: "TestMod_01.ucas" },
        ]),
      );
      assert.equal(fs.readFileSync(path.join(flat, "TestMod.pak"), "utf8"), "pak");
      assert.equal(fs.existsSync(path.join(flat, "TestMod_01.pak")), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the keeper from a mixed manifest and renames LogicMods with the same suffix", () => {
    const mods = [
      {
        id: "one",
        name: "TestMod One",
        installationPath: "staged-one",
        pakFiles: containers(PAKS_DIR, "TestMod").concat([{ dir: logicDir, name: "TestMod.pak" }]),
      },
    ];
    const keepers = keepersFromDeployment(
      {
        [MIXED_ID]: [
          { source: "staged-one", relPath: "Permafrost\\Content\\Paks\\TestMod.pak" },
          { source: "staged-one", relPath: "Permafrost/Content/Paks/LogicMods/TestMod.pak" },
        ],
      },
      mods,
    );
    assert.equal(keepers.get(key(PAKS_DIR, "TestMod.pak")), "one");
    assert.equal(keepers.get(key(logicDir, "TestMod.pak")), "one");
    const conflicts = findPakConflicts(
      [
        mods[0],
        { id: "two", name: "TestMod Two", pakFiles: containers(PAKS_DIR, "TestMod").concat([{ dir: logicDir, name: "TestMod.pak" }]) },
      ],
      ["two"],
      new Set([key(PAKS_DIR, "TestMod.pak")]),
    );
    const plan = planPakRenames(mods.concat([{ id: "two", name: "TestMod Two", pakFiles: containers(PAKS_DIR, "TestMod").concat([{ dir: logicDir, name: "TestMod.pak" }]) }]), conflicts, new Set([key(PAKS_DIR, "TestMod.pak")]));
    assert.deepEqual(
      plan[0].renames.map((rename) => path.join(rename.dir, rename.to)),
      containers(PAKS_DIR, "TestMod_01")
        .map((entry) => path.join(entry.dir, entry.name))
        .concat([path.join(logicDir, "TestMod_01.pak")]),
    );
  });
});
