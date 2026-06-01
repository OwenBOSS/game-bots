"""Economy and research decision helpers."""
from __future__ import annotations
from .models import GameState, Star, Player

# Research order — most impactful first for the baseline strategy
RESEARCH_PRIORITY = [
    "weapons",       # direct combat multiplier; decisive early
    "terraforming",  # cheaper all upgrades → compounds every other decision
    "propulsion",    # faster fleets → faster expansion and defense
    "scanning",      # wider vision → better intel
    "manufacturing", # ship production multiplier
    "banking",       # economy multiplier; good after eco is built
    "research",      # science multiplier; rarely top priority
]


def cheapest_economy_upgrade(state: GameState) -> Star | None:
    """Star where the next economy upgrade costs least (use star.c — server-computed)."""
    candidates = [s for s in state.my_stars() if s.visible and s.c > 0]
    return min(candidates, key=lambda s: s.c, default=None)


def cheapest_industry_upgrade(state: GameState) -> Star | None:
    candidates = [s for s in state.my_stars() if s.visible and s.c > 0]
    # Industry costs ~2× economy; sort by resources as proxy if c covers only economy
    return min(candidates, key=lambda s: s.c, default=None)


def economy_roi_cycles(star: Star) -> float:
    """Production cycles to recoup an economy upgrade. Lower = better."""
    if star.c <= 0:
        return float("inf")
    return star.c / 10.0  # each economy building earns $10/cycle


def should_buy_economy(state: GameState) -> tuple[bool, Star | None]:
    """
    Buy economy when the cheapest upgrade pays back within 6 production cycles
    and we have the cash.
    """
    me = state.me()
    if not me:
        return False, None
    star = cheapest_economy_upgrade(state)
    if not star:
        return False, None
    roi = economy_roi_cycles(star)
    affordable = me.cash >= star.c
    return roi <= 6.0 and affordable, star


def best_research_target(state: GameState) -> str | None:
    """Return the highest-priority tech that still has room to level."""
    me = state.me()
    if not me or not me.tech:
        return None
    for tech_name in RESEARCH_PRIORITY:
        tech = me.tech.get(tech_name)
        if tech and tech.level < 16:
            return tech_name
    return None
