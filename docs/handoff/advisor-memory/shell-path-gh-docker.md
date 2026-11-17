---
name: shell-path-gh-docker
description: "In Claude's Git Bash sessions on this machine, gh and docker are not on PATH; prefix commands with their install dirs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1f13ea21-32a5-446b-8008-2171830de2d4
  modified: 2026-09-22T08:50:45.959Z
---

`gh` and `docker` are installed but missing from PATH in the Bash tool on this Windows machine.

**Why:** the shell profile Claude's Bash inherits predates both installs. Commands fail with "command not found" even though `gh auth status` is fine from a fresh terminal.

**How to apply:** start commands with
`export PATH="/c/Program Files/GitHub CLI:$LOCALAPPDATA/Programs/DockerDesktop/resources/bin:$PATH"`.
Related: [[maxoff-project]].
