# claude-mods

Claude Code mods (function-hook plugins). This repository is a plugin marketplace.

| Mod | What it does |
|---|---|
| [usage-meter](usage-meter/) | 5h and weekly rate-limit usage with reset countdown and pace projection, context-window fill and breakdown, cost and burn rate, token/cache stats, tool-call counts. Status line in the CLI, a pane in the app. |

## Install

At the prompt of a terminal session:

```
/plugin install usage-meter --marketplace inv1sible/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope = every session).

From a shell:

```
claude plugin install usage-meter --marketplace inv1sible/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `inv1sible/claude-mods`, then Add plugin.

If the repository is private, the install works only for people who can read it on GitHub and whose machine already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Develop

```
claude --plugin-dir ./usage-meter     # run from the folder, hot-reloads
claude plugin validate ./usage-meter
claude plugin test ./usage-meter
```
