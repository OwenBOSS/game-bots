"""Baseline strategy: economy-first, weapons research, cautious expansion.

All functions are pure — they return recommendations but have no side effects.
"""
from __future__ import annotations
import math
from rich.console import Console
from rich.table import Table
from rich import box

from np_lib.models import GameState, Star, Fleet
from np_lib.combat import ships_needed_to_capture, capture_score
from np_lib.economy import should_buy_economy, best_research_target, economy_roi_cycles

console = Console()


def _dist(a: Star, b: Star) -> float:
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


# ------------------------------------------------------------------
# Attack targets
# ------------------------------------------------------------------

def rank_attack_targets(state: GameState, top_n: int = 5) -> list[dict]:
    """Return top targets sorted by capture_score descending."""
    me = state.me()
    if not me:
        return []

    my_weapons = me.weapons_level
    my_star_set = {s.uid for s in state.my_stars()}
    results = []

    candidates = state.enemy_stars() + state.unowned_visible_stars()
    for target in candidates:
        owner = state.player(target.puid) if target.puid != -1 else None
        def_weapons = owner.weapons_level if owner else 1
        garrison = target.st

        # Only include if we have a frontier star within scanning range
        nearest_own = min(
            state.my_stars(),
            key=lambda s: _dist(s, target),
            default=None,
        )
        if nearest_own is None:
            continue

        needed = ships_needed_to_capture(garrison, def_weapons, my_weapons)
        score = capture_score(garrison, int(target.nr), my_weapons, def_weapons)
        dist = _dist(nearest_own, target)

        results.append({
            "star": target,
            "owner_alias": owner.alias if owner else "(unowned)",
            "garrison": garrison,
            "ships_needed": needed,
            "score": score,
            "nearest_own": nearest_own.n,
            "distance": dist,
        })

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_n]


# ------------------------------------------------------------------
# Defense
# ------------------------------------------------------------------

def find_exposed_stars(state: GameState, min_garrison: int = 10) -> list[Star]:
    """Own stars with garrison below min_garrison that neighbour an enemy star."""
    enemy_positions = [(s.x, s.y) for s in state.enemy_stars()]
    exposed = []
    for star in state.my_stars():
        if star.st >= min_garrison:
            continue
        # Consider exposed if any enemy star is within 2× average jump range
        scan_range = 2.0
        if any(math.sqrt((star.x - ex) ** 2 + (star.y - ey) ** 2) < scan_range
               for ex, ey in enemy_positions):
            exposed.append(star)
    return exposed


# ------------------------------------------------------------------
# Rich status report
# ------------------------------------------------------------------

def print_status(state: GameState) -> None:
    me = state.me()
    if not me:
        console.print("[red]Could not identify own player (player_uid not set)[/red]")
        return

    # Header
    console.rule(f"[bold cyan]Tick {state.tick}[/bold cyan]  —  [bold]{me.alias}[/bold]")

    # Player summary
    w = me.tech.get("weapons")
    weapons_str = f"L{w.level}" if w else "?"
    console.print(
        f"  Cash [green]${me.cash:.0f}[/green]   "
        f"Stars {me.total_stars}/{state.stars_for_victory}   "
        f"Ships {me.total_strength}   "
        f"Fleets {me.total_fleets}   "
        f"Weapons {weapons_str}   "
        f"Production in [yellow]{state.ticks_to_production}[/yellow] ticks"
    )

    # Research
    research_target = best_research_target(state)
    current = me.researching or "(none)"
    if research_target and research_target != me.researching:
        console.print(f"  Research: [dim]{current}[/dim] → switch to [yellow]{research_target}[/yellow]")
    else:
        tech = me.tech.get(current)
        if tech and tech.brr:
            pct = int(100 * tech.research / max(1, tech.research_needed))
            console.print(f"  Research: [yellow]{current}[/yellow] ({pct}% to L{tech.level + 1})")

    # Economy upgrade
    buy, star = should_buy_economy(state)
    if star:
        roi = economy_roi_cycles(star)
        flag = "[green]BUY[/green]" if buy else "[dim]hold[/dim]"
        console.print(
            f"  Economy upgrade: [cyan]{star.n}[/cyan] costs [green]${star.c:.0f}[/green]"
            f"  ROI {roi:.1f} cycles  →  {flag}"
        )

    # Attack targets
    targets = rank_attack_targets(state)
    if targets:
        t = Table(title="Top Attack Targets", box=box.SIMPLE, show_header=True)
        t.add_column("Star", style="cyan")
        t.add_column("Owner")
        t.add_column("Garrison", justify="right")
        t.add_column("Need", justify="right")
        t.add_column("From")
        t.add_column("Score", justify="right")
        for r in targets:
            t.add_row(
                r["star"].n,
                r["owner_alias"],
                str(r["garrison"]),
                str(r["ships_needed"]),
                r["nearest_own"],
                f"{r['score']:.1f}",
            )
        console.print(t)

    # Exposed stars
    exposed = find_exposed_stars(state)
    if exposed:
        names = ", ".join(s.n for s in exposed)
        console.print(f"  [red]Exposed stars (low garrison, near enemy):[/red] {names}")
