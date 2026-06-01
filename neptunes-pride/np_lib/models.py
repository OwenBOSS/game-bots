"""Pydantic v2 models for Neptune's Pride scanning_data JSON."""
from __future__ import annotations
from typing import Any
from pydantic import BaseModel, field_validator


class Tech(BaseModel):
    level: int = 1
    value: float = 1.0
    research: int = 0   # points accumulated toward next level (own player only)
    brr: int = 0        # base research requirement per level (own player only)

    @property
    def research_needed(self) -> int:
        return self.brr * (self.level + 1)

    @property
    def research_remaining(self) -> int:
        return max(0, self.research_needed - self.research)


class Player(BaseModel):
    uid: int
    alias: str
    ai: int = 0
    cash: float = 0.0           # visible only for own player
    total_stars: int = 0
    total_economy: int = 0
    total_industry: int = 0
    total_science: int = 0
    total_fleets: int = 0
    total_strength: int = 0     # total ships across all stars + fleets
    tech: dict[str, Tech] = {}
    war: list[int] = []
    researching: str = ""       # visible only for own player
    researching_next: str = ""  # visible only for own player

    @property
    def weapons_level(self) -> int:
        return self.tech.get("weapons", Tech()).level

    @property
    def is_human(self) -> bool:
        return self.ai == 0


class Star(BaseModel):
    uid: int
    n: str                  # name
    puid: int = -1          # owner UID; -1 = unowned
    x: float = 0.0
    y: float = 0.0
    v: str = "0"            # "1" = visible to us
    e: int = 0              # economy buildings
    i: int = 0              # industry buildings
    s: int = 0              # science buildings (unconfirmed; may be gate field)
    st: int = 0             # garrison ships
    ga: int = 0             # warp gate (0/1)
    nr: float = 0.0         # natural resources
    r: float = 0.0          # effective resources (nr + terraforming bonus)
    c: float = 0.0          # current upgrade cost (server-computed) — use this

    @property
    def visible(self) -> bool:
        return self.v == "1"

    @property
    def owned(self) -> bool:
        return self.puid != -1


class Fleet(BaseModel):
    uid: int
    puid: int               # owner UID
    n: str                  # name
    x: float = 0.0
    y: float = 0.0
    lx: float = 0.0         # last x
    ly: float = 0.0         # last y
    st: int = 0             # ships aboard
    w: int = 0              # weapons level cached at last scan
    o: list[Any] = []       # orders: [[action, ships, star_uid], ...]
    ouid: int = -1          # current target star UID (-1 = idle)


class GameState(BaseModel):
    tick: int
    tick_rate: int
    fleet_speed: float
    production_rate: int
    production_counter: int
    productions: int
    trade_cost: int
    stars_for_victory: int
    total_stars: int
    game_over: int
    paused: bool
    started: bool
    now: int = 0
    player_uid: int = -1    # set by detect_player_uid() after parsing

    stars: dict[str, Star] = {}
    fleets: dict[str, Fleet] = {}
    players: dict[str, Player] = {}

    @field_validator("stars", mode="before")
    @classmethod
    def _coerce_stars(cls, v: Any) -> dict:
        if not isinstance(v, dict):
            return {}
        return {k: ({**d, "uid": int(k)} if isinstance(d, dict) else d) for k, d in v.items()}

    @field_validator("fleets", mode="before")
    @classmethod
    def _coerce_fleets(cls, v: Any) -> dict:
        if not isinstance(v, dict):
            return {}
        return {k: ({**d, "uid": int(k)} if isinstance(d, dict) else d) for k, d in v.items()}

    @field_validator("players", mode="before")
    @classmethod
    def _coerce_players(cls, v: Any) -> dict:
        if not isinstance(v, dict):
            return {}
        return {k: ({**d, "uid": int(k)} if isinstance(d, dict) else d) for k, d in v.items()}

    # ------------------------------------------------------------------
    # Convenience accessors
    # ------------------------------------------------------------------

    def me(self) -> Player | None:
        return self.players.get(str(self.player_uid))

    def player(self, uid: int) -> Player | None:
        return self.players.get(str(uid))

    def my_stars(self) -> list[Star]:
        return [s for s in self.stars.values() if s.puid == self.player_uid]

    def enemy_stars(self) -> list[Star]:
        return [s for s in self.stars.values() if s.owned and s.puid != self.player_uid]

    def unowned_visible_stars(self) -> list[Star]:
        return [s for s in self.stars.values() if not s.owned and s.visible]

    def my_fleets(self) -> list[Fleet]:
        return [f for f in self.fleets.values() if f.puid == self.player_uid]

    @property
    def ticks_to_production(self) -> int:
        return self.production_rate - self.production_counter

    def detect_player_uid(self) -> int:
        """Identify own player — we are the only one with researching set."""
        for p in self.players.values():
            if p.researching:
                return p.uid
        # Fallback: player with non-zero cash (risky if broke)
        for p in self.players.values():
            if p.cash > 0:
                return p.uid
        return -1
