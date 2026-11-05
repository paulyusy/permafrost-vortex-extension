# Permafrost Vortex Extension

Install by dropping `Permafrost Vortex Extension-1.0.5.zip` on Vortex's Extensions page, then restart Vortex. It is not installed from the Mods page.

Vortex decides where a Permafrost mod goes from the folder layout. There is no manifest. The readme is not parsed.

Pack one top-level folder. Its name is the mod name, and it is the name Vortex writes into `mods.txt`.

Mod archive structure — example:

```
TestMod\
  Scripts\
    main.lua
    lib\
      util.lua
  dlls\
    main.dll
  TestMod.pak
  TestMod.ucas
  TestMod.utoc
  LogicMods\
    TestMod.pak
  TestMod.txt
```

Name the readme after the mod: `TestMod.txt`. Loose text is copied into `Content\Paks` beside the pak files. Every mod shares that one folder, so a second mod that also ships `readme.txt` replaces the first mod's file.

Before deploy, Vortex checks `Content\Paks` and `Content\Paks\LogicMods`. If a pak, ucas, utoc, or loose text file from a newly installed mod is already owned by an installed mod, it lists every overlapping file with the mod that owns it, such as `Content\Paks\TestMod.pak owned by TestMod One`. The installed mod keeps its names. Cancel removes the new mod and its Vortex download from the mod list and installs nothing. A file or script folder that an installed mod still records is left in place. Auto-rename deploys only the new mod. It renames every file that new mod claims, including ones that did not collide: pak, ucas, utoc, a LogicMods pak, and loose text such as `TestMod.txt`. Files that share a base name take one suffix, `_01`, then `_02` if `_01` is taken. `TestMod.pak`, `TestMod.ucas`, `TestMod.utoc`, and `TestMod.txt` become `TestMod_01.pak`, `TestMod_01.ucas`, `TestMod_01.utoc`, and `TestMod_01.txt`. The dialog shows that full set before the deploy continues. The renamed names are saved on the new mod, so uninstall and purge remove those files.

- `Scripts\main.lua` becomes `Binaries\Win64\ue4ss\Mods\TestMod\Scripts\main.lua`. `Scripts\lib\util.lua` becomes `Binaries\Win64\ue4ss\Mods\TestMod\Scripts\lib\util.lua`. UE4SS loads that `Scripts\main.lua`. A dll mod keeps its folder the same way: `dlls\main.dll` becomes `Binaries\Win64\ue4ss\Mods\TestMod\dlls\main.dll`. A mod that ships `Scripts\main.lua` and `dlls\main.dll` together keeps both.
- `.pak`, `.ucas`, and `.utoc` files sitting loose in the mod folder are resource paks. Name all three after the mod, such as `TestMod.pak`, `TestMod.ucas`, and `TestMod.utoc`. They land flat in `Content\Paks`. There is no per-mod subfolder, so those names have to be unique too.
- A `LogicMods` subfolder holds blueprint paks. Name those containers after the mod too. They land flat in `Content\Paks\LogicMods`.
- A readme, changelog, or license sitting loose in the mod folder lands in `Content\Paks` with the paks. Prefix it with the mod name, `TestMod.txt`. A text file inside `Scripts` or `dlls` stays with the script mod, so `Scripts\notes.txt` becomes `Binaries\Win64\ue4ss\Mods\TestMod\Scripts\notes.txt` and does not share the pak folder.
- A Permafrost ModLoader DLL exports `PermafrostModQuery` and `PermafrostModLoad`. It lands in the game folder's `Mods` directory, next to `Engine`, not in `Binaries\Win64\ue4ss\Mods` and not in `Content\Paks`. Installing one asks for the API only when `PermafrostModLoader.exe` or `PermafrostModHost.dll` is missing from the game folder. The question names the missing file. Cancel leaves the download in Vortex. Continue installs the DLL. When both files are already there, that question is skipped. When `PermafrostModLoader.exe` is in the game folder, the Tools page lists it as Permafrost ModLoader API and pins it above Play. Play still launches `Permafrost-Win64-Shipping.exe`, or a launcher you already chose. A pin you removed stays removed. If ten other tools are already pinned, this one stays on the Tools page and is not pinned. A hand-edited tool row is left as it is. The row is removed when that exe is gone. It is not set as the default launcher. `PermafrostModLoader.exe` and `PermafrostModHost.dll` land in the game folder. `PermafrostModLoader.ini` at the archive root or in `Config` is merged into `Config\PermafrostModLoader.ini`. The file is created when it is missing. New sections and new keys are added. An existing key with the same value stays. An existing key with a different value stays unless you choose Use the mod values. Keep existing is remembered for that mod, and the same stored value does not ask again while the live value stays. An already deployed mod whose stored ini is unchanged is not merged again. A mod new to this deployment, or one whose stored ini changed, is merged. Uninstall removes the DLL and does not delete ini keys. A DLL with no ini warns that its settings have to be added by hand. `PermafrostModLoader.exe` or `PermafrostModHost.dll` already owned by another installed mod stops that deploy. Cancel removes the new mod. Those names are not renamed. A `.dll` or `.exe` shipped beside a pak or a `Scripts\main.lua` is not installed.

One archive can contain any mix of those. The script side and the pak side both install. Uninstall removes the script folder, the pak files, the parked text file, and the `mods.txt` line.

Do not ship `mods.txt` or `enabled.txt`. Vortex writes the one `mods.txt` line. An `enabled.txt` file would start the mod while that line is `: 0`.

Do not use the basenames `Permafrost-Windows` or `global` for a pak, ucas, or utoc. Those files belong to the game.

On the UE4SS page, a check writes `ModName : 1` and an uncheck writes `ModName : 0`. The folder stays either way. Each mod is its own bar. A checked mod has an up arrow, a down arrow, and a position menu from 1 through the number of checked mods. The arrows swap with the next checked row. The menu lifts that mod out and inserts it at the chosen number, including the script line of a mixed mod. Pak files are not reordered. An unchecked line stays where it is. Turning the mod off on the Mods page, uninstalling it, or purging removes the files and the line. `Keybinds` stays last.

Each time the game is managed, Vortex reads the UE4SS experimental-latest release and downloads the one zip whose name starts with `UE4SS_v3.0.1-`. The zip name is the build name. Vortex compares `dwmapi.dll` and `ue4ss\UE4SS.dll` in that zip with the files beside `Permafrost-Win64-Shipping.exe` and inside `Binaries\Win64\ue4ss`. A match is left alone. Anything else gets one question that names that build, and Yes confirms `Binaries\Win64` is writable first. A failed lookup, or a release that does not list exactly one of those zips, stops before the download and names the status or the files it found.

- Nothing installed: Yes downloads the experimental archive into `Binaries\Win64\ue4ss`.
- UE4SS 3.0.1 beside the exe: Yes removes that `UE4SS.dll`, replaces the proxy, and installs the experimental build into `ue4ss`. `Binaries\Win64\Mods` stays. Reinstall script mods so they deploy under `ue4ss\Mods`.
- UE4SS 3.0.1, or any other build, already inside `ue4ss`: Yes replaces that loader. `mods.txt`, the settings ini, and installed mod folders stay.
- The experimental build is in place and a second `UE4SS.dll` is still beside the exe: Yes removes that extra loader and does not download.
- Some required file is missing, or the proxy is a different file: Yes fills the gaps and replaces a proxy that is not this build.

The experimental proxy loads `ue4ss\UE4SS.dll`. UE4SS reads `Mods` and the ini from that same `ue4ss` folder. Quit Permafrost before choosing Yes. Declining leaves the game unmoddable until that case is fixed. Reinstall a script mod after updating this extension. Deploy alone keeps the file list from the earlier install. When Vortex asks for a deploy path, and again during setup, the extension creates empty `Binaries\Win64\ue4ss\Mods`, `Content\Paks\LogicMods`, and game-folder `Mods` directories. Vortex treats a missing directory as not writable and then refuses Hardlink Deployment. `Binaries\Win64\Mods` stays where it is. Reinstall the ModLoader and any ModLoader DLL after updating this extension. Deploy alone keeps the `Content\Paks` file list from the earlier install.

Released under the [MIT License](LICENSE). Copyright 2026 Paulyus.
