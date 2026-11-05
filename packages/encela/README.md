# encela

Encela for Claude Code, without the desktop app. Write your request as usual: Encela finds the
modules (MCP servers, command line tools), skills, rules and subagents that fit it, Claude asks
you which to apply (all, some or none), opens what you chose and does the work.

```bash
npm install --global encela
encela setup
encela --version
```

Or without installing: `npx encela setup`.

`encela setup` installs a Claude Code plugin with your own `claude` command and prepares your
modules. Start a new Claude Code session (or run `/reload-plugins`) afterwards.

## Using it

- **Just write your request.** With each prompt the plugin's hook looks for matching modules,
  combinations and catalog blocks. When something fits well, Claude gets a short list and asks
  you before applying anything. Nothing matches: nothing is added.
- **`/encela:go <request>`** runs the whole flow on purpose: find, ask, apply, do.
- Example: `/encela:go make an app just like Paint` — Claude checks the modules (e.g. a reverse
  engineering module you added), looks up frontend design skills, asks which to apply, opens
  them and builds the app.

Modules don't run until Claude opens one. An MCP module's tools then appear in Claude Code; a CLI
or library module hands Claude its usage guide. A combination opens all its modules, each with a
role, so Claude can work on the roles in parallel.

## Commands

| Command | What it does |
|---|---|
| `encela setup` | Install the plugin and prepare your modules. `--no-auto`: no hook, use `/encela:go` only. `--no-claude`: only write the files. |
| `encela status` | Where your modules are and what they hold |
| `encela uninstall` | Remove the plugin (your modules stay) |
| `encela mcp` / `encela hook` | Run by the plugin |

## Your modules

Modules and combinations live in one file, `mcp-hub.json`:

- in the Encela desktop app's data folder when the app is installed (the app and this package
  then share it; add modules from GitHub, the catalog or by hand in the app);
- otherwise in `~/.encela/` (or `ENCELA_HOME`).

A new file starts with three modules that feed each other (repomix, ast-grep, mcp-mermaid) and
two combinations of them. Secrets are written as `${VAR}` and read from your environment.

## What the plugin adds to Claude Code

- MCP server `encela`: `suggest`, `search_blocks`, `get_block`, and the module hub
  (`hub_list_servers`, `hub_open_server`, `hub_list_tools`, `hub_call`, `hub_close_server`,
  `hub_list_combos`, `hub_open_combo`)
- a `UserPromptSubmit` hook (not with `--no-auto`)
- the `/encela:go` command

The plugin is written to `~/.encela/claude-plugin` and added as a local marketplace named
`encela`. Matching runs on your machine; Encela calls no model of its own.

## Licenses

Apache-2.0. The catalog's skills, rules and subagents come from other projects under their own
licenses (MIT, Apache-2.0, BSD); each keeps its source in `get_block`, the license texts are in
`dist/licenses/`, and `THIRD_PARTY_NOTICES.md` lists them. Modules are run from their own
sources by your tools (npx, uvx, ...); this package doesn't include their code.
