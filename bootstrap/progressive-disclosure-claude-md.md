# Progressive Disclosure CLAUDE.md System

A pattern for keeping Claude focused on only the domain-relevant context when working inside a large repo — plus an auto-updater that keeps the docs current after every session.

---

## What This Gives You

Claude loads `CLAUDE.md` from every directory it navigates into. By placing a `CLAUDE.md` in each package and top-level folder, you give Claude a targeted briefing on just the domain it's working in, rather than dumping the entire codebase guide into context every time.

The auto-updater hook then keeps those files accurate automatically: at the end of each session it diffs what changed, calls a cheap model (Haiku) via the Claude Code CLI, and rewrites only the affected `CLAUDE.md` files.

---

## Prerequisites

- Claude Code CLI installed and on your system PATH (see note below)
- Git repo with a `.claude/settings.json` hooks file
- Python 3.11+ (`uv` or standard venv)

> **No API key required.** The hook script calls Claude via the `claude -p` CLI, which uses your existing Claude Code account auth (Pro/Max/Teams). You do **not** need a separate Anthropic API key.
>
> **PATH note:** If you use Claude Code via the VS Code extension or desktop app, you must also install the CLI globally so hooks can find it. In VS Code, run the command palette command **Claude Code: Install CLI** (or type `/install-cli` in a Claude Code session). Verify with `claude --version` in a fresh terminal. PATH changes require a new process — restart VS Code after installing.

---

## Step 1 — Write Failing Tests (TDD)

Create `tests/unit/test_claude_md_coverage.py` before creating any files. Run it — it should fail red.

```python
"""Verify CLAUDE.md progressive-disclosure coverage."""
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent  # adjust depth to your repo root

# List every top-level folder that should have a CLAUDE.md
TOP_LEVEL_FOLDERS = [
    "agents", "config", "contracts", "docs",
    "extensions", "scripts", "templates", "tests", "zfa",
    # add/remove to match your repo
]

# List every package folder (if you have a packages/ monorepo)
PACKAGES = [
    "my-core", "my-cli", "other-package",
    # add your packages
]


def _all_paths():
    paths = [ROOT / f / "CLAUDE.md" for f in TOP_LEVEL_FOLDERS]
    paths += [ROOT / "packages" / p / "CLAUDE.md" for p in PACKAGES]
    return paths


def test_all_have_claude_md():
    missing = [p for p in _all_paths() if not p.exists()]
    assert not missing, f"Missing CLAUDE.md: {[str(p) for p in missing]}"


def test_all_have_purpose_section():
    bad = [str(p) for p in _all_paths() if p.exists() and "## Purpose" not in p.read_text()]
    assert not bad, f"Missing '## Purpose': {bad}"
```

Create `tests/unit/test_stop_hook.py`:

```python
"""Verify the Stop hook is wired in .claude/settings.json."""
import json
from pathlib import Path

SETTINGS = Path(__file__).parent.parent.parent / ".claude" / "settings.json"


def test_settings_has_stop_hook():
    data = json.loads(SETTINGS.read_text())
    assert "Stop" in data.get("hooks", {}), "No 'Stop' key in hooks"


def test_stop_hook_calls_update_script():
    data = json.loads(SETTINGS.read_text())
    stop_hooks = data.get("hooks", {}).get("Stop", [])
    commands = [
        h.get("command", "")
        for entry in stop_hooks
        for h in entry.get("hooks", [])
    ]
    assert any("update_claude_md" in cmd for cmd in commands), (
        f"No Stop hook references 'update_claude_md'. Found: {commands}"
    )
```

Run: all tests fail (red). ✓

---

## Step 2 — Create the CLAUDE.md Files

### Root CLAUDE.md

The root `CLAUDE.md` is the entry point. It should cover:

- Monorepo overview (language, build tool, package count)
- Tech stack (key frameworks and libraries)
- How to run, test, build
- Conventions (TDD, Pydantic, CLI structure, etc.)
- Subagent routing (which model for which work)
- Any mandatory tool usage (e.g. knowledge graph MCP tools)

Keep it under ~150 lines. Domain detail belongs in the package/folder CLAUDE.md, not here.

### Package CLAUDE.md Template

Place at `packages/{name}/CLAUDE.md` (or wherever your packages live):

```markdown
# {package-name}

## Purpose
One sentence: what this package does and who calls it.

## Key Modules
- `{src}/{module}.py` — what it does

## Public API
Key imports callers use.
\```python
from {pkg} import SomeClass, some_function
\```

## Tests
\```bash
uv run pytest tests/unit/{name}/
\```

## Patterns
Conventions specific to this package (frozen models, async patterns, etc.).

## Gotchas
Non-obvious constraints that cause bugs.
```

Rules:
- Under 80 lines per file
- Only document what is *different* from the root conventions
- No duplication of root CLAUDE.md content

### Top-Level Folder CLAUDE.md Template

Place at `{folder}/CLAUDE.md`:

```markdown
# {folder}/

## Purpose
What lives here and when to use this folder.

## Key Files
- `filename` — description

## Conventions
Naming, organization, and format rules specific to this folder.

## Gotchas
Non-obvious things (optional — omit if none).
```

### How to Generate Initial Files

For a large repo, generating these by hand is tedious. Spawn one Claude agent per package/folder and have it read the directory + key source files, then write the CLAUDE.md. A Workflow (multi-agent) is efficient for this:

```
For each package:
  - Read: directory listing, pyproject.toml, key module names
  - Write: packages/{name}/CLAUDE.md using the template above
```

---

## Step 3 — Create the Agent Spec

Create `agents/claude-md-updater.md`. This is the spec passed to Claude Haiku when updating a domain's CLAUDE.md:

```markdown
# CLAUDE.md Updater Agent

## Role
You are a concise technical writer. Given the current CLAUDE.md for a domain
and the git diff of recent changes, update the CLAUDE.md so it accurately
reflects the current state of the code.

## Rules
- Preserve existing structure and section headings
- Update only sections that are stale based on the diff
- Keep the file under 80 lines
- Return ONLY the updated markdown — no preamble, no commentary
- Never modify the root CLAUDE.md — it is maintained separately
- If nothing in the diff affects the CLAUDE.md, return it unchanged

## What to Update
- New modules/files added → add to Key Modules or Key Files
- Renamed/removed files → remove stale entries
- New patterns established → update Patterns section
- New gotchas discovered → add to Gotchas
- Public API changes → update Public API section

## What NOT to Update
- Purpose section (only changes on fundamental redesign)
- Test commands (only changes on test infrastructure changes)
- Information not visible in the diff
```

---

## Step 4 — Create the Hook Script

Create `scripts/update_claude_md.py`. This is the script that runs at session end:

```python
"""Stop hook: update CLAUDE.md files for domains modified this session.

Uses a sentinel file to track the last HEAD commit that was processed,
so the API is only called when real code changed — not on every turn
or after CLAUDE.md-only writes.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent.parent  # adjust if scripts/ is nested differently
UPDATER_SPEC = ROOT / "agents" / "claude-md-updater.md"
SENTINEL = ROOT / ".claude" / "last_claude_md_update.txt"

# Edit these to match your repo structure
PACKAGES_DIR = ROOT / "packages"   # or None if no packages/ layout
TOP_LEVEL_FOLDERS = {
    "agents", "config", "docs", "scripts", "tests",
    # add/remove to match your repo
}


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def _git_lines(*args):
    r = subprocess.run(
        ["git", *args],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    return set(r.stdout.strip().splitlines()) if r.returncode == 0 else set()


def _current_head():
    r = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    return r.stdout.strip() if r.returncode == 0 else None


def _code_files(files):
    """Strip CLAUDE.md files — they must never trigger their own re-update."""
    return {f for f in files if Path(f).name != "CLAUDE.md"}


# ---------------------------------------------------------------------------
# Domain detection
# ---------------------------------------------------------------------------

def _files_to_domains(files):
    domains = set()
    for f in files:
        parts = Path(f).parts
        if not parts:
            continue
        if PACKAGES_DIR and parts[0] == "packages" and len(parts) >= 2:
            domains.add(("package", parts[1]))
        elif parts[0] in TOP_LEVEL_FOLDERS:
            domains.add(("folder", parts[0]))
    return domains


def get_modified_domains(last_commit):
    files = (
        _git_lines("diff", "--name-only", "HEAD")   # unstaged
        | _git_lines("diff", "--cached", "--name-only")  # staged
    )
    if last_commit:
        files |= _git_lines("diff", "--name-only", last_commit, "HEAD")
    return _files_to_domains(_code_files(files))


# ---------------------------------------------------------------------------
# CLAUDE.md update
# ---------------------------------------------------------------------------

def _diff_for_domain(diff_filter, last_commit):
    parts = []
    r = subprocess.run(
        ["git", "diff", "HEAD", "--", diff_filter],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    if r.stdout.strip():
        parts.append(r.stdout.strip())
    if last_commit:
        r2 = subprocess.run(
            ["git", "diff", last_commit, "HEAD", "--", diff_filter],
            capture_output=True, text=True, cwd=ROOT, check=False,
        )
        if r2.stdout.strip():
            parts.append(r2.stdout.strip())
    return "\n".join(parts)[:4000] or "(no diff available)"


def update_domain(kind, name, spec_text, last_commit):
    if kind == "package":
        claude_md_path = PACKAGES_DIR / name / "CLAUDE.md"
        diff_filter = f"packages/{name}/"
    else:
        claude_md_path = ROOT / name / "CLAUDE.md"
        diff_filter = f"{name}/"

    if not claude_md_path.exists():
        return

    current = claude_md_path.read_text(encoding="utf-8")
    diff_text = _diff_for_domain(diff_filter, last_commit)

    prompt = (
        f"{spec_text}\n\n---\n\n"
        f"Domain: {kind} `{name}`\n\n"
        f"Current CLAUDE.md:\n```markdown\n{current}\n```\n\n"
        f"Git diff for this domain:\n```diff\n{diff_text}\n```\n\n"
        "Rewrite the CLAUDE.md to reflect any changes. "
        "Return ONLY the updated markdown content, no preamble."
    )

    r = subprocess.run(
        ["claude", "-p", prompt, "--model", "claude-haiku-4-5-20251001"],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"claude exited {r.returncode}")
    updated = r.stdout.strip()
    claude_md_path.write_text(updated + "\n", encoding="utf-8")
    print(f"  updated {claude_md_path.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    head = _current_head()
    last_commit = SENTINEL.read_text().strip() if SENTINEL.exists() else None

    uncommitted = _code_files(
        _git_lines("diff", "--name-only", "HEAD")
        | _git_lines("diff", "--cached", "--name-only")
    )
    if head and head == last_commit and not uncommitted:
        return  # nothing changed since last run — fast exit, no API call

    domains = get_modified_domains(last_commit)
    if not domains:
        if head:
            SENTINEL.write_text(head)
        return

    spec_text = UPDATER_SPEC.read_text(encoding="utf-8")

    print(f"update_claude_md: refreshing {len(domains)} domain(s)…")
    for kind, name in sorted(domains):
        try:
            update_domain(kind, name, spec_text, last_commit)
        except Exception as exc:
            print(f"  WARN: {kind}/{name}: {exc}")

    if head:
        SENTINEL.write_text(head)


if __name__ == "__main__":
    main()
```

**Three things to customize:**
1. `ROOT` — set to your repo root
2. `PACKAGES_DIR` — path to your packages folder, or `None` if you don't have one
3. `TOP_LEVEL_FOLDERS` — the set of top-level folders in your repo

**Why `claude -p` instead of the Anthropic SDK:**
The `claude -p "<prompt>"` flag runs a one-shot prompt using your Claude Code account auth (Claude Pro/Max/Teams). This means no separate API key is needed — the same credentials that power your interactive sessions are used here. The `--model` flag pins the call to Haiku to keep costs low. If `claude` is not on PATH, hooks will fail with `[WinError 2]` on Windows or `No such file or directory` on Mac/Linux — see the Prerequisites section.

---

## Step 5 — Wire the Stop Hook

Add the Stop hook to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "uv run python scripts/update_claude_md.py",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

If you already have a Stop hook (e.g., a session logger), add the new command to the existing `hooks` array rather than creating a second entry:

```json
"hooks": [
  { "type": "command", "command": "python scripts/log_session.py", "timeout": 5 },
  { "type": "command", "command": "uv run python scripts/update_claude_md.py", "timeout": 60 }
]
```

---

## Step 6 — Run Tests (Green)

```bash
uv run pytest tests/unit/test_claude_md_coverage.py tests/unit/test_stop_hook.py -v
```

All 4 tests should pass.

---

## How the Sentinel Mechanism Works

The script stores the current `HEAD` commit hash in `.claude/last_claude_md_update.txt` after each run. On the next run:

```
HEAD == sentinel AND no uncommitted changes?
  → exit immediately (no API call, ~50ms total)

HEAD changed OR uncommitted code files exist?
  → diff from last sentinel to HEAD (excluding CLAUDE.md files)
  → call Haiku once per affected domain
  → write updated CLAUDE.md files
  → update sentinel to current HEAD
```

This means:
- **Every quick Q&A turn**: exits in ~50ms with no API cost
- **After real code edits**: updates only the affected domains
- **After commit**: picks up the committed diff on the next Stop

---

## Gotchas to Avoid

**The Stop hook fires after every turn, not once at session close.**
Without the sentinel guard, the script would call the API after every response — even "what does this function do?" turns that changed nothing. The sentinel makes the common case a no-op.

**CLAUDE.md writes feed back into the diff.**
If you include `CLAUDE.md` files in the git diff used to detect *which* domains changed, the updater will re-process every domain it just wrote on the following turn. Always strip `CLAUDE.md` from the file list before mapping to domains (see `_code_files()`).

**Progressive disclosure only loads for directories Claude visits.**
Claude loads a `CLAUDE.md` when it opens a file inside that directory — not at session start. The value is for working sessions, not informational questions. If you ask "what does the config folder do?" from the project root without Claude opening a file there, `config/CLAUDE.md` may not be loaded.

**Keep each CLAUDE.md under 80 lines.**
The point is focused, minimal context. If a CLAUDE.md grows past ~80 lines it's probably duplicating the root or trying to replace the source code as documentation.

**Add `.claude/last_claude_md_update.txt` to `.gitignore`.**
This is a local sentinel; it shouldn't be committed or conflict across branches.

```
# .gitignore
.claude/last_claude_md_update.txt
```

---

## File Checklist

| File | What it does |
|------|-------------|
| `tests/unit/test_claude_md_coverage.py` | Verifies every folder/package has a `CLAUDE.md` with `## Purpose` |
| `tests/unit/test_stop_hook.py` | Verifies the Stop hook is wired in `settings.json` |
| `{folder}/CLAUDE.md` (×N) | Progressive disclosure for top-level folders |
| `packages/{name}/CLAUDE.md` (×N) | Progressive disclosure for packages |
| `agents/claude-md-updater.md` | Agent spec passed to Haiku for each update |
| `scripts/update_claude_md.py` | Hook script: sentinel check → diff → API call → write |
| `.claude/settings.json` | Stop hook that calls `update_claude_md.py` |
| `.gitignore` | Exclude `.claude/last_claude_md_update.txt` |
