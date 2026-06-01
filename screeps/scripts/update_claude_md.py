"""Stop hook: refresh CLAUDE.md files for any screeps/adaptive src directory
that changed this session.

Uses a sentinel to skip turns where nothing changed (fast exit, no CLI call).
Calls `claude -p` with the updater spec (Claude Code account auth, no API key needed).

Setup:
  Add to .claude/settings.json hooks → Stop:
    uv run python screeps/scripts/update_claude_md.py
  Or without uv:
    python screeps/scripts/update_claude_md.py

Requires: Python 3.11+, `claude` CLI on PATH (run `claude --version` to verify).
"""
import subprocess
from pathlib import Path

ROOT      = Path(__file__).parent.parent.parent   # z:/repos/game-bots
SCREEPS   = ROOT / "screeps"
SPEC_FILE = SCREEPS / "agents" / "claude-md-updater.md"
SENTINEL  = ROOT / ".claude" / "last_screeps_claude_md_update.txt"

# Map of directory path (relative to ROOT) → CLAUDE.md to update
DOMAINS = {
    "screeps/strategies/adaptive/src/roles":    SCREEPS / "strategies/adaptive/src/roles/CLAUDE.md",
    "screeps/strategies/adaptive/src/managers": SCREEPS / "strategies/adaptive/src/managers/CLAUDE.md",
    "screeps/strategies/adaptive/src/utils":    SCREEPS / "strategies/adaptive/src/utils/CLAUDE.md",
    "screeps/strategies/adaptive/src":          SCREEPS / "strategies/adaptive/src/CLAUDE.md",
    "screeps/strategies/adaptive":              SCREEPS / "strategies/adaptive/CLAUDE.md",
    "screeps":                                  SCREEPS / "CLAUDE.md",
}


def _git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT, check=False)
    return set(r.stdout.strip().splitlines()) if r.returncode == 0 else set()


def _head():
    r = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT, check=False)
    return r.stdout.strip() if r.returncode == 0 else None


def changed_files(last_commit):
    files = _git("diff", "--name-only", "HEAD") | _git("diff", "--cached", "--name-only")
    if last_commit:
        files |= _git("diff", "--name-only", last_commit, "HEAD")
    return {f for f in files if Path(f).name != "CLAUDE.md"}


def affected_domains(files):
    hit = set()
    for f in files:
        for domain in DOMAINS:
            if f.startswith(domain):
                hit.add(domain)
    return hit


def get_diff(domain, last_commit):
    parts = []
    for cmd in [
        ["git", "diff", "HEAD", "--", f"{domain}/"],
        *([ ["git", "diff", last_commit, "HEAD", "--", f"{domain}/"] ] if last_commit else []),
    ]:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, check=False)
        if r.stdout.strip():
            parts.append(r.stdout.strip())
    return "\n".join(parts)[:4000] or "(no diff available)"


def update_domain(domain, spec_text, last_commit):
    claude_md = DOMAINS[domain]
    if not claude_md.exists():
        return

    current   = claude_md.read_text(encoding="utf-8")
    diff_text = get_diff(domain, last_commit)

    prompt = (
        f"{spec_text}\n\n---\n\n"
        f"Directory: `{domain}`\n\n"
        f"Current CLAUDE.md:\n```markdown\n{current}\n```\n\n"
        f"Git diff:\n```diff\n{diff_text}\n```\n\n"
        "Rewrite the CLAUDE.md to reflect any changes. Return ONLY the updated markdown."
    )

    r = subprocess.run(
        ["claude", "-p", prompt, "--model", "claude-haiku-4-5-20251001"],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"claude exited {r.returncode}")

    claude_md.write_text(r.stdout.strip() + "\n", encoding="utf-8")
    print(f"  updated {claude_md.relative_to(ROOT)}")


def main():
    head        = _head()
    last_commit = SENTINEL.read_text().strip() if SENTINEL.exists() else None

    uncommitted = changed_files(None)
    if head and head == last_commit and not uncommitted:
        return  # nothing changed — fast exit

    files = changed_files(last_commit)
    domains = affected_domains(files)
    if not domains:
        if head:
            SENTINEL.write_text(head)
        return

    if not SPEC_FILE.exists():
        print(f"update_claude_md: spec not found at {SPEC_FILE}")
        return

    spec_text = SPEC_FILE.read_text(encoding="utf-8")
    print(f"update_claude_md: refreshing {len(domains)} CLAUDE.md file(s)…")

    for domain in sorted(domains, key=len, reverse=True):  # deepest first
        try:
            update_domain(domain, spec_text, last_commit)
        except Exception as exc:
            print(f"  WARN {domain}: {exc}")

    if head:
        SENTINEL.write_text(head)


if __name__ == "__main__":
    main()
