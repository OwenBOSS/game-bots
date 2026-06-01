"""HTTP session wrapper for the Neptune's Pride undocumented API."""
import requests
from typing import Any

BASE_URL = "https://np.ironhelmet.com"


class NPClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "np-bot/0.1"

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, alias: str, password: str) -> bool:
        resp = self.session.post(
            f"{BASE_URL}/arequest/login",
            data={"alias": alias, "password": password, "type": "login"},
        )
        resp.raise_for_status()
        body = resp.json()
        return isinstance(body, list) and body[0] == "meta:login_success"

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def get_universe(self, game_number: int) -> dict[str, Any]:
        """Full universe report — the main polling endpoint."""
        resp = self.session.post(
            f"{BASE_URL}/trequest/order",
            data={"type": "order", "order": "full_universe_report", "game_number": game_number},
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("scanning_data", body)

    def get_intel(self, game_number: int) -> dict[str, Any]:
        resp = self.session.post(
            f"{BASE_URL}/trequest/intel_data",
            data={"type": "intel_data", "game_number": game_number},
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Orders (confirmed format via DevTools)
    #
    # type=batched_orders, gameId=<id>, version=, order=<action>,<arg1>,<arg2>
    # Example: order=upgrade_economy,78,16
    # ------------------------------------------------------------------

    def buy_economy(self, game_id: int, star_uid: int, expected_cost: int) -> dict[str, Any]:
        """Buy one economy upgrade. expected_cost must match server's current cost or it rejects."""
        return self._batched_order(game_id, f"upgrade_economy,{star_uid},{expected_cost}")

    def buy_industry(self, game_id: int, star_uid: int, expected_cost: int) -> dict[str, Any]:
        return self._batched_order(game_id, f"upgrade_industry,{star_uid},{expected_cost}")

    def buy_science(self, game_id: int, star_uid: int, expected_cost: int) -> dict[str, Any]:
        return self._batched_order(game_id, f"upgrade_science,{star_uid},{expected_cost}")

    # Unconfirmed — capture via DevTools when changing research in-game
    # def set_research(self, game_id: int, tech: str) -> dict[str, Any]:
    #     return self._batched_order(game_id, f"change_research,{tech}")

    def _batched_order(self, game_id: int, order: str) -> dict[str, Any]:
        resp = self.session.post(
            f"{BASE_URL}/trequest/order",
            data={"type": "batched_orders", "order": order, "version": "", "gameId": game_id},
        )
        resp.raise_for_status()
        return resp.json()
