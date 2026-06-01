"""Multi-day improvement loop: reads current strategy code + optional stats dump,
calls `claude -p` with the AGENTS.md spec, and prints a prioritized improvement report.

Usage:
  # Quick review (code only):
  python screeps/scripts/review_strategy.py

  # With stats history (paste from Screeps console: JSON.stringify(Memory.statsLog)):
  python screeps/scripts/review_strategy.py --stats path/to/statslog.json

  # Save report to file:
  python screeps/scripts/review_strategy.py --out screeps/experiments/2026-06-01-review.md

Requires: Python 3.11+, `claude` CLI on PATH.
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT    = Path(__file__).parent.parent.parent
SCREEPS = ROOT / "screeps"
AGENTS  = SCREEPS / "AGENTS.md"

# Source files to include in the review context
SOURCE_FILES = [
    "strategies/adaptive/src/types.d.ts",
    "strategies/adaptive/src/main.ts",
    "strategies/adaptive/src/utils/bodyBuilder.ts",
    "strategies/adaptive/src/managers/strategyManager.ts",
    "strategies/adaptive/src/managers/spawnManager.ts",
    "strategies/adaptive/src/managers/constructionManager.ts",
    "strategies/adaptive/src/managers/combatManager.ts",
    "strategies/adaptive/src/managers/expansionManager.ts",
    "strategies/adaptive/src/roles/harvester.ts",
    "strategies/adaptive/src/roles/hauler.ts",
    "strategies/adaptive/src/roles/upgrader.ts",
    "strategies/adaptive/src/roles/builder.ts",
    "strategies/adaptive/src/roles/warrior.ts",
    "strategies/adaptive/src/roles/ranger.ts",
    "strategies/adaptive/src/roles/scout.ts",
]


def load_sources():
    parts = []
    for rel in SOURCE_FILES:
        path = SCREEPS / rel
        if path.exists():
            parts.append(f"### {rel}\n```typescript\n{path.read_text(encoding='utf-8')}\n```")
    return "\n\n".join(parts)


def load_stats(stats_path):
    if not stats_path:
        return None
    p = Path(stats_path)
    if not p.exists():
        print(f"Stats file not found: {p}")
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    # Compact summary: show every 10th entry + first + last
    if isinstance(data, list) and len(data) > 20:
        sample = [data[0]] + data[1::10] + [data[-1]]
    else:
        sample = data
    return json.dumps(sample, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description="Review Screeps adaptive strategy")
    parser.add_argument("--stats", help="Path to JSON stats log file (from Memory.statsLog dump)")
    parser.add_argument("--out",   help="Output file path for the report")
    parser.add_argument("--model", default="claude-sonnet-4-6", help="Claude model to use")
    args = parser.parse_args()

    if not AGENTS.exists():
        print(f"AGENTS.md not found at {AGENTS}")
        return

    spec       = AGENTS.read_text(encoding="utf-8")
    sources    = load_sources()
    stats_json = load_stats(args.stats)

    prompt = f"{spec}\n\n---\n\n## Code to Review\n\n{sources}"

    if stats_json:
        prompt += f"\n\n## Stats History (sampled)\n```json\n{stats_json}\n```"

    prompt += (
        "\n\n---\n\n"
        "Produce a prioritized improvement report following the output format in the spec above. "
        "Focus on the top 5-8 highest-ROI changes. Be specific: name the file, function, and "
        "the exact change to make."
    )

    print(f"Running strategy review with {args.model}…")
    r = subprocess.run(
        ["claude", "-p", prompt, "--model", args.model],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )

    if r.returncode != 0:
        print(f"Error: {r.stderr.strip() or f'claude exited {r.returncode}'}")
        return

    report = r.stdout.strip()

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report + "\n", encoding="utf-8")
        print(f"Report saved to {out_path}")
    else:
        print("\n" + "=" * 60)
        print(report)


if __name__ == "__main__":
    main()
