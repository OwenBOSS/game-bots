"""Combat simulation for Neptune's Pride.

Rules:
  - Both sides fire simultaneously each round
  - Attacker kills attacker_weapons defenders per round
  - Defender kills (defender_weapons + 1) attackers per round  ← +1 home bonus
  - Ties go to the defender
"""
import math


def simulate(
    attacker_ships: int,
    attacker_weapons: int,
    defender_ships: int,
    defender_weapons: int,
) -> tuple[bool, int]:
    """
    Returns (attacker_wins, surviving_ships).
    surviving_ships is attacker count if they won, defender count if they won.
    """
    w_a = max(1, attacker_weapons)
    w_d = max(1, defender_weapons) + 1

    rounds_to_kill_def = math.ceil(defender_ships / w_a)
    rounds_to_kill_atk = math.ceil(attacker_ships / w_d)

    if rounds_to_kill_def < rounds_to_kill_atk:
        survivors = attacker_ships - rounds_to_kill_def * w_d
        return True, max(1, survivors)
    else:
        survivors = defender_ships - rounds_to_kill_atk * w_a
        return False, max(0, survivors)


def ships_needed_to_capture(
    defender_ships: int,
    defender_weapons: int,
    attacker_weapons: int,
    margin: float = 1.5,
) -> int:
    """Minimum ships the attacker needs to win, multiplied by a safety margin."""
    w_a = max(1, attacker_weapons)
    w_d = max(1, defender_weapons) + 1
    # Need: ceil(d/w_a) < ceil(a/w_d)  →  a > d * w_d / w_a
    bare_min = math.ceil(defender_ships * w_d / w_a) + 1
    return math.ceil(bare_min * margin)


def capture_score(
    garrison: int,
    natural_resources: int,
    attacker_weapons: int,
    defender_weapons: int,
) -> float:
    """
    Higher = better target. Balances star value against attack cost.
    nr drives upgrade value; garrison drives attack cost.
    """
    needed = ships_needed_to_capture(garrison, defender_weapons, attacker_weapons)
    value = natural_resources * 10 + 50
    return value / max(1, needed)
