"""Baseline bot entry point — poll, analyse, print. No orders issued yet."""
import os
import sys
import time
from pathlib import Path

# Allow running directly: uv run python exp-01-baseline/run.py
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from rich.console import Console

from np_lib.client import NPClient
from np_lib.models import GameState
from strategy import print_status

load_dotenv(Path(__file__).parent.parent / ".env")
console = Console()


def poll_once(client: NPClient, game_number: int, player_uid: int) -> int:
    """Fetch state, run strategy, return detected player_uid."""
    try:
        raw = client.get_universe(game_number)
    except Exception as e:
        console.print(f"[red]Fetch failed: {e}[/red]")
        return player_uid

    state = GameState.model_validate(raw)
    state.player_uid = player_uid if player_uid != -1 else state.detect_player_uid()

    if state.player_uid == -1:
        console.print("[red]Could not detect player UID — check credentials / game number[/red]")
        return -1

    print_status(state)
    return state.player_uid


def main() -> None:
    alias = os.environ.get("NP_ALIAS", "")
    password = os.environ.get("NP_PASSWORD", "")
    game_number = int(os.environ.get("NP_GAME_NUMBER", "7769"))
    poll_minutes = float(os.environ.get("POLL_INTERVAL_MINUTES", "5"))
    player_uid = int(os.environ.get("NP_PLAYER_UID", "-1"))

    if not alias or not password:
        console.print("[red]Set NP_ALIAS and NP_PASSWORD in neptunes-pride/.env[/red]")
        sys.exit(1)

    client = NPClient()
    console.print(f"Logging in as [cyan]{alias}[/cyan] …")

    if not client.login(alias, password):
        console.print("[red]Login failed — check NP_ALIAS and NP_PASSWORD[/red]")
        sys.exit(1)

    console.print(f"[green]OK.[/green] Polling game [bold]{game_number}[/bold] every {poll_minutes} min\n")

    while True:
        player_uid = poll_once(client, game_number, player_uid)
        console.print()
        time.sleep(poll_minutes * 60)


if __name__ == "__main__":
    main()
