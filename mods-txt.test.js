const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  updateModsTxt,
  updateLogicOrder,
  assignMissingOrder,
  orderedNames,
  moveUe4ss,
  placeUe4ss,
  reorderOwned,
} = require("./mods-txt");

const BUILTIN_LINES = [
  "CheatManagerEnablerMod : 1",
  "ActorDumperMod : 0",
  "ConsoleCommandsMod : 1",
  "ConsoleEnablerMod : 1",
  "SplitScreenMod : 0",
  "LineTraceMod : 0",
  "BPModLoaderMod : 1",
  "BPML_GenericFunctions : 1",
  "jsbLuaProfilerMod : 0",
  "",
  "",
  "",
  "",
  "; Built-in keybinds, do not move up!",
  "Keybinds : 1",
];

const FIXTURE = "\uFEFF" + BUILTIN_LINES.join("\r\n") + "\r\n";

function names(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.includes(";"))
    .map((line) => line.trim());
}

describe("mods.txt", () => {
  it("inserts new mods above the keybinds comment and leaves built-ins in place", () => {
    const once = updateModsTxt(FIXTURE, [{ name: "MoreBackpackSlots", enabled: true }]);
    const twice = updateModsTxt(once, [
      { name: "MoreBackpackSlots", enabled: true },
      { name: "SecondMod", enabled: true },
    ]);
    const got = names(twice);
    assert.deepEqual(got.slice(0, 9), names(FIXTURE).slice(0, 9));
    assert.equal(got[9], "MoreBackpackSlots : 1");
    assert.equal(got[10], "SecondMod : 1");
    assert.equal(got[got.length - 1], "Keybinds : 1");
    assert.ok(twice.includes("\r\n"));
    assert.ok(twice.charCodeAt(0) === 0xfeff);
    assert.ok(twice.includes("; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n"));
  });

  it("flips one owned line without moving it", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "MoreBackpackSlots", enabled: true },
      { name: "SecondMod", enabled: true },
    ]);
    const flipped = updateModsTxt(added, [
      { name: "MoreBackpackSlots", enabled: false },
      { name: "SecondMod", enabled: true },
    ]);
    const before = names(added);
    const after = names(flipped);
    assert.equal(after.indexOf("MoreBackpackSlots : 0"), before.indexOf("MoreBackpackSlots : 1"));
    assert.ok(after.includes("SecondMod : 1"));
    assert.equal(after[after.length - 1], "Keybinds : 1");
  });

  it("removes one added line and matches the fixture", () => {
    const added = updateModsTxt(FIXTURE, [{ name: "MoreBackpackSlots", enabled: true }]);
    const removed = updateModsTxt(added, [], { remove: ["MoreBackpackSlots"] });
    assert.equal(removed, FIXTURE);
  });

  it("drops an owned line whose folder is gone and keeps a manual mod that is still on disk", () => {
    const withManual =
      updateModsTxt(FIXTURE, [{ name: "MoreBackpackSlots", enabled: true }]).replace(
        "MoreBackpackSlots : 1",
        "MoreBackpackSlots : 1\r\nManualMod : 1",
      );
    const reconciled = updateModsTxt(withManual, [], {
      folderExists: (name) => name === "ManualMod",
    });
    const got = names(reconciled);
    assert.ok(!got.some((line) => line.startsWith("MoreBackpackSlots")));
    assert.ok(got.includes("ManualMod : 1"));
    assert.equal(got[got.length - 1], "Keybinds : 1");
    assert.deepEqual(got.slice(0, 9), names(FIXTURE).slice(0, 9));
  });

  it("does not rewrite a built-in line when that name is passed as owned", () => {
    const next = updateModsTxt(FIXTURE, [{ name: "Keybinds", enabled: false }]);
    assert.equal(next, FIXTURE);
  });

  it("reorders three checked mods and leaves the rest of the file", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "Alpha", enabled: true },
      { name: "Beta", enabled: true },
      { name: "Gamma", enabled: true },
    ]);
    const next = reorderOwned(added, ["Gamma", "Alpha", "Beta"]);
    const got = names(next);
    const start = names(FIXTURE).length - 1;
    assert.deepEqual(got.slice(0, 9), names(FIXTURE).slice(0, 9));
    assert.equal(got[9], "Gamma : 1");
    assert.equal(got[10], "Alpha : 1");
    assert.equal(got[11], "Beta : 1");
    assert.equal(got[got.length - 1], "Keybinds : 1");
    assert.ok(next.includes("\r\n\r\n\r\n\r\n; Built-in keybinds, do not move up!\r\nKeybinds : 1\r\n"));
    assert.ok(next.charCodeAt(0) === 0xfeff);
    assert.equal(got.length, start + 4);
  });

  it("moves one mod to the top and then to the bottom", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "Alpha", enabled: true },
      { name: "Beta", enabled: true },
      { name: "Gamma", enabled: true },
    ]);
    let rows = assignMissingOrder(
      [
        { name: "Alpha", enabled: true },
        { name: "Beta", enabled: true },
        { name: "Gamma", enabled: true },
      ],
      added,
    );
    rows = moveUe4ss(rows, "Gamma", -1);
    rows = moveUe4ss(rows, "Gamma", -1);
    let next = reorderOwned(added, orderedNames(rows));
    assert.deepEqual(names(next).slice(9, 12), ["Gamma : 1", "Alpha : 1", "Beta : 1"]);
    rows = moveUe4ss(rows, "Gamma", 1);
    rows = moveUe4ss(rows, "Gamma", 1);
    next = reorderOwned(added, orderedNames(rows));
    assert.deepEqual(names(next).slice(9, 12), ["Alpha : 1", "Beta : 1", "Gamma : 1"]);
    assert.equal(names(next)[names(next).length - 1], "Keybinds : 1");
  });

  it("leaves a disabled line where it is", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "Alpha", enabled: true },
      { name: "Beta", enabled: false },
      { name: "Gamma", enabled: true },
    ]);
    const rows = moveUe4ss(
      assignMissingOrder(
        [
          { name: "Alpha", enabled: true },
          { name: "Beta", enabled: false },
          { name: "Gamma", enabled: true },
        ],
        added,
      ),
      "Gamma",
      -1,
    );
    const next = reorderOwned(added, orderedNames(rows));
    const got = names(next);
    assert.deepEqual(got.slice(9, 12), ["Gamma : 1", "Beta : 0", "Alpha : 1"]);
    assert.equal(rows.find((row) => row.name === "Beta").enabled, false);
  });

  it("moves a mixed mod line and does not write its pak name", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "ScriptA", enabled: true },
      { name: "TestMod", enabled: true },
      { name: "ScriptB", enabled: true },
    ]);
    const rows = [
      { name: "ScriptA", enabled: true, order: 0 },
      { name: "TestMod", enabled: true, order: 1, pak: "TestMod.pak" },
      { name: "ScriptB", enabled: true, order: 2 },
    ];
    const up = moveUe4ss(rows, "TestMod", -1);
    const next = reorderOwned(added, orderedNames(up));
    assert.deepEqual(names(next).slice(9, 12), ["TestMod : 1", "ScriptA : 1", "ScriptB : 1"]);
    assert.equal(next.includes("TestMod.pak"), false);
    const down = moveUe4ss(up, "TestMod", 1);
    const back = reorderOwned(added, orderedNames(down));
    assert.deepEqual(names(back).slice(9, 12), ["ScriptA : 1", "TestMod : 1", "ScriptB : 1"]);
  });

  it("ignores a pak name that has no script line", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "Alpha", enabled: true },
      { name: "Beta", enabled: true },
    ]);
    const next = reorderOwned(added, ["OnlyPak.pak", "Beta", "Alpha"]);
    assert.equal(next.includes("OnlyPak"), false);
    assert.deepEqual(names(next).slice(9, 11), ["Beta : 1", "Alpha : 1"]);
    assert.equal(names(next)[names(next).length - 1], "Keybinds : 1");
  });

  it("inserts a checked mod at the top and then at the bottom", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "Alpha", enabled: true },
      { name: "Beta", enabled: true },
      { name: "Gamma", enabled: true },
    ]);
    let rows = assignMissingOrder(
      [
        { name: "Alpha", enabled: true },
        { name: "Beta", enabled: true },
        { name: "Gamma", enabled: true },
      ],
      added,
    );
    rows = placeUe4ss(rows, "Gamma", 1);
    let next = reorderOwned(added, orderedNames(rows));
    assert.deepEqual(names(next).slice(9, 12), ["Gamma : 1", "Alpha : 1", "Beta : 1"]);
    rows = placeUe4ss(rows, "Gamma", 3);
    next = reorderOwned(added, orderedNames(rows));
    assert.deepEqual(names(next).slice(9, 12), ["Alpha : 1", "Beta : 1", "Gamma : 1"]);
    assert.equal(names(next)[names(next).length - 1], "Keybinds : 1");
    assert.ok(next.includes("; Built-in keybinds, do not move up!"));
  });

  it("keeps the input array in place and reports the move through order numbers", () => {
    const rows = [
      { name: "Alpha", enabled: true, order: 0 },
      { name: "Beta", enabled: true, order: 1 },
    ];
    const moved = placeUe4ss(rows, "Alpha", 2);
    assert.deepEqual(
      moved.map((row) => row.name),
      ["Alpha", "Beta"],
    );
    assert.deepEqual(orderedNames(moved), ["Beta", "Alpha"]);
  });

  it("leaves the order alone when the chosen position is the current one", () => {
    const rows = [
      { name: "Alpha", enabled: true, order: 0 },
      { name: "Beta", enabled: true, order: 1 },
      { name: "Gamma", enabled: true, order: 2 },
    ];
    const next = placeUe4ss(rows, "Beta", 2);
    assert.deepEqual(orderedNames(next), ["Alpha", "Beta", "Gamma"]);
    assert.equal(next[1].order, 1);
  });

  it("keeps an unchecked line in place when a later mod is inserted above it", () => {
    const added = updateModsTxt(FIXTURE, [
      { name: "Alpha", enabled: true },
      { name: "Beta", enabled: false },
      { name: "Gamma", enabled: true },
      { name: "Delta", enabled: true },
    ]);
    const rows = placeUe4ss(
      assignMissingOrder(
        [
          { name: "Alpha", enabled: true },
          { name: "Beta", enabled: false },
          { name: "Gamma", enabled: true },
          { name: "Delta", enabled: true },
        ],
        added,
      ),
      "Delta",
      1,
    );
    const next = reorderOwned(added, orderedNames(rows));
    assert.deepEqual(names(next).slice(9, 13), ["Delta : 1", "Beta : 0", "Alpha : 1", "Gamma : 1"]);
    assert.equal(names(next)[names(next).length - 1], "Keybinds : 1");
  });

  it("does not move Keybinds or BPModLoaderMod when those names are ordered", () => {
    const next = reorderOwned(FIXTURE, ["Keybinds", "BPModLoaderMod", "Alpha"]);
    assert.equal(next, FIXTURE);
  });
});

describe("logic load order", () => {
  it("keeps the comment block and drops a name whose pak is gone", () => {
    const original = "; leave this comment\r\nGoneMod : 1\r\nKeptMod : 1\r\n";
    const next = updateLogicOrder(original, ["KeptMod", "NewMod"]);
    assert.ok(next.startsWith("; leave this comment\r\n"));
    assert.ok(!next.includes("GoneMod"));
    assert.ok(next.includes("KeptMod : 1"));
    assert.ok(next.includes("NewMod : 1"));
  });
});
