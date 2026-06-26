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

## Next Fork Steps

1. Push `studiolink/bootstrap` to `olishoc/studiolink-vscode`.
2. Add product metadata for StudioLink naming/icons where license-compatible.
3. Add the daemon-backed Roblox workspace extension.
4. Run the Windows Code - OSS build from this checkout.
