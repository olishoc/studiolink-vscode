# StudioLink VS Code Fork Bootstrap

This checkout is the StudioLink editor fork workspace.

Current fork wiring:

- `upstream`: `https://github.com/microsoft/vscode.git`
- `origin`: `https://github.com/olishoc/studiolink-vscode.git`
- local branch: `studiolink/bootstrap`

The remote `origin` is the real GitHub fork of `microsoft/vscode` under the `olishoc` account.

## Product Direction

StudioLink is a Roblox-specific Code fork with a terminal-red technical shell:

- small monospace interface
- high contrast dark panels
- terminal red accents
- Roblox project tree backed by the local StudioLink daemon
- AI suggestions backed by RoAgent
- script apply/deploy flow back into Roblox Studio
- debugger surface for future Roblox/Luau telemetry

## First Built-In Customization

This branch adds the `studiolink-terminal-red-theme` extension under `extensions/`.
It is intentionally inside the VS Code source tree so it can ship as a built-in extension once product metadata and build wiring are completed.

This branch also adds `extensions/studiolink-roblox`, the first daemon-backed Roblox extension. It registers the StudioLink activity-bar container, scans local StudioLink place caches, checks the localhost daemon, opens synced Roblox project workspaces, applies the active Lua/Luau script back to Studio through daemon RPC, and registers the first inline Luau suggestion provider.

The root `product.json` has started the Code - OSS to StudioLink product rename for application names, data folders, shell labels, URL protocol, and issue routing. IDs/icons/build signing still need a full pass before shipping an installer.

## Next Fork Steps

1. Commit and push the `studiolink-roblox` extension and product metadata rename.
2. Wire StudioLink icons/resources and Windows installer identity.
3. Add real daemon APIs for project-scoped script read/write so the extension can stop reading cache files directly.
4. Replace heuristic inline completions with daemon-backed AI suggestions.
5. Run the Windows Code - OSS build from this checkout.
