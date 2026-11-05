/* Permafrost Vortex Extension.
   UE4SS script folders, pak/ucas/utoc files, loose readmes, and ModLoader DLLs.
   An installed Content\Paks name stays. A new mod that collides with it is
   removed on cancel, or renamed with the rest of its files to Name_01.
   A ModLoader DLL asks for the API when the exe or the host DLL is missing.
   Cancel leaves the download. An existing loader skips that question.
   PermafrostModLoader.exe is registered as the Permafrost ModLoader API tool and pinned above Play.
   mods.txt is edited in place.
   Built-in lines are not reordered. */

const fs = require("fs");
const path = require("path");
const React = require("react");
const { actions, fs: vortexFs, log, selectors, util } = require("vortex-api");
const {
  updateModsTxt,
  updateLogicOrder,
  KEYBINDS_COMMENT,
  assignMissingOrder,
  orderedNames,
  placeUe4ss,
  isBuiltin,
  reorderOwned,
} = require("./mods-txt");
const {
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
  installPak,
  installScripts,
  installLogic,
  installReject,
  testPak,
  testScripts,
  testLogic,
  testModLoader,
  testReject,
  prepareModLoader,
  removeDeployed,
  preserveModConfig,
  restoreModConfig,
  claimsHeldByOthers,
  dropModLine,
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
  ensureDeployDirs,
  modTypeOptions,
  stripEnabledTxt,
  projectPaths,
  isSafeSegment,
} = require("./install");
const { ensureUe4ss, readInstalledBuildLabel, win64Dir } = require("./ue4ss-setup");
const {
  mergeIni,
  mergeIniTaking,
  openIniConflicts,
  rememberKeptConflicts,
  dropKeptConflicts,
  sameKeptList,
  planIniMerge,
  modLoaderOwnershipConflicts,
  modLoaderApiPrompt,
  planModLoaderTool,
  MODLOADER_TOOL_ID,
  MODLOADER_TOOL_NAME,
  MODLOADER_EXE_FILE,
  MODLOADER_HOST_FILE,
} = require("./modloader");

const STEAM_APP_ID = "2254990";
const SHIPPING_EXE = path.join(
  "Permafrost",
  "Binaries",
  "Win64",
  "Permafrost-Win64-Shipping.exe",
);
const LOGIC_HEADER =
  "; You only have to include BP mods where load order matters, mods not included here will be loaded in any random order after loading the prioritized mods.\r\n" +
  "; Add your BP mods below by their name without .pak at the end, they will be loaded in top to bottom order.\r\n";

function discoveryPath(api) {
  const discovered = api.getState().settings.gameMode.discovered[GAME_ID];
  return discovered && discovered.path ? discovered.path : "";
}

function projectRootFrom(api) {
  const root = discoveryPath(api);
  return root ? path.join(root, "Permafrost") : "";
}

function gameIsDiscovered(api, gameId) {
  return gameId === GAME_ID && discoveryPath(api) !== "";
}

function modTypeTarget(api, game, relParts) {
  const root = api.getState().settings.gameMode.discovered[game.id];
  if (!root || !root.path) return undefined;
  // The hardlink check calls this and then tests the returned path. Create the
  // folders first so a missing ue4ss\Mods is not reported as read-only.
  try {
    ensureDeployDirs(root.path);
  } catch (err) {
    log("warn", "Permafrost deploy folders were not created", err);
  }
  return relParts.length === 0 ? root.path : path.join(root.path, ...relParts);
}

function registerModType(context, id, priority, relParts, name) {
  context.registerModType(
    id,
    priority,
    (gameId) => gameIsDiscovered(context.api, gameId),
    (game) => modTypeTarget(context.api, game, relParts),
    () => Promise.resolve(false),
    modTypeOptions(name),
  );
}

function openTarget(api, target) {
  try {
    window.api.shell.openFile(target);
  } catch (err) {
    api.showErrorNotification("Failed to open the file or folder", err, { allowReport: false });
  }
}

function registerOpenAction(context, title, resolveTarget) {
  context.registerAction(
    "mod-icons",
    200,
    "open-ext",
    {},
    title,
    () => {
      const project = projectRootFrom(context.api);
      if (!project) {
        context.api.showErrorNotification("Permafrost is not discovered yet.", undefined, {
          allowReport: false,
        });
        return;
      }
      openTarget(context.api, resolveTarget(project));
    },
    () => selectors.activeGameId(context.api.getState()) === GAME_ID,
  );
}

function profileFor(api, profileId) {
  const state = api.getState();
  const profile = profileId
    ? state.persistent.profiles[profileId]
    : selectors.activeProfile(state);
  if (!profile || profile.gameId !== GAME_ID) return null;
  return profile;
}

function modsFor(api) {
  return api.getState().persistent.mods[GAME_ID] || {};
}

function writeModsFile(projectRoot, owned) {
  const paths = projectPaths(projectRoot);
  if (!fs.existsSync(paths.modsDir)) return;
  const current = fs.existsSync(paths.modsTxt) ? fs.readFileSync(paths.modsTxt, "utf8") : "";
  const updated = updateModsTxt(current, owned, {
    folderExists: (name) => fs.existsSync(path.join(paths.modsDir, name)),
  });
  const next = reorderOwned(updated, orderedNames(assignMissingOrder(owned, updated)));
  if (next !== current) fs.writeFileSync(paths.modsTxt, next, "utf8");
}

function logicNamesOnDisk(projectRoot) {
  const dir = path.join(projectRoot, "Content", "Paks", "LogicMods");
  if (!fs.existsSync(dir)) return [];
  const names = new Set();
  for (const file of fs.readdirSync(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".pak" || ext === ".ucas" || ext === ".utoc") {
      names.add(path.basename(file, ext));
    }
  }
  return [...names];
}

function writeLogicOrder(projectRoot) {
  const paths = projectPaths(projectRoot);
  const folder = path.dirname(paths.logicOrder);
  if (!fs.existsSync(folder)) return;
  const keep = logicNamesOnDisk(projectRoot);
  const exists = fs.existsSync(paths.logicOrder);
  if (!exists && keep.length === 0) return;
  const current = exists ? fs.readFileSync(paths.logicOrder, "utf8") : LOGIC_HEADER;
  const next = updateLogicOrder(current, keep);
  if (next !== current) fs.writeFileSync(paths.logicOrder, next, "utf8");
}

function recordOf(mod) {
  if (!mod || !mod.attributes) return { ue4ssModFolder: undefined, pakFiles: undefined };
  return {
    ue4ssModFolder: mod.attributes.ue4ssModFolder,
    pakFiles: mod.attributes.pakFiles,
  };
}

function removeRecord(projectRoot, mod, mods) {
  const record = recordOf(mod);
  if (!record.ue4ssModFolder && !Array.isArray(record.pakFiles)) return null;
  const held = claimsHeldByOthers(mod && mod.id, mods);
  const note = removeDeployed({
    projectRoot,
    ue4ssModFolder: record.ue4ssModFolder,
    pakFiles: record.pakFiles,
    keptPakFiles: held.pakFiles,
    keptFolders: held.folders,
  });
  if (note) log("info", note);
  return note;
}

function ownedFromProfile(api, profile, projectRoot) {
  const mods = modsFor(api);
  const modState = profile.modState || {};
  const paths = projectPaths(projectRoot);
  const owned = [];
  for (const mod of Object.values(mods)) {
    if (modState[mod.id]?.enabled !== true) continue;
    const folder = mod.attributes?.ue4ssModFolder;
    if (!folder || !isSafeSegment(folder)) continue;
    stripEnabledTxt(path.join(paths.modsDir, folder));
    owned.push({
      name: folder,
      enabled: mod.attributes.ue4ssEnabled !== false,
      order: mod.attributes.ue4ssOrder,
    });
  }
  return owned;
}

function reconcileDeployed(api, profile) {
  const projectRoot = projectRootFrom(api);
  if (!projectRoot || !fs.existsSync(projectRoot)) return;
  const mods = modsFor(api);
  const modState = profile.modState || {};
  for (const mod of Object.values(mods)) {
    if (modState[mod.id]?.enabled === true) continue;
    removeRecord(projectRoot, mod, mods);
  }
  writeModsFile(projectRoot, ownedFromProfile(api, profile, projectRoot));
  writeLogicOrder(projectRoot);
}

function reconcilePurged(api) {
  const projectRoot = projectRootFrom(api);
  if (!projectRoot || !fs.existsSync(projectRoot)) return;
  const mods = modsFor(api);
  for (const mod of Object.values(mods)) removeRecord(projectRoot, mod, mods);
  writeModsFile(projectRoot, []);
  writeLogicOrder(projectRoot);
}

function restoreEnabledConfigs(api, profile, projectRoot) {
  const modState = profile.modState || {};
  for (const [modId, mod] of Object.entries(modsFor(api))) {
    const folder = mod && mod.attributes && mod.attributes.ue4ssModFolder;
    if (!folder) continue;
    const id = (mod && mod.id) || modId;
    if (!modState[id] || modState[id].enabled !== true) continue;
    restoreModConfig(projectRoot, folder);
  }
}

function onDeploy(api, profileId) {
  try {
    const profile = profileFor(api, profileId);
    if (!profile) return Promise.resolve();
    reconcileDeployed(api, profile);
    try {
      const projectRoot = projectRootFrom(api);
      if (projectRoot && fs.existsSync(projectRoot)) restoreEnabledConfigs(api, profile, projectRoot);
    } catch (err) {
      log("error", "Permafrost config restore failed", err);
    }
  } catch (err) {
    log("error", "Permafrost deploy cleanup failed", err);
    api.showErrorNotification("Permafrost could not update mods.txt", err, { allowReport: false });
  }
  if (profileFor(api, profileId)) syncModLoaderTool(api);
  return Promise.resolve();
}

function onPurge(api, profileId) {
  try {
    const profile = profileFor(api, profileId);
    if (!profile) return Promise.resolve();
    reconcilePurged(api);
  } catch (err) {
    log("error", "Permafrost purge cleanup failed", err);
    api.showErrorNotification("Permafrost could not clean mods.txt after purge", err, {
      allowReport: false,
    });
  }
  if (profileFor(api, profileId)) syncModLoaderTool(api);
  return Promise.resolve();
}

function modLoaderFilesPresent(api) {
  const root = discoveryPath(api);
  return {
    exe: !!(root && fs.existsSync(path.join(root, MODLOADER_EXE_FILE))),
    host: !!(root && fs.existsSync(path.join(root, MODLOADER_HOST_FILE))),
  };
}

async function installModLoader(api, files, destinationPath, _gameId, _progress, _choices, _unattended, archivePath) {
  const prepared = prepareModLoader(files, destinationPath, archivePath);
  if (!prepared.claim) {
    return Promise.reject(new Error("This archive is not a Permafrost ModLoader package or DLL mod."));
  }
  if (prepared.apiDlls.length > 0) {
    const present = modLoaderFilesPresent(api);
    const prompt = modLoaderApiPrompt(present.exe, present.host);
    if (prompt) {
      const result = await api.showDialog(
        "question",
        prompt.title,
        { bbcode: prompt.text },
        [
          { label: "Cancel", default: true },
          { label: "Continue" },
        ],
      );
      if (!result || result.action !== "Continue") {
        return Promise.reject(new util.ProcessCanceled("Install the Permafrost ModLoader API first."));
      }
    }
  }
  return { instructions: prepared.instructions };
}

function syncModLoaderTool(api) {
  try {
    const root = discoveryPath(api);
    if (!root || !api.store || !actions.addDiscoveredTool || !actions.setToolVisible) {
      return;
    }
    const exePath = path.join(root, MODLOADER_EXE_FILE);
    const state = api.getState();
    const tools =
      state.settings &&
      state.settings.gameMode &&
      state.settings.gameMode.discovered &&
      state.settings.gameMode.discovered[GAME_ID] &&
      state.settings.gameMode.discovered[GAME_ID].tools;
    const discovered = tools && tools[MODLOADER_TOOL_ID] ? tools[MODLOADER_TOOL_ID] : null;
    const primaryTable = state.settings && state.settings.interface && state.settings.interface.primaryTool;
    const primary =
      primaryTable && Object.prototype.hasOwnProperty.call(primaryTable, GAME_ID)
        ? primaryTable[GAME_ID]
        : undefined;
    const pinTable =
      state.settings &&
      state.settings.interface &&
      state.settings.interface.tools &&
      state.settings.interface.tools.pinned &&
      state.settings.interface.tools.pinned[GAME_ID];
    const pinned =
      pinTable && Object.prototype.hasOwnProperty.call(pinTable, MODLOADER_TOOL_ID)
        ? pinTable[MODLOADER_TOOL_ID]
        : undefined;
    let pinnedCount = 0;
    if (pinTable) {
      for (const toolId of Object.keys(pinTable)) {
        if (toolId !== MODLOADER_TOOL_ID && pinTable[toolId] === true) pinnedCount += 1;
      }
    }
    const plan = planModLoaderTool({
      exeExists: fs.existsSync(exePath),
      discovered,
      primary,
      pinned,
      pinnedCount,
    });
    const releaseOwned = plan.clearPrimary || plan.releaseOwnedPrimary;
    if (plan.register) {
      const result = {
        id: plan.register.id,
        name: plan.register.name,
        path: exePath,
        requiredFiles: plan.register.requiredFiles,
        custom: false,
      };
      // A user hide is stored on the record. Passing it back keeps the reducer from
      // treating a later sync as a new tool, and it does not clear the hide.
      if (discovered && Object.prototype.hasOwnProperty.call(discovered, "hidden")) {
        result.hidden = discovered.hidden;
      }
      if (discovered && discovered.ownedPrimary === true && !releaseOwned) result.ownedPrimary = true;
      api.store.dispatch(actions.addDiscoveredTool(GAME_ID, plan.register.id, result, false));
    }
    if (plan.pin && actions.setToolPinned) {
      api.store.dispatch(actions.setToolPinned(GAME_ID, MODLOADER_TOOL_ID, true));
    }
    // Clear only a primary this extension marked. A primary the user chose has no mark.
    if (plan.clearPrimary && actions.setPrimaryTool) {
      api.store.dispatch(actions.setPrimaryTool(GAME_ID, undefined));
    }
    if (releaseOwned && discovered && !plan.register && !plan.forget) {
      const kept = {
        id: MODLOADER_TOOL_ID,
        name: discovered.name || MODLOADER_TOOL_NAME,
        path: discovered.path || exePath,
        requiredFiles: discovered.requiredFiles || [MODLOADER_EXE_FILE],
        custom: discovered.custom === true,
      };
      if (Object.prototype.hasOwnProperty.call(discovered, "hidden")) kept.hidden = discovered.hidden;
      api.store.dispatch(actions.addDiscoveredTool(GAME_ID, MODLOADER_TOOL_ID, kept, false));
    }
    if (plan.forget) {
      const current = discovered || {};
      // setToolVisible(false) deletes a tool only when custom is true. A discovered
      // row is marked custom first so that action removes it instead of hiding it.
      api.store.dispatch(
        actions.addDiscoveredTool(
          GAME_ID,
          MODLOADER_TOOL_ID,
          {
            id: MODLOADER_TOOL_ID,
            name: current.name || MODLOADER_TOOL_NAME,
            path: current.path || exePath,
            requiredFiles: current.requiredFiles || [MODLOADER_EXE_FILE],
            custom: true,
            hidden: current.hidden,
          },
          false,
        ),
      );
      api.store.dispatch(actions.setToolVisible(GAME_ID, MODLOADER_TOOL_ID, false));
    }
  } catch (err) {
    log("warn", "Permafrost ModLoader tool was not updated", err);
  }
}

function modLoaderConflictDialog(conflicts) {
  const items = conflicts
    .map((item) => "[*]" + item.file + " already belongs to " + item.owner)
    .join("\n");
  const names = [];
  for (const item of conflicts) {
    if (item.name && !names.includes(item.name)) names.push(item.name);
  }
  return (
    "These ModLoader files already belong to an installed mod. That mod keeps them.\n" +
    "[list]\n" +
    items +
    "\n[/list]\n" +
    "Cancel removes " +
    names.join(", ") +
    " from the mod list and installs nothing."
  );
}

function iniConflictDialog(modName, conflicts) {
  const items = conflicts
    .map(
      (item) =>
        "[*]" +
        item.section +
        " " +
        item.key +
        " is " +
        item.existing +
        ". The mod wants " +
        item.incoming,
    )
    .join("\n");
  return (
    modName +
    " wants to change keys in [font=Courier New]Config\\PermafrostModLoader.ini[/font]. Existing values stay unless you choose Use the mod values.\n" +
    "[list]\n" +
    items +
    "\n[/list]"
  );
}

function modLoaderWasDeployed(lastDeployment, installationPath) {
  const files = lastDeployment && lastDeployment[MODLOADER_ID];
  if (!Array.isArray(files) || !installationPath) return false;
  const inst = String(installationPath).replace(/\//g, "\\").toLowerCase();
  return files.some((file) => {
    const source = String(file && file.source ? file.source : "").replace(/\//g, "\\").toLowerCase();
    return source === inst || source.startsWith(inst + "\\");
  });
}

function storeModLoaderIniAttrs(api, modId, extra) {
  if (!api || !api.store || !modId) return;
  const mod = modsFor(api)[modId];
  if (!mod) return;
  api.store.dispatch(
    actions.setModAttributes(GAME_ID, modId, {
      ...(mod.attributes || {}),
      ...extra,
    }),
  );
}

async function writeModLoaderIni(api, iniPath, rec, existing, incoming) {
  const preview = mergeIni(existing, incoming, false);
  const kept = rec && Array.isArray(rec.kept) ? rec.kept : [];
  const open = openIniConflicts(preview.conflicts, kept);
  let merged = preview;
  let nextKept = null;
  if (open.length > 0) {
    const result = await api.showDialog(
      "question",
      "ModLoader ini already has these values",
      { bbcode: iniConflictDialog(rec.name, open) },
      [
        { label: "Keep existing", default: true },
        { label: "Use the mod values" },
      ],
    );
    if (result && result.action === "Use the mod values") {
      merged = mergeIniTaking(existing, incoming, open);
      nextKept = dropKeptConflicts(kept, open);
    } else {
      nextKept = rememberKeptConflicts(kept, open);
    }
  }
  fs.mkdirSync(path.dirname(iniPath), { recursive: true });
  if (merged.text !== existing) fs.writeFileSync(iniPath, merged.text, "utf8");
  if (nextKept && !sameKeptList(kept, nextKept)) {
    storeModLoaderIniAttrs(api, rec && rec.id, { modLoaderIniKept: nextKept });
  }
}

async function onModLoaderWillDeploy(api, profileId, lastDeployment) {
  const profile = profileFor(api, profileId);
  if (!profile) return;
  const root = discoveryPath(api);
  if (!root) return;
  const modState = profile.modState || {};
  const records = [];
  const deploying = [];
  for (const [id, mod] of Object.entries(modsFor(api))) {
    const attrs = (mod && mod.attributes) || {};
    const enabled = !!(modState[id] && modState[id].enabled === true);
    records.push({
      id,
      name: modDisplayName(mod, id),
      files: Array.isArray(attrs.modLoaderFiles) ? attrs.modLoaderFiles : [],
      ini: typeof attrs.modLoaderIni === "string" ? attrs.modLoaderIni : "",
      kept: Array.isArray(attrs.modLoaderIniKept) ? attrs.modLoaderIniKept : [],
      applied: typeof attrs.modLoaderIniApplied === "string" ? attrs.modLoaderIniApplied : null,
      manual: attrs.modLoaderNeedsManualIni === true,
      enabled,
      deployed: modLoaderWasDeployed(lastDeployment, mod && mod.installationPath),
    });
    if (enabled) deploying.push(id);
  }
  const conflicts = modLoaderOwnershipConflicts(records, deploying);
  const removed = new Set();
  if (conflicts.length > 0) {
    await api.showDialog(
      "question",
      "ModLoader files already belong to another mod",
      { bbcode: modLoaderConflictDialog(conflicts) },
      [{ label: "Cancel", default: true }],
    );
    const ids = [];
    for (const item of conflicts) {
      if (item.modId && !ids.includes(item.modId)) ids.push(item.modId);
      removed.add(item.modId);
    }
    await removeIncomingMods(api, profileId, ids);
  }
  const iniPath = path.join(root, "Config", "PermafrostModLoader.ini");
  for (const id of deploying) {
    if (removed.has(id)) continue;
    const rec = records.find((item) => item.id === id);
    if (!rec) continue;
    if (rec.ini) {
      const iniPlan = planIniMerge({
        ini: rec.ini,
        applied: rec.applied,
        alreadyDeployed: rec.deployed,
      });
      if (!iniPlan.merge) {
        if (iniPlan.stamp) storeModLoaderIniAttrs(api, rec.id, { modLoaderIniApplied: rec.ini });
        continue;
      }
      try {
        const existing = fs.existsSync(iniPath) ? fs.readFileSync(iniPath, "utf8") : "";
        await writeModLoaderIni(api, iniPath, rec, existing, rec.ini);
        if (iniPlan.stamp) storeModLoaderIniAttrs(api, rec.id, { modLoaderIniApplied: rec.ini });
      } catch (err) {
        log("error", "Permafrost could not merge PermafrostModLoader.ini", err);
        api.showErrorNotification("Permafrost could not merge PermafrostModLoader.ini", err, {
          allowReport: false,
        });
      }
      continue;
    }
    if (rec.manual && !rec.deployed) {
      const dlls = (rec.files || [])
        .map((file) => path.basename(String(file)))
        .filter((name) => name.toLowerCase().endsWith(".dll") && name.toLowerCase() !== "permafrostmodhost.dll");
      const who = dlls.length > 0 ? dlls.join(", ") : rec.name;
      api.sendNotification({
        id: "permafrost-modloader-ini-" + id,
        type: "warning",
        title: "ModLoader settings",
        message:
          who +
          " does not include PermafrostModLoader.ini. Add its settings by hand to Config\\PermafrostModLoader.ini.",
      });
    }
  }
}

function modDisplayName(mod, id) {
  const attrs = (mod && mod.attributes) || {};
  return attrs.customFileName || attrs.logicalFileName || attrs.modName || attrs.fileName || id;
}

function pakConflictDialog(conflicts, plan, keepers) {
  const items = pakConflictLines(conflicts, keepers)
    .map((line) => "[*]" + line)
    .join("\n");
  const preview = pakRenamePreviewLines(plan)
    .map((line) => "[*]" + line)
    .join("\n");
  const names = [];
  for (const item of plan || []) {
    const who = item.name || item.modId;
    if (who && !names.includes(who)) names.push(who);
  }
  const who = names.join(", ") || "the new mod";
  return (
    "These files already belong to an installed mod. That mod keeps its names.\n" +
    "[list]\n" +
    items +
    "\n[/list]\n" +
    "Cancel removes " + who + " from the mod list, including its downloaded archive, and installs nothing. Auto-rename deploys only " + who + " under the names below and remembers them. The installed mod is not renamed, and its files stay.\n" +
    "[list]\n" +
    preview +
    "\n[/list]"
  );
}

function removeDownload(api, downloadId) {
  return new Promise((resolve) => {
    try {
      api.events.emit("remove-download", downloadId, (err) => {
        if (err) {
          log("error", "Permafrost could not remove the downloaded archive", err);
          api.showErrorNotification("Permafrost could not remove the downloaded archive", err, {
            allowReport: false,
          });
        }
        resolve();
      }, { silent: true, confirmed: true });
    } catch (err) {
      log("error", "Permafrost could not remove the downloaded archive", err);
      api.showErrorNotification("Permafrost could not remove the downloaded archive", err, {
        allowReport: false,
      });
      resolve();
    }
  });
}

// Vortex keeps going after will-deploy returns, so the new mod has to be gone
// before that return. Throwing ProcessCanceled does not stop the deploy.
function removeIncomingMods(api, profileId, modIds) {
  const ids = [];
  const downloads = [];
  for (const id of modIds || []) {
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    const archiveId = modsFor(api)[id] && modsFor(api)[id].archiveId;
    if (typeof archiveId === "string" && archiveId && !downloads.includes(archiveId)) {
      downloads.push(archiveId);
    }
  }
  if (ids.length === 0) return Promise.resolve();
  if (profileId) {
    for (const id of ids) {
      try {
        api.store.dispatch(actions.setModEnabled(profileId, id, false));
      } catch (err) {
        log("error", "Permafrost could not disable the incoming mod", err);
      }
    }
  }
  return new Promise((resolve) => {
    try {
      api.events.emit("remove-mods", GAME_ID, ids, (err) => {
        if (err) {
          log("error", "Permafrost could not remove the incoming mod", err);
          api.showErrorNotification("Permafrost could not remove the new mod", err, { allowReport: false });
          resolve();
          return;
        }
        let chain = Promise.resolve();
        for (const downloadId of downloads) chain = chain.then(() => removeDownload(api, downloadId));
        chain.then(resolve);
      }, { ignoreInstalling: true });
    } catch (err) {
      log("error", "Permafrost could not remove the incoming mod", err);
      api.showErrorNotification("Permafrost could not remove the new mod", err, { allowReport: false });
      resolve();
    }
  });
}

function restorePakAttributes(api, applied) {
  for (let i = applied.length - 1; i >= 0; i--) {
    const item = applied[i];
    try {
      rollbackStagedPakRenames(item.done);
    } catch (err) {
      log("error", "Permafrost could not undo a pak rename", err);
    }
    try {
      api.store.dispatch(
        actions.setModAttributes(GAME_ID, item.modId, {
          ...item.attributes,
          pakFiles: item.previous,
        }),
      );
    } catch (err) {
      log("error", "Permafrost could not restore pakFiles after a failed rename", err);
    }
  }
}

function applyPakRenameChoice(api, plan) {
  const staging = selectors.installPathForGame(api.getState(), GAME_ID);
  if (!staging) throw new Error("Permafrost staging folder is not set.");
  const applied = [];
  try {
    for (const item of plan || []) {
      const mod = modsFor(api)[item.modId];
      if (!mod || !mod.installationPath) throw new Error("Mod " + item.modId + " has no staging folder.");
      const modRoot = modStagingRoot(staging, mod.installationPath);
      if (!modRoot) throw new Error("Mod " + item.modId + " staging path is outside the install folder.");
      const attributes = { ...(mod.attributes || {}) };
      const previous = attributes.pakFiles;
      const done = applyStagedPakRenames(modRoot, item.renames);
      try {
        api.store.dispatch(
          actions.setModAttributes(GAME_ID, item.modId, {
            ...attributes,
            pakFiles: renamePakFiles(previous, item.renames),
          }),
        );
      } catch (err) {
        rollbackStagedPakRenames(done);
        throw err;
      }
      applied.push({ modId: item.modId, done, previous, attributes });
    }
  } catch (err) {
    restorePakAttributes(api, applied);
    throw err;
  }
}

async function onWillDeploy(api, profileId, lastDeployment) {
  try {
    await onModLoaderWillDeploy(api, profileId, lastDeployment);
  } catch (err) {
    log("error", "Permafrost ModLoader deploy step failed", err);
  }
  const profile = profileFor(api, profileId);
  if (!profile) return;
  const projectRoot = projectRootFrom(api);
  if (!projectRoot || !fs.existsSync(projectRoot)) return;
  // Stash config.lua before the activator removes a disabled mod's files.
  try {
    stashDisabledConfigs(api, profile, projectRoot);
  } catch (err) {
    log("error", "Permafrost config stash failed", err);
  }
  let incoming = [];
  let records = [];
  let onDisk = new Set();
  let keepers = new Map();
  let removeIds = [];
  try {
    const modState = profile.modState || {};
    const deploying = [];
    for (const [id, mod] of Object.entries(modsFor(api))) {
      records.push({
        id,
        name: modDisplayName(mod, id),
        installationPath: mod && mod.installationPath,
        pakFiles: mod && mod.attributes ? mod.attributes.pakFiles : undefined,
      });
      if (modState[id] && modState[id].enabled === true) deploying.push(id);
    }
    onDisk = listPakNames(projectRoot);
    const conflicts = findPakConflicts(records, deploying, onDisk);
    keepers = keepersFromDeployment(lastDeployment, records);
    const protectedIds = protectedModIds(lastDeployment, records);
    incoming = withoutPakKeepers(conflicts, keepers).filter((conflict) => !protectedIds.has(conflict.modId));
    for (const conflict of incoming) {
      if (conflict && conflict.modId && !removeIds.includes(conflict.modId)) removeIds.push(conflict.modId);
    }
  } catch (err) {
    log("error", "Permafrost pak conflict check failed", err);
    return;
  }
  if (incoming.length === 0) return;
  let plan = [];
  try {
    plan = planPakRenames(records, incoming, onDisk);
  } catch (err) {
    log("error", "Permafrost pak auto-rename plan failed", err);
    api.showErrorNotification("Permafrost could not choose new names", err, { allowReport: false });
    await removeIncomingMods(api, profileId, removeIds);
    return;
  }
  const result = await api.showDialog(
    "question",
    "Files already belong to another mod",
    {
      bbcode: pakConflictDialog(incoming, plan, keepers),
    },
    [
      { label: "Cancel", default: true },
      { label: "Auto-rename" },
    ],
  );
  if (result && result.action === "Auto-rename") {
    try {
      applyPakRenameChoice(api, plan);
    } catch (err) {
      log("error", "Permafrost pak auto-rename failed", err);
      api.showErrorNotification("Permafrost could not rename the files", err, { allowReport: false });
      await removeIncomingMods(api, profileId, removeIds);
    }
    return;
  }
  await removeIncomingMods(api, profileId, removeIds);
}

function stashDisabledConfigs(api, profile, projectRoot) {
  const modState = profile.modState || {};
  for (const [modId, mod] of Object.entries(modsFor(api))) {
    const folder = mod && mod.attributes && mod.attributes.ue4ssModFolder;
    if (!folder) continue;
    const id = (mod && mod.id) || modId;
    if (modState[id] && modState[id].enabled === true) continue;
    preserveModConfig(projectRoot, folder);
  }
}

function onRemove(api, gameId, modId) {
  if (gameId !== GAME_ID) return;
  try {
    const mod = modsFor(api)[modId];
    const projectRoot = projectRootFrom(api);
    if (!mod || !projectRoot) return;
    dropModLine({
      projectRoot,
      ue4ssModFolder: recordOf(mod).ue4ssModFolder,
    });
  } catch (err) {
    log("error", "Permafrost remove-mod cleanup failed", err);
    api.showErrorNotification("Permafrost could not remove the mod from mods.txt", err, {
      allowReport: false,
    });
  }
}

function onRemoved(api, gameId, modId, options) {
  if (gameId !== GAME_ID) return Promise.resolve();
  try {
    const mod = modsFor(api)[modId] || (options && options.modData);
    const projectRoot = projectRootFrom(api);
    if (!mod || !projectRoot) return Promise.resolve();
    removeRecord(projectRoot, mod, modsFor(api));
  } catch (err) {
    log("error", "Permafrost did-remove-mod cleanup failed", err);
    api.showErrorNotification("Permafrost could not remove leftover mod files", err, {
      allowReport: false,
    });
  }
  return Promise.resolve();
}

function setUe4ssBit(api, modId, enabled) {
  const mod = modsFor(api)[modId];
  if (!mod) return;
  api.store.dispatch(
    actions.setModAttributes(GAME_ID, modId, {
      ...(mod.attributes || {}),
      ue4ssEnabled: enabled,
    }),
  );
  const profile = profileFor(api);
  if (profile) reconcileDeployed(api, profile);
}

function modsTxtText(api) {
  const projectRoot = projectRootFrom(api);
  if (!projectRoot) return "";
  const modsTxt = projectPaths(projectRoot).modsTxt;
  if (!fs.existsSync(modsTxt)) return "";
  return fs.readFileSync(modsTxt, "utf8");
}

function readRows(api) {
  const profile = profileFor(api);
  if (!profile) return [];
  const modState = profile.modState || {};
  const rows = Object.entries(modsFor(api))
    .filter(([, mod]) => mod.attributes?.ue4ssModFolder && modState[mod.id]?.enabled === true)
    .map(([modId, mod]) => ({
      id: mod.id || modId,
      name: mod.attributes.ue4ssModFolder,
      enabled: mod.attributes.ue4ssEnabled !== false,
      ue4ssEnabled: mod.attributes.ue4ssEnabled !== false,
      order: undefined,
    }));
  return assignMissingOrder(rows, modsTxtText(api)).slice().sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const left = String(a.name).toLowerCase();
    const right = String(b.name).toLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}

function modRecord(api, row) {
  const mods = modsFor(api);
  if (row.id && mods[row.id]) return { id: row.id, mod: mods[row.id] };
  const key = String(row.name || "").toLowerCase();
  for (const [modId, mod] of Object.entries(mods)) {
    const id = mod.id || modId;
    if (row.id && id === row.id) return { id, mod };
    const folder = mod.attributes && mod.attributes.ue4ssModFolder;
    if (folder && String(folder).toLowerCase() === key) return { id, mod };
  }
  return null;
}

function applyUe4ssPlace(api, name, oneBased) {
  const current = readRows(api);
  // placeUe4ss writes new order numbers and leaves the array sequence alone.
  const before = orderedNames(current);
  const from = before.findIndex((item) => item.toLowerCase() === String(name || "").toLowerCase()) + 1;
  const moved = placeUe4ss(current, name, oneBased);
  const after = orderedNames(moved);
  if (before.join("\0") === after.join("\0")) {
    let reason = "same order";
    if (isBuiltin(name)) reason = "built-in";
    else if (from < 1) reason = "name missing";
    else if (oneBased === from) reason = "same position";
    else if (!(oneBased >= 1 && oneBased <= before.length)) reason = "out of range";
    log("info", "Permafrost UE4SS reorder skipped", { name, from, to: oneBased, reason });
    return;
  }
  const updates = [];
  for (const row of moved) {
    if (row.enabled !== true) continue;
    const found = modRecord(api, row);
    if (!found) {
      log("info", "Permafrost UE4SS reorder skipped", { name, from, to: oneBased, reason: "mod missing" });
      api.showErrorNotification("Permafrost could not reorder that mod", row.name || name, {
        allowReport: false,
      });
      return;
    }
    updates.push({ id: found.id, mod: found.mod, order: row.order });
  }
  const projectRoot = projectRootFrom(api);
  const profile = profileFor(api);
  if (!projectRoot || !profile) {
    log("info", "Permafrost UE4SS reorder skipped", { name, from, to: oneBased, reason: "no profile" });
    return;
  }
  // Write mods.txt before the attribute dispatch. The page subscriber
  // re-reads the file during that dispatch, and a late read kept the old order.
  const owned = ownedFromProfile(api, profile, projectRoot).map((entry) => {
    const match = moved.find(
      (row) => row.enabled === true && String(row.name).toLowerCase() === String(entry.name).toLowerCase(),
    );
    if (!match) return entry;
    return { ...entry, order: match.order };
  });
  writeModsFile(projectRoot, owned);
  for (const update of updates) {
    api.store.dispatch(
      actions.setModAttributes(GAME_ID, update.id, {
        ...(update.mod.attributes || {}),
        ue4ssOrder: update.order,
      }),
    );
  }
  reconcileDeployed(api, profile);
}

function Ue4ssPage(props) {
  const { api } = props;
  const [rows, setRows] = React.useState([]);
  const [buildLabel, setBuildLabel] = React.useState("");
  React.useEffect(() => {
    const refresh = () => setRows(readRows(api));
    refresh();
    return api.store.subscribe(refresh);
  }, [api]);
  React.useEffect(() => {
    const gamePath = discoveryPath(api);
    if (!gamePath) {
      setBuildLabel("Permafrost is not discovered yet.");
      return;
    }
    try {
      setBuildLabel(readInstalledBuildLabel(gamePath));
    } catch (err) {
      log("warn", "Permafrost UE4SS version check failed", err);
      setBuildLabel("could not be read");
    }
  }, [api]);

  const checked = rows.filter((row) => row.ue4ssEnabled);
  const arrowSlot = 24;
  const menuSlot = 72;
  const slot = (width, child) =>
    React.createElement(
      "span",
      { style: { display: "inline-flex", width, height: arrowSlot, flexShrink: 0, justifyContent: "center" } },
      child,
    );
  const reorderTo = (row, from, to) => (evt) => {
    log("info", "Permafrost UE4SS reorder click", { name: row.name, from, to });
    evt.preventDefault();
    evt.stopPropagation();
    applyUe4ssPlace(api, row.name, to);
    setRows(readRows(api));
  };
  const arrowButton = (row, label, to, isDisabled) =>
    React.createElement(
      "button",
      {
        type: "button",
        className: isDisabled
          ? "nxm-button nxm-button-neutral nxm-button-subdued nxm-button-sm nxm-button-icon-only nxm-button-disabled"
          : "nxm-button nxm-button-neutral nxm-button-subdued nxm-button-sm nxm-button-icon-only",
        style: { width: arrowSlot, height: arrowSlot, padding: 0, lineHeight: 1 },
        disabled: isDisabled,
        title: label === "↑" ? "Move up" : "Move down",
        "aria-label": label === "↑" ? "Move up" : "Move down",
        onClick: reorderTo(row, checked.findIndex((item) => item.id === row.id) + 1, to),
      },
      label,
    );
  const items =
    rows.length === 0
      ? React.createElement("p", null, "No deployed UE4SS script mods.")
      : React.createElement(
          "ul",
          { style: { listStyle: "none", padding: 0, margin: 0 } },
          rows.map((row) => {
            const pos = checked.findIndex((item) => item.id === row.id);
            const from = pos + 1;
            const controls = row.ue4ssEnabled
              ? [
                  arrowButton(row, "↑", from - 1, pos <= 0),
                  arrowButton(row, "↓", from + 1, pos < 0 || pos >= checked.length - 1),
                  React.createElement(
                    "select",
                    {
                      key: "position",
                      value: String(from),
                      "aria-label": "Position of " + row.name,
                      title: "Position",
                      style: {
                        width: menuSlot,
                        height: arrowSlot,
                        background: "var(--color-surface-high)",
                        color: "inherit",
                        border: "1px solid var(--color-stroke-weak)",
                        borderRadius: 4,
                        padding: "0 4px",
                      },
                      onChange: (evt) => reorderTo(row, from, Number(evt.target.value))(evt),
                    },
                    checked.map((_, index) =>
                      React.createElement("option", { key: index + 1, value: String(index + 1) }, String(index + 1)),
                    ),
                  ),
                ]
              : [null, null, null];
            return React.createElement(
              "li",
              {
                key: row.id,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "var(--color-surface-mid)",
                  borderBottom: "1px solid var(--color-stroke-weak)",
                },
              },
              slot(arrowSlot, controls[0]),
              slot(arrowSlot, controls[1]),
              slot(menuSlot, controls[2]),
              React.createElement(
                "label",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    margin: 0,
                    minWidth: 0,
                    flex: "1 1 auto",
                  },
                },
                React.createElement("input", {
                  type: "checkbox",
                  checked: row.ue4ssEnabled,
                  onChange: (evt) => setUe4ssBit(api, row.id, evt.target.checked),
                }),
                React.createElement(
                  "span",
                  { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                  row.name,
                ),
              ),
            );
          }),
        );

  return React.createElement(
    "div",
    { style: { padding: 16, overflow: "auto", height: "100%" } },
    React.createElement("h2", { style: { marginTop: 0 } }, "UE4SS"),
    React.createElement("p", null, "Installed build: ", buildLabel),
    React.createElement(
      "p",
      null,
      "A checked mod is written as Name : 1. An unchecked mod is written as Name : 0 and the folder stays deployed. The arrows swap a checked mod with the next checked row. The position menu lifts it out and inserts it at that number. That includes the script line of a mixed mod. Pak files are not reordered. ",
      KEYBINDS_COMMENT,
      " stays where it is, and Keybinds stays last. Turning a mod off on the Mods page removes its script folder, its recorded pak and text files, and its line. config.lua and Scripts\\config.lua are copied to ue4ss\\VortexSettings\\ModName and written back the next time that mod deploys.",
    ),
    items,
  );
}

async function setupGame(api, discovery) {
  if (!discovery || !discovery.path) throw new Error("Permafrost is not discovered yet.");
  ensureDeployDirs(discovery.path);
  try {
    await vortexFs.ensureDirWritableAsync(win64Dir(discovery.path), () => Promise.resolve());
    await ensureUe4ss(discovery.path, api, { cleanupDownload: true });
  } catch (err) {
    if (err && err.code === "UE4SS_DECLINED") {
      api.showErrorNotification(
        "Permafrost needs UE4SS experimental",
        err.message,
        { allowReport: false },
      );
      throw new util.ProcessCanceled(err.message);
    }
    log("error", "Permafrost UE4SS setup failed", err);
    throw err;
  }
}

function main(context) {
  context.registerGame({
    id: GAME_ID,
    name: "Permafrost",
    shortName: "Permafrost",
    logo: "permafrost.jpg",
    mergeMods: false,
    requiresCleanup: true,
    queryArgs: { steam: [{ id: STEAM_APP_ID, prefer: 0 }] },
    queryModPath: () => MODS_REL,
    executable: () => SHIPPING_EXE,
    requiredFiles: [SHIPPING_EXE],
    setup: (discovery) => setupGame(context.api, discovery),
    compatible: { dinput: false, enb: false },
    requiresLauncher: () => Promise.resolve(undefined),
    details: {
      steamAppId: Number(STEAM_APP_ID),
      supportsSymlinks: false,
    },
    environment: { SteamAPPId: STEAM_APP_ID },
    modPath: MODS_REL,
    modPathIsRelative: true,
  });

  registerModType(context, SCRIPTS_ID, 40, MODS_REL.split(path.sep), "UE4SS Scripts");
  registerModType(context, PAK_ID, 42, PAKS_REL.split(path.sep), "Paks");
  registerModType(context, LOGIC_ID, 44, LOGIC_REL.split(path.sep), "LogicMods");
  registerModType(context, MIXED_ID, 46, [], "Script and Pak");
  registerModType(context, MODLOADER_ID, 48, [], "ModLoader");

  context.registerInstaller(SCRIPTS_ID, 25, testScripts, installScripts);
  context.registerInstaller(
    MODLOADER_ID,
    27,
    testModLoader,
    (files, destinationPath, gameId, progress, choices, unattended, archivePath) =>
      installModLoader(context.api, files, destinationPath, gameId, progress, choices, unattended, archivePath),
  );
  context.registerInstaller(LOGIC_ID, 31, testLogic, installLogic);
  context.registerInstaller(PAK_ID, 35, testPak, installPak);
  context.registerInstaller("permafrost-reject", 45, testReject, installReject);

  context.registerMainPage("sort-none", "UE4SS", Ue4ssPage, {
    id: "permafrost-ue4ss",
    priority: 120,
    group: "per-game",
    visible: () => selectors.activeGameId(context.api.getState()) === GAME_ID,
    props: () => ({ api: context.api }),
  });

  registerOpenAction(context, "Open UE4SS Mods Folder", (project) =>
    path.join(project, MODS_IN_PROJECT),
  );
  registerOpenAction(context, "Open mods.txt", (project) =>
    path.join(project, MODS_IN_PROJECT, "mods.txt"),
  );
  registerOpenAction(context, "Open Paks Folder", (project) => path.join(project, "Content", "Paks"));

  context.once(() => {
    const discovered = discoveryPath(context.api);
    if (discovered) {
      try {
        ensureDeployDirs(discovered);
      } catch (err) {
        log("warn", "Permafrost deploy folders were not created", err);
      }
    }
    context.api.onAsync("will-deploy", (profileId, lastDeployment) =>
      onWillDeploy(context.api, profileId, lastDeployment),
    );
    context.api.onAsync("did-deploy", (profileId) => onDeploy(context.api, profileId));
    context.api.onAsync("did-purge", (profileId) => onPurge(context.api, profileId));
    context.api.onAsync("did-remove-mod", (gameId, modId, options) =>
      onRemoved(context.api, gameId, modId, options),
    );
    context.api.events.on("remove-mod", (gameId, modId) => onRemove(context.api, gameId, modId));
    syncModLoaderTool(context.api);
  });

  return true;
}

module.exports = {
  default: main,
};
