[size=5][b]Permafrost Vortex Extension[/b][/size]
[size=3]v1.0.5[/size]

[size=4][b]Description[/b][/size]
Adds Permafrost to Vortex and installs its UE4SS mods, pak mods, and Permafrost ModLoader DLLs.

Vortex reads the archive layout. There is no manifest, and the readme is not parsed. One download can contain a script mod and pak files together. Enable and disable write the game's [font=Courier New]mods.txt[/font] in place. Uninstall and purge remove the deployed files and that line.

The extension launches [font=Courier New]Permafrost-Win64-Shipping.exe[/font]. It does not start the root [font=Courier New]Permafrost.exe[/font] launcher. When [font=Courier New]PermafrostModLoader.exe[/font] is in the game folder, the Tools page lists it as Permafrost ModLoader API and pins it above Play. Play still launches the shipping exe, or a launcher you already chose.

[size=4][b]Installation instructions[/b][/size]
[b]Vortex[/b]
[list=1]
[*] Install Permafrost on Steam.
[*] Close Vortex if it is open.
[*] Drop [font=Courier New]Permafrost Vortex Extension-1.0.5.zip[/font] on Vortex's Extensions page.
[*] Start Vortex again.
[*] Manage Permafrost. This zip is not installed from the Mods page.
[/list]

Each time the game is managed, Vortex reads the UE4SS experimental-latest release and downloads the one zip whose name starts with [font=Courier New]UE4SS_v3.0.1-[/font]. The zip name is the build name. Vortex compares [font=Courier New]dwmapi.dll[/font] and [font=Courier New]ue4ss\UE4SS.dll[/font] in that zip with the files beside [font=Courier New]Permafrost-Win64-Shipping.exe[/font] and inside [font=Courier New]Binaries\Win64\ue4ss[/font]. A match is left alone. Anything else gets one question that names that build. Yes confirms [font=Courier New]Binaries\Win64[/font] is writable first. A failed lookup, or a release that does not list exactly one of those zips, stops before the download and names the status or the files it found.

[list]
[*] Nothing installed: Yes downloads the experimental archive into [font=Courier New]Binaries\Win64\ue4ss[/font].
[*] UE4SS 3.0.1 beside the exe: Yes removes that [font=Courier New]UE4SS.dll[/font], replaces the proxy, and installs the experimental build into [font=Courier New]ue4ss[/font]. [font=Courier New]Binaries\Win64\Mods[/font] stays. Reinstall script mods so they deploy under [font=Courier New]ue4ss\Mods[/font].
[*] UE4SS 3.0.1, or any other build, already inside [font=Courier New]ue4ss[/font]: Yes replaces that loader. [font=Courier New]mods.txt[/font], the settings ini, and installed mod folders stay.
[*] The experimental build is in place and a second [font=Courier New]UE4SS.dll[/font] is still beside the exe: Yes removes that extra loader and does not download.
[*] Some required file is missing, or the proxy is a different file: Yes fills the gaps and replaces a proxy that is not this build.
[/list]

The experimental proxy loads [font=Courier New]ue4ss\UE4SS.dll[/font]. UE4SS reads [font=Courier New]Mods[/font] and the ini from that same [font=Courier New]ue4ss[/font] folder. Quit Permafrost before choosing Yes. Choose No and the game stays unmoddable until that case is fixed. Reinstall a script mod after updating this extension. Deploy alone keeps the file list from the earlier install. When Vortex asks for a deploy path, and again during setup, the extension creates empty [font=Courier New]Binaries\Win64\ue4ss\Mods[/font], [font=Courier New]Content\Paks\LogicMods[/font], and game-folder [font=Courier New]Mods[/font] directories. Vortex treats a missing directory as not writable and then refuses Hardlink Deployment. [font=Courier New]Binaries\Win64\Mods[/font] stays where it is.

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
[*] Turning a mod off on the Mods page, uninstalling it, or purging removes the files and the line.
[*] Refuses the game files [font=Courier New]Permafrost-Windows[/font] and [font=Courier New]global[/font].
[*] Checks UE4SS by hash and offers one fix. A missing install is downloaded. Flat UE4SS 3.0.1 is switched into [font=Courier New]Binaries\Win64\ue4ss[/font]. A 3.0.1 or other loader already inside [font=Courier New]ue4ss[/font] is replaced. An extra [font=Courier New]UE4SS.dll[/font] beside a current install is removed on its own. [font=Courier New]mods.txt[/font], the settings ini, and installed mod folders stay. [font=Courier New]Binaries\Win64\Mods[/font] stays. Quit the game first. After a flat 3.0.1 switch, reinstall script mods so they deploy under [font=Courier New]ue4ss\Mods[/font].
[/list]

Do not ship [font=Courier New]mods.txt[/font] or [font=Courier New]enabled.txt[/font]. Vortex writes the one [font=Courier New]mods.txt[/font] line. An [font=Courier New]enabled.txt[/font] file would start the mod while that line is [font=Courier New]: 0[/font].

[size=4][b]Requirements[/b][/size]
[list]
[*] [url=https://www.nexusmods.com/about/vortex/]Vortex[/url]
[*] Permafrost on Steam (app 2254990)
[*] [url=https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/experimental-latest]UE4SS experimental-latest[/url]. The extension downloads the [font=Courier New]UE4SS_v3.0.1[/font] zip on that release when the files on disk differ. A matching install is left alone.
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
