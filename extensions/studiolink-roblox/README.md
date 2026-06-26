# StudioLink Roblox Extension

This built-in fork extension is the first real StudioLink coding surface inside the VS Code codebase.

It currently owns:

- local StudioLink daemon health checks;
- Roblox project discovery through daemon `project:*` RPC, with local cache fallback;
- a StudioLink activity-bar project tree;
- opening synced project repositories as VS Code workspaces;
- applying the active Lua/Luau document back to Roblox Studio through daemon `project:write` RPC;
- first-pass Roblox-aware inline suggestions.

The extension is intentionally local-first. It talks to `http://127.0.0.1:45678` and reads the StudioLink data directory instead of depending on a cloud service.
