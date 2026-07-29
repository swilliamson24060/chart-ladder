#!/usr/bin/env python3
"""
Game-round logic for the chart-ladder game: given the song the player is
currently on, pick 3 connection tiles to show them (1 correct, 2 decoys),
and -- once they pick the correct one -- a next song to advance the chain.

Tile design (per the game's current rules):
  - "same_artist"   : same_performer OR same_artist_identity combined
                       (catches exact credit matches and name-variant
                       matches for the same act, e.g. a stylized rename).
  - "band_collab"   : collaboration OR band_membership combined
                       (replaces the old standalone "Collab" tile).
  - "same_genre"    : same_song_genre
  - "same_peak_pos" : same_peak_position
  - "same_award"    : same_award

Year is deliberately NOT a tile -- the player picks the year themselves,
so it can't also be a chain connection (that would be circular/redundant).

This module works directly against connections.json (or connections.json.gz)
as produced by connections_generator.py. It does not modify that file or
require re-running the generator -- it's a thin gameplay layer on top.

Usage as a library:

    from round_selector import ChartLadder

    game = ChartLadder("connections.json.gz")
    song_id = game.random_song()
    round_ = game.build_round(song_id)
    # round_.tiles is a shuffled list of 3 TileOption; round_.correct_tile
    # tells you which one is right (don't show this to the player up front)
    # round_.next_song(round_.correct_tile) -> a valid next song id

Usage as a CLI demo:

    python3 round_selector.py connections.json.gz --demo 5
"""

import argparse
import gzip
import json
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

TILE_DEFS = {
    "same_artist": {
        "label": "Same Artist",
        "connection_types": ["same_performer", "same_artist_identity"],
    },
    "band_collab": {
        "label": "Band / Collab",
        "connection_types": ["collaboration", "band_membership"],
    },
    "same_genre": {
        "label": "Same Genre",
        "connection_types": ["same_song_genre"],
    },
    "same_peak_pos": {
        "label": "Same Peak Chart Position",
        "connection_types": ["same_peak_position"],
    },
    "same_award": {
        "label": "Same Award",
        "connection_types": ["same_award"],
    },
}

TILE_KEYS = list(TILE_DEFS.keys())


@dataclass
class TileOption:
    key: str
    label: str
    is_correct: bool = field(default=False, compare=False)


@dataclass
class Round:
    song_id: int
    tiles: list
    correct_tile: str
    _game: "ChartLadder" = field(repr=False, compare=False)

    def next_song(self, chosen_tile_key, rng=None):
        """Call after the player picks a tile. Returns a valid next song id
        if they picked correctly, or None if they picked a decoy."""
        if chosen_tile_key != self.correct_tile:
            return None
        return self._game.random_neighbor(self.song_id, self.correct_tile, rng=rng)


class ChartLadder:
    def __init__(self, connections_path):
        self.songs, self.song_fields, self.connections = self._load(connections_path)
        self._memberships = self._build_memberships()

    @staticmethod
    def _load(path):
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        return data["songs"], data["song_fields"], data["connections"]

    def _build_memberships(self):
        """song_id -> tile_key -> list of (connection_type, group_key)
        this song belongs to. Used to test "does this song have a valid
        move on this tile" and to sample a next song cheaply, without
        materializing full pairwise neighbor sets up front."""
        memberships = defaultdict(lambda: defaultdict(list))
        for tile_key, tile_def in TILE_DEFS.items():
            for conn_type in tile_def["connection_types"]:
                group_map = self.connections.get(conn_type, {})
                for group_key, id_list in group_map.items():
                    if len(id_list) < 2:
                        continue
                    for sid in id_list:
                        memberships[sid][tile_key].append((conn_type, group_key))
        return memberships

    def song(self, song_id):
        """Return the song as a dict, e.g. {'title': ..., 'performer': ..., ...}"""
        return dict(zip(self.song_fields, self.songs[song_id]))

    def random_song(self, rng=None):
        rng = rng or random
        return rng.randrange(len(self.songs))

    def available_tiles(self, song_id):
        """Tile keys that have at least one valid next-song from this song."""
        return [t for t in TILE_KEYS if self._memberships.get(song_id, {}).get(t)]

    def random_neighbor(self, song_id, tile_key, rng=None, exclude=None):
        rng = rng or random
        memberships = self._memberships.get(song_id, {}).get(tile_key)
        if not memberships:
            return None
        exclude = exclude or set()
        # try a few times in case the sampled group's only other members are excluded
        for _ in range(10):
            conn_type, group_key = rng.choice(memberships)
            candidates = [i for i in self.connections[conn_type][group_key]
                          if i != song_id and i not in exclude]
            if candidates:
                return rng.choice(candidates)
        return None

    def build_round(self, song_id, rng=None, exclude_songs=None):
        """Build a 3-tile round for the given song: 1 correct, 2 decoys,
        shuffled so the correct one isn't always in the same position.
        Returns None if the song has no valid moves on any tile (dead end --
        caller should pick a different song)."""
        rng = rng or random
        correct_candidates = self.available_tiles(song_id)
        if not correct_candidates:
            return None

        correct_tile = rng.choice(correct_candidates)
        decoy_pool = [t for t in TILE_KEYS if t != correct_tile]
        decoys = rng.sample(decoy_pool, min(2, len(decoy_pool)))

        tile_keys = [correct_tile] + decoys
        rng.shuffle(tile_keys)

        tiles = [TileOption(key=k, label=TILE_DEFS[k]["label"], is_correct=(k == correct_tile))
                 for k in tile_keys]

        return Round(song_id=song_id, tiles=tiles, correct_tile=correct_tile, _game=self)

    def build_chain(self, length, start_song_id=None, rng=None, max_attempts=200):
        """Convenience: build a full chain of `length` songs, restarting the
        current song if it turns out to be a dead end. Returns a list of
        (song_id, correct_tile_key_used_to_reach_it) tuples; the first
        entry has tile=None since there's no prior connection."""
        rng = rng or random
        chain = [(start_song_id if start_song_id is not None else self.random_song(rng), None)]
        seen = {chain[0][0]}

        attempts = 0
        while len(chain) < length and attempts < max_attempts:
            attempts += 1
            current = chain[-1][0]
            round_ = self.build_round(current, rng=rng, exclude_songs=seen)
            if round_ is None:
                # dead end -- back up and try a different song if possible
                if len(chain) > 1:
                    chain.pop()
                    continue
                else:
                    chain[0] = (self.random_song(rng), None)
                    seen = {chain[0][0]}
                    continue
            nxt = round_.next_song(round_.correct_tile, rng=rng)
            if nxt is None or nxt in seen:
                continue
            chain.append((nxt, round_.correct_tile))
            seen.add(nxt)

        return chain


def _demo(path, n):
    game = ChartLadder(path)
    print(f"Loaded {len(game.songs)} songs, tiles: {list(TILE_DEFS.keys())}\n")
    chain = game.build_chain(n)
    for i, (song_id, via) in enumerate(chain):
        s = game.song(song_id)
        arrow = f"  --[{via}]-->  " if via else "  "
        print(f"{arrow}{s['title']} - {s['performer']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("connections_path")
    ap.add_argument("--demo", type=int, default=5, metavar="N",
                     help="Print a demo chain of N songs")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    _demo(args.connections_path, args.demo)
