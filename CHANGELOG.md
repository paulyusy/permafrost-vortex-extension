# Permafrost Vortex Extension

## 1.0.5

- UE4SS setup reads the experimental-latest release and downloads the one zip whose name starts with `UE4SS_v3.0.1-`. The question and the UE4SS page name that build. `dwmapi.dll` and `ue4ss\UE4SS.dll` inside the zip are the current hashes for that run. A matching install is left alone. A different install gets the same question as before. A failed lookup, or a release that does not list exactly one of those zips, stops before the download and names the status or the files it found.

## 1.0.4

- Keep existing is remembered for that mod, and the same stored value does not ask again while the live value stays. The question still appears the first time a stored key differs from `Config\PermafrostModLoader.ini`, and again when that live value or the stored value changes.
- An already deployed mod whose stored ini is unchanged is not merged again. Values you edited in `Config\PermafrostModLoader.ini` stay. A mod new to this deployment, or one whose stored ini changed, is merged. A key absent from that text is not a conflict.
- A UE4SS mod that ships `Scripts\main.lua` and `dlls\main.dll` together installs both under the mod folder. A `.dll` or `.exe` outside that folder still fails as a content pack.

## 1.0.3

- A Permafrost ModLoader DLL is a `.dll` that exports `PermafrostModQuery` and `PermafrostModLoad`. It deploys to the game folder's `Mods` directory. `PermafrostModLoader.exe` and `PermafrostModHost.dll` deploy to the game folder. `Config` files and the loader's `README.txt`, `VALIDATION.txt`, `SHA256SUMS.txt`, and `*.ini.example` keep their paths. None of those files are copied into `Content\Paks`.
- Installing a ModLoader DLL asks for the API only when `PermafrostModLoader.exe` or `PermafrostModHost.dll` is missing from the game folder. The question names the missing file. Cancel is the default and leaves the download in Vortex. Continue installs the DLL. When both files are already in the game folder, that question is skipped. A DLL with no ini still warns on the first deploy.
- When `PermafrostModLoader.exe` is in the game folder, the Tools page lists it as Permafrost ModLoader API and pins it above Play. A pin you removed stays removed. It is not set as the default launcher. A hand-edited tool row is left as it is. The row is removed when that exe is gone.
- `PermafrostModLoader.ini` at the archive root or in `Config` is merged into the game folder's `Config\PermafrostModLoader.ini`. The file is created when it is missing. New sections and new keys are added. An existing key with the same value stays. An existing key with a different value stays unless you choose Use the mod values. A DLL that ships no ini warns that its settings have to be added by hand. Uninstall removes the DLL and does not delete ini keys.
- A `.dll` or `.exe` outside a UE4SS `Scripts` or `dlls` folder is not a content pack. An archive that also contains a pak or `Scripts\main.lua` fails and names that file.
- The game folder's `Mods` directory is created when Vortex asks for a deploy path, and again during setup.
- `PermafrostModLoader.exe` or `PermafrostModHost.dll` already owned by another installed mod stops that deploy. Cancel removes the new mod. Those names are not renamed.
- Reinstall the ModLoader and any ModLoader DLL after updating this extension. Deploy alone keeps the `Content\Paks` file list from the earlier install.

## 1.0.2

- UE4SS experimental `3.0.1-1181-g83330635` installs with `dwmapi.dll` beside `Permafrost-Win64-Shipping.exe` and `UE4SS.dll`, `UE4SS-settings.ini`, and `Mods` inside `Binaries\Win64\ue4ss`. Setup identifies the files by hash and offers one fix. A missing install is downloaded. A flat UE4SS 3.0.1 install is switched: the loader beside the exe is removed and the experimental files are written into `ue4ss`. A 3.0.1 or other loader already inside `ue4ss` is replaced. An extra `UE4SS.dll` beside a current install is removed on its own. `mods.txt`, the settings ini, and installed mod folders stay. `Binaries\Win64\Mods` stays.
- UE4SS script mods deploy to `Binaries\Win64\ue4ss\Mods\<ModName>\`. `Scripts\main.lua` stays inside `Scripts`, and a file beside it, such as a cfg, stays there. UE4SS loads `Scripts\main.lua`. A `main.lua` placed directly in the mod folder does not run. A dll mod keeps `dlls\main.dll`.
- Reinstall a script mod after updating this extension. Deploy alone keeps the file list from the earlier install. Quit the game before managing it, so the proxy and the flat loader can be replaced.
- `Binaries\Win64\ue4ss\Mods` and `Content\Paks\LogicMods` are created when Vortex asks for a deploy path, and again during setup. Vortex treats a missing directory as not writable and then refuses Hardlink Deployment. The folders are created empty. `Binaries\Win64\Mods` stays.
- The UE4SS page names the installed build under the header. The experimental build is `3.0.1-1181-g83330635`. A release loader is `3.0.1`. A loader that matches neither is an unrecognized build. No loader is reported as not installed. The label uses the loader identity from the same check that decides the install offer.

## 1.0.1

- The UE4SS page shows each mod on its own bar. A checked mod has an up arrow, a down arrow, and a position menu from 1 through the number of checked mods. The arrows swap with the next checked row. The menu lifts that mod out and inserts it at the chosen number. That includes the script line of a mixed mod. Pak files are not reordered.
- An unchecked mod stays on its `Name : 0` line. Comments, blank lines, and built-in lines stay put, and `Keybinds` stays last.

## 1.0.0

- Adds Permafrost to Vortex and launches `Permafrost-Win64-Shipping.exe`.
- Installs UE4SS script folders, pak/ucas/utoc files, LogicMods, and loose readmes from one archive.
- Writes `mods.txt` in place. Built-in lines stay put, and `Keybinds` stays last.
- Uninstall and purge remove the script folder, the recorded pak and text files, and the `mods.txt` line.
- If `dwmapi.dll` is missing beside the shipping exe, Vortex can download UE4SS 3.0.1. An existing install is left as it is.
- Creates `Content\Paks\LogicMods` during setup when that folder is missing, so hardlink deployment can be selected.
- UE4SS script files deploy into the mod folder. The `Scripts` directory is not part of the destination. A dll mod keeps `dlls`, so `dlls\main.dll` stays `Mods\<ModName>\dlls\main.dll`.
- Authors name pak, ucas, utoc, and loose text files with the mod name. They land flat in `Content\Paks`.
- Script, pak, LogicMods, and mixed mod types deploy straight into their target folders. A mixed mod is not placed under a folder named after the Vortex mod id.
- Removing a mod drops its `mods.txt` line and leaves the deployed files for Vortex. Leftover files are deleted only when they are still present.
- Uninstall retries a script or dll folder when Windows says the directory is not empty, and still removes the `mods.txt` line if that folder remains.
- The archive example is a `TestMod` folder: `Scripts\main.lua`, `Scripts\lib\util.lua`, `dlls\main.dll`, mod-named pak files, `LogicMods\TestMod.pak`, and `TestMod.txt`. Loose text shares `Content\Paks`, so the readme uses the mod name.
- Before deploy, a pak, ucas, utoc, or loose text name already owned by an installed mod raises a warning. The dialog names each file and its owner. The installed mod keeps its names. Cancel removes the new mod and its Vortex download from the mod list and installs nothing. A file or script folder that an installed mod still records is left in place. Auto-rename deploys only the new mod, renaming every file it claims, including files that did not collide. Pak, ucas, utoc, LogicMods, and loose text that share a base name take one suffix, `_01`, then `_02` when `_01` is taken. The dialog shows the full renamed set before deploy. Those names are stored on the new mod so uninstall and purge remove them.
