[size=5][b]Permafrost Vortex Extension[/b][/size]
[size=3]v1.0.6[/size]

[size=4][b]Description[/b][/size]
Adds Permafrost to Vortex and installs its UE4SS mods, pak mods, and Permafrost ModLoader DLLs.

Vortex reads the archive layout. There is no manifest, and the readme is not parsed. One download can contain a script mod and pak files together. Enable and disable write the game's [font=Courier New]mods.txt[/font] in place. Uninstall and purge remove the deployed files and that line.

The extension launches [font=Courier New]Permafrost-Win64-Shipping.exe[/font]. It does not start the root [font=Courier New]Permafrost.exe[/font] launcher. When [font=Courier New]PermafrostModLoader.exe[/font] is in the game folder, the Tools page lists it as Permafrost ModLoader API and pins it above Play. Play still launches the shipping exe, or a launcher you already chose.

[size=4][b]Installation instructions[/b][/size]
[b]Vortex[/b]
[list=1]
[*] Install Permafrost on Steam.
[*] Close Vortex if it is open.
[*] Drop [font=Courier New]Permafrost Vortex Extension-1.0.6.zip[/font] on Vortex's Extensions page.
[*] Start Vortex again.
[*] Manage Permafrost. This zip is not installed from the Mods page.
[/list]

Each time the game is managed, Vortex reads the UE4SS loader under the discovered game folder. It uses the ProductVersion on [font=Courier New]Permafrost\Binaries\Win64\ue4ss\UE4SS.dll[/font] and on [font=Courier New]Permafrost\Binaries\Win64\UE4SS.dll[/font], and the directory names on that path. A version with a dash and a commit hash, such as [font=Courier New]3.0.1-1208-gf6f8dc3cc[/font], or a version that is only a commit hash, such as [font=Courier New]6f8dc3cc[/font], is experimental. An experimental install is left alone. There is no question and no download. A loader that is neither experimental nor stable 3.0.1 is left alone too. The UE4SS page shows that version and does not contact GitHub.

The question is asked only when no [font=Courier New]UE4SS.dll[/font] is in either place, or when every loader that is present is stable 3.0.1. A proxy with no loader still counts as not installed. Yes downloads one pinned zip and checks its SHA-256 before anything is deleted or written: [url=https://github.com/paulyusy/UE4SS_v3.0.1-1208-g6f8dc3cc-Experimental/releases/download/UE4SS_v3.0.1-1208-g6f8dc3cc/UE4SS_v3.0.1-1208-g6f8dc3cc.zip]UE4SS_v3.0.1-1208-g6f8dc3cc.zip[/url]. SHA-256 [font=Courier New]899b6dbe84539c0b19d5ef08eb3a6e99e2195ebc0706baf24fe5799e3a6888f8[/font]. A different hash is deleted and nothing is written. Setup confirms [font=Courier New]Binaries\Win64[/font] is writable before the question. Quit Permafrost before choosing Yes.

[list]
[*] Nothing installed: Yes installs that build. [font=Courier New]dwmapi.dll[/font] lands beside the exe. The other files land in [font=Courier New]Binaries\Win64\ue4ss[/font].
[*] Stable 3.0.1 beside the exe: Yes removes that [font=Courier New]UE4SS.dll[/font] and installs the pinned build into [font=Courier New]ue4ss[/font]. [font=Courier New]Binaries\Win64\Mods[/font] and [font=Courier New]Binaries\Win64\UE4SS-settings.ini[/font] stay. Reinstall script mods so they deploy under [font=Courier New]ue4ss\Mods[/font].
[*] Stable 3.0.1 inside [font=Courier New]ue4ss[/font]: Yes replaces that loader and refreshes the built-in mod files from the zip, including their Lua. These stay when they already exist: [font=Courier New]ue4ss\UE4SS-settings.ini[/font], [font=Courier New]ue4ss\Mods\mods.txt[/font], [font=Courier New]ue4ss\Mods\mods.json[/font], and [font=Courier New]ue4ss\Mods\BPModLoaderMod\load_order.txt[/font]. A mod folder the zip does not contain stays, including its [font=Courier New]mods.txt[/font] line.
[*] No when nothing is installed stops setup. No when a stable 3.0.1 install is present keeps that install and setup finishes. The next setup asks again while it is still stable.
[/list]

The pinned proxy loads [font=Courier New]ue4ss\UE4SS.dll[/font]. UE4SS reads [font=Courier New]Mods[/font] and the ini from that same [font=Courier New]ue4ss[/font] folder. Reinstall a script mod after updating this extension. Deploy alone keeps the file list from the earlier install. When Vortex asks for a deploy path, and again during setup, the extension creates empty [font=Courier New]Binaries\Win64\ue4ss\Mods[/font], [font=Courier New]Content\Paks\LogicMods[/font], and game-folder [font=Courier New]Mods[/font] directories. Vortex treats a missing directory as not writable and then refuses Hardlink Deployment. [font=Courier New]Binaries\Win64\Mods[/font] stays where it is.

A Permafrost ModLoader DLL exports [font=Courier New]PermafrostModQuery[/font] and [font=Courier New]PermafrostModLoad[/font]. It lands in the game folder's [font=Courier New]Mods[/font] directory. That is not [font=Courier New]Binaries\Win64\ue4ss\Mods[/font] and not [font=Courier New]Content\Paks[/font]. Installing one asks for the API only when [font=Courier New]PermafrostModLoader.exe[/font] or [font=Courier New]PermafrostModHost.dll[/font] is missing from the game folder. The question names the missing file. Cancel leaves the download in Vortex. Continue installs the DLL. When both files are already there, that question is skipped. When [font=Courier New]PermafrostModLoader.exe[/font] is in the game folder, the Tools page lists it as Permafrost ModLoader API and pins it above Play. Play still launches [font=Courier New]Permafrost-Win64-Shipping.exe[/font], or a launcher you already chose. A pin you removed stays removed. If ten other tools are already pinned, this one stays on the Tools page and is not pinned. A hand-edited tool row is left as it is. The row is removed when that exe is gone. It is not set as the default launcher. [font=Courier New]PermafrostModLoader.exe[/font] and [font=Courier New]PermafrostModHost.dll[/font] land in the game folder. [font=Courier New]PermafrostModLoader.ini[/font] at the archive root or in [font=Courier New]Config[/font] is merged into [font=Courier New]Config\PermafrostModLoader.ini[/font]. The file is created when it is missing. New sections and new keys are added. An existing key with the same value stays. An existing key with a different value stays unless you choose Use the mod values. Keep existing is remembered for that mod, and the same stored value does not ask again while the live value stays. An already deployed mod whose stored ini is unchanged is not merged again. A mod new to this deployment, or one whose stored ini changed, is merged. Uninstall removes the DLL and does not delete ini keys. A DLL with no ini warns that its settings have to be added by hand. [font=Courier New]PermafrostModLoader.exe[/font] or [font=Courier New]PermafrostModHost.dll[/font] already owned by another installed mod stops that deploy. Cancel removes the new mod. Those names are not renamed. A [font=Courier New].dll[/font] or [font=Courier New].exe[/font] shipped beside a pak or [font=Courier New]Scripts\main.lua[/font] is not installed. Reinstall the ModLoader and any ModLoader DLL after updating this extension.

[b]Manual[/b]
[list=1]
[*] Close Vortex.
[*] Extract the zip into [font=Courier New]%APPDATA%\Vortex\plugins\permafrost[/font] so [font=Courier New]info.json[/font] and [font=Courier New]index.js[/font] sit in that folder.
[*] Start Vortex and manage Permafrost.
[/list]

Pack a mod as one top-level folder. That folder name is the mod name Vortex writes into [font=Courier New]mods.txt[/font].

Mod archive structure — example:

[code]
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
[/code]

Name the readme after the mod: [font=Courier New]TestMod.txt[/font]. Loose text is copied into [font=Courier New]Content\Paks[/font] beside the pak files. Every mod shares that one folder, so a second mod that also ships [font=Courier New]readme.txt[/font] replaces the first mod's file.

Before deploy, Vortex checks [font=Courier New]Content\Paks[/font] and [font=Courier New]Content\Paks\LogicMods[/font]. If a pak, ucas, utoc, or loose text file from a newly installed mod is already owned by an installed mod, it lists every overlapping file with the mod that owns it, such as [font=Courier New]Content\Paks\TestMod.pak owned by TestMod One[/font]. The installed mod keeps its names. Cancel removes the new mod and its Vortex download from the mod list and installs nothing. A file or script folder that an installed mod still records is left in place. Auto-rename deploys only the new mod. It renames every file that new mod claims, including ones that did not collide: pak, ucas, utoc, a LogicMods pak, and loose text such as [font=Courier New]TestMod.txt[/font]. Files that share a base name take one suffix, [font=Courier New]_01[/font], then [font=Courier New]_02[/font] if [font=Courier New]_01[/font] is taken. [font=Courier New]TestMod.pak[/font], [font=Courier New]TestMod.ucas[/font], [font=Courier New]TestMod.utoc[/font], and [font=Courier New]TestMod.txt[/font] become [font=Courier New]TestMod_01.pak[/font], [font=Courier New]TestMod_01.ucas[/font], [font=Courier New]TestMod_01.utoc[/font], and [font=Courier New]TestMod_01.txt[/font]. The dialog shows that full set before the deploy continues. The renamed names are saved on the new mod, so uninstall and purge remove those files.

[font=Courier New]Scripts\main.lua[/font] becomes [font=Courier New]Binaries\Win64\ue4ss\Mods\TestMod\Scripts\main.lua[/font]. [font=Courier New]Scripts\lib\util.lua[/font] becomes [font=Courier New]Binaries\Win64\ue4ss\Mods\TestMod\Scripts\lib\util.lua[/font]. UE4SS loads that [font=Courier New]Scripts\main.lua[/font]. A dll mod keeps its folder the same way: [font=Courier New]dlls\main.dll[/font] becomes [font=Courier New]Binaries\Win64\ue4ss\Mods\TestMod\dlls\main.dll[/font]. A mod that ships [font=Courier New]Scripts\main.lua[/font] and [font=Courier New]dlls\main.dll[/font] together keeps both. [font=Courier New].pak[/font], [font=Courier New].ucas[/font], and [font=Courier New].utoc[/font] share the mod's name and land flat in [font=Courier New]Content\Paks[/font]. There is no per-mod subfolder, so those names have to be unique too. A [font=Courier New]LogicMods[/font] pak lands flat in [font=Courier New]Content\Paks\LogicMods[/font]. Text inside [font=Courier New]Scripts[/font] or [font=Courier New]dlls[/font] stays with the script mod, so [font=Courier New]Scripts\notes.txt[/font] becomes [font=Courier New]Binaries\Win64\ue4ss\Mods\TestMod\Scripts\notes.txt[/font].

[size=4][b]Main features[/b][/size]
[list]
[*] Registers Permafrost and launches the shipping exe.
[*] When [font=Courier New]PermafrostModLoader.exe[/font] is in the game folder, the Tools page lists it as Permafrost ModLoader API and pins it above Play. Play still launches [font=Courier New]Permafrost-Win64-Shipping.exe[/font], or a launcher you already chose. A pin you removed stays removed. If ten other tools are already pinned, this one stays on the Tools page and is not pinned. A hand-edited tool row is left as it is. The row is removed when that exe is gone.
[*] A Permafrost ModLoader DLL exports [font=Courier New]PermafrostModQuery[/font] and [font=Courier New]PermafrostModLoad[/font] and lands in the game folder's [font=Courier New]Mods[/font] directory. Installing one asks for the API only when the exe or [font=Courier New]PermafrostModHost.dll[/font] is missing. Cancel leaves the download. [font=Courier New]PermafrostModLoader.ini[/font] merges into [font=Courier New]Config\PermafrostModLoader.ini[/font]. The file is created when it is missing. New sections and new keys are added. An existing key with the same value stays. An existing key with a different value stays unless you choose Use the mod values. Keep existing is remembered for that mod, and the same stored value does not ask again while the live value stays. An already deployed mod whose stored ini is unchanged is not merged again. A mod new to this deployment, or one whose stored ini changed, is merged. Uninstall removes the DLL and does not delete ini keys.
[*] Copies [font=Courier New]Scripts\main.lua[/font] to [font=Courier New]Permafrost\Binaries\Win64\ue4ss\Mods\TestMod\Scripts\main.lua[/font]. Nested files keep their inner path, so [font=Courier New]Scripts\lib\util.lua[/font] becomes [font=Courier New]Permafrost\Binaries\Win64\ue4ss\Mods\TestMod\Scripts\lib\util.lua[/font]. UE4SS loads that [font=Courier New]Scripts\main.lua[/font]. A dll mod keeps [font=Courier New]dlls[/font], so [font=Courier New]dlls\main.dll[/font] becomes [font=Courier New]Permafrost\Binaries\Win64\ue4ss\Mods\TestMod\dlls\main.dll[/font]. A mod that ships both keeps both.
[*] Copies loose [font=Courier New].pak[/font], [font=Courier New].ucas[/font], and [font=Courier New].utoc[/font] files to [font=Courier New]Permafrost\Content\Paks\[/font]. Name them after the mod.
[*] Copies a [font=Courier New]LogicMods[/font] folder to [font=Courier New]Permafrost\Content\Paks\LogicMods\[/font]. Name those containers after the mod too.
[*] Parks a loose readme in [font=Courier New]Content\Paks[/font] with the paks. Name it after the mod, [font=Courier New]TestMod.txt[/font]. Mods share that folder, so [font=Courier New]readme.txt[/font] from one mod is replaced by the next mod that ships the same name. Text inside [font=Courier New]Scripts[/font] or [font=Courier New]dlls[/font] stays with the script mod, so [font=Courier New]Scripts\notes.txt[/font] becomes [font=Courier New]Binaries\Win64\ue4ss\Mods\TestMod\Scripts\notes.txt[/font].
[*] A mixed archive installs both sides. Uninstall removes the script folder, the pak files, the parked text file, and the [font=Courier New]mods.txt[/font] line.
[*] Before deploy, lists a pak, ucas, utoc, or loose text file already owned by an installed mod. The installed mod keeps its names. Cancel removes the new mod and its Vortex download from the mod list and installs nothing. A file or script folder that an installed mod still records is left in place. Auto-rename deploys only the new mod and renames every file it claims, including ones that did not collide. Pak, ucas, utoc, LogicMods, and loose text that share a base name take one suffix, [font=Courier New]_01[/font], then [font=Courier New]_02[/font]. [font=Courier New]TestMod.pak[/font] and [font=Courier New]TestMod.txt[/font] become [font=Courier New]TestMod_01.pak[/font] and [font=Courier New]TestMod_01.txt[/font]. The dialog shows the full renamed set. Uninstall removes those names.
[*] The UE4SS page writes [font=Courier New]ModName : 1[/font] or [font=Courier New]ModName : 0[/font]. The folder stays deployed either way. Each mod is its own bar. A checked mod has an up arrow, a down arrow, and a position menu from 1 through the number of checked mods. The arrows swap with the next checked row. The menu lifts that mod out and inserts it at the chosen number, including the script line of a mixed mod. Pak files are not reordered. An unchecked line stays where it is. Built-in lines stay put, and [font=Courier New]Keybinds[/font] stays last.
[*] Turning a mod off on the Mods page, uninstalling it, or purging removes the files and the line. [font=Courier New]config.lua[/font] and [font=Courier New]Scripts\config.lua[/font] are kept under [font=Courier New]ue4ss\VortexSettings\ModName[/font] and put back the next time that mod deploys.
[*] Refuses the game files [font=Courier New]Permafrost-Windows[/font] and [font=Courier New]global[/font].
[*] Leaves an experimental UE4SS install alone. A missing install, or stable 3.0.1, asks once. Yes downloads the pinned [font=Courier New]3.0.1-1208-g6f8dc3cc[/font] zip and checks its SHA-256 before writing. Built-in mod files are refreshed. [font=Courier New]UE4SS-settings.ini[/font], [font=Courier New]mods.txt[/font], [font=Courier New]mods.json[/font], and [font=Courier New]BPModLoaderMod\load_order.txt[/font] stay when they already exist. A player mod folder stays. No on a missing install stops setup. No on stable 3.0.1 keeps that release. [font=Courier New]Binaries\Win64\Mods[/font] stays. Quit the game first. After a flat 3.0.1 switch, reinstall script mods so they deploy under [font=Courier New]ue4ss\Mods[/font].
[/list]

Do not ship [font=Courier New]mods.txt[/font] or [font=Courier New]enabled.txt[/font]. Vortex writes the one [font=Courier New]mods.txt[/font] line. An [font=Courier New]enabled.txt[/font] file would start the mod while that line is [font=Courier New]: 0[/font].

[size=4][b]Requirements[/b][/size]
[list]
[*] [url=https://www.nexusmods.com/about/vortex/]Vortex[/url]
[*] Permafrost on Steam (app 2254990)
[*] [url=https://github.com/paulyusy/UE4SS_v3.0.1-1208-g6f8dc3cc-Experimental/releases/tag/UE4SS_v3.0.1-1208-g6f8dc3cc]Pinned UE4SS 3.0.1-1208[/url]. The extension downloads that zip only when UE4SS is missing or still on stable 3.0.1. An experimental install is left alone.
[/list]

[size=4][b]Shout outs[/b][/size]
[list]
[*] [b]SpaceRocket Games[/b] — Permafrost.
[*] [b]Toplitz Productions[/b] — publisher.
[*] [b]UE4SS-RE[/b] — UE4SS.
[*] [b]ChemBoy1[/b] — S.T.A.L.K.E.R. 2 Vortex extension.
[*] [b]Nexus Mods[/b] — Vortex.
[/list]

Released under the [url=https://opensource.org/license/mit]MIT License[/url]. Copyright 2026 Paulyus. See LICENSE.
