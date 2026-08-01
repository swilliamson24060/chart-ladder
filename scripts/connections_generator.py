#!/usr/bin/env python3
"""
Build the chart-ladder game's connections dataset from the (optionally
Wikidata-enriched) Billboard Hot 100 CSV.

Works with the raw CSV alone (same performer, collab graph, same title,
same peak position, chart longevity, one-hit-wonder, shared title words),
and adds richer connections automatically if it detects the wd_* columns
produced by wikidata_enrich.py (genre, label, writer, producer, band
membership, awards).

Output shape: instead of precomputed pairs (which would explode into
millions of combinations for prolific artists), each connection type maps
an attribute value -> the list of song IDs that share it. At game-build
time, pick a connection type, pick a group with 2+ songs, pick two songs
from it. This keeps the file small and lets the game control variety
(e.g. weight rarer groups higher, avoid reusing the same pair twice).

Compact encoding: songs are stored once as an array (position in the array
IS the song's ID -- no repeated string keys), and every connection group
references songs by that small integer index instead of the full
"Performer|||Title" string. Since a popular performer's songs show up in
many groups (same_performer, collaboration, same_writer, chart_longevity,
shared_title_word, ...), replacing a ~20-30 character repeated string with
a 1-5 digit integer is most of the file-size win. The script writes both a
plain .json and a gzip-compressed .json.gz, and prints a size comparison
against the old string-keyed format so you can see the effect.

Usage:
    python3 connections_generator.py --csv enriched_hot100.csv --out connections.json
    (or run directly against the raw CSV if you haven't enriched it yet)
"""

import argparse
import csv
import gzip
import json
import os
import re
import unicodedata
from collections import defaultdict


def normalize_title(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")
    t = t.lower()
    t = re.sub(r"[^a-z0-9 ]+", "", t)
    return t.strip()


def title_words(t):
    stop = {"the", "a", "an", "of", "in", "on", "to", "and", "my", "you", "i", "me"}
    words = re.findall(r"[a-z0-9']+", t.lower())
    return {w for w in words if w not in stop and len(w) > 2}


def split_performers(p):
    s = re.sub(r"\s+(Featuring|Feat\.|feat\.|With|with)\s+", " & ", p)
    parts = re.split(r"\s*&\s*|\s*,\s*|\s+[Aa]nd\s+", s)
    parts = [re.sub(r"\s*\(Of [^)]*\)", "", x).strip() for x in parts]
    return [x for x in parts if x]


def add(groups, key, value, song_id):
    groups[key][value].add(song_id)


# Chart-tier thresholds. These two traits are deliberately coarse and
# binary: a player can plausibly recall whether a song was a Top 40 hit or
# whether it hung around for a season, but never that two songs both peaked
# at exactly #63 or both ran 20-29 weeks.
TOP_40_CUTOFF = 40
LONG_RUN_CUTOFF_WEEKS = 13  # ~3 months


# --- fame scoring ---------------------------------------------------------
#
# A 0-100 "would a player plausibly recognise this song" score, used by the
# game to keep a round's songs inside a recognisability band instead of
# drawing uniformly from 30k+ Hot 100 entries (most of which peaked in the
# 70s for three weeks in 1974 and are unknowable to anyone). Nothing about
# this score is ever shown to the player - it only shapes which songs get
# drawn, so the puzzle stays a reasoning exercise rather than becoming a
# spot-the-number exercise.
FAME_WEIGHT_PEAK = 0.45        # how high it charted
FAME_WEIGHT_WEEKS = 0.35       # how long it stuck around
FAME_WEIGHT_DURABILITY = 0.15  # charted across multiple calendar years (re-entries, perennials)
FAME_WEIGHT_AWARD = 0.05       # has a Wikidata award
# Distinct chart years at which the durability term saturates. 3 -> a song
# charting in 3+ separate years gets full marks for endurance.
FAME_DURABILITY_YEARS = 3


def percentile_ranks(values):
    """Map each value to its 0..1 rank within `values`, higher value ->
    higher rank. Ties share the midpoint of their block, so the result
    doesn't depend on input ordering (peak position and weeks-on-chart are
    small integers with enormous tie blocks - ordinal ranking would break
    those ties arbitrarily and make the score unstable across runs)."""
    n = len(values)
    if n == 0:
        return []
    if n == 1:
        return [1.0]
    order = sorted(range(n), key=lambda i: values[i])
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        rank = ((i + j) / 2) / (n - 1)
        for k in range(i, j + 1):
            ranks[order[k]] = rank
        i = j + 1
    return ranks


def compute_fame(songs):
    """song_id -> 0-100 fame score, percentile-normalised *within each debut
    decade*.

    Normalising per-decade is essential, not cosmetic: Billboard's chart
    rules changed enormously over 70 years, so raw weeks-on-chart is not
    comparable across eras (median run is ~7 weeks for a 1960s song, ~17 for
    a 2000s one, and ~2 for a 2020s one under streaming-era churn). Scoring
    on absolute values would flood the game with 90s/00s songs and all but
    erase the 2020s. Ranking each song against its own decade's cohort keeps
    every era represented by its own most-recognisable material."""
    by_decade = defaultdict(list)
    for song_id, s in songs.items():
        year = s["first_year"]
        by_decade[(year // 10) * 10 if year is not None else None].append(song_id)

    fame = {}
    for _decade, ids in by_decade.items():
        # Negated so that "higher is better" holds for both terms: peak_pos
        # 1 is the best chart position, and a missing peak sorts last.
        peak_ranks = percentile_ranks([-(songs[i]["peak_pos"] or 101) for i in ids])
        week_ranks = percentile_ranks([songs[i]["max_wks_on_chart"] for i in ids])
        for i, peak_rank, week_rank in zip(ids, peak_ranks, week_ranks):
            s = songs[i]
            durability = min(1.0, (len(s["chart_years"]) - 1) / max(1, FAME_DURABILITY_YEARS - 1))
            score = (
                FAME_WEIGHT_PEAK * peak_rank
                + FAME_WEIGHT_WEEKS * week_rank
                + FAME_WEIGHT_DURABILITY * durability
                + FAME_WEIGHT_AWARD * (1.0 if s["has_award"] else 0.0)
            )
            fame[i] = round(100 * score, 1)
    return fame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default="connections.json")
    ap.add_argument("--min-group-size", type=int, default=2)
    ap.add_argument("--max-group-size", type=int, default=400,
                     help="Groups larger than this (e.g. peak_pos=1) are capped by sampling, "
                          "so one mega-category doesn't dominate every ladder.")
    ap.add_argument("--no-gzip", action="store_true", help="Skip writing the .gz companion file")
    ap.add_argument("--pretty", action="store_true", help="Indent the JSON (bigger file, for debugging only)")
    args = ap.parse_args()

    songs = {}  # song_id (string, internal only) -> metadata
    song_by_title_perf = {}
    performer_titles = defaultdict(set)

    groups = defaultdict(lambda: defaultdict(set))

    has_wikidata = False

    with open(args.csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if "wd_writers" in (reader.fieldnames or []):
            has_wikidata = True
        for row in reader:
            title = row["title"]
            performer = row["performer"]
            song_id = f"{performer}|||{title}"

            if song_id not in songs:
                songs[song_id] = {
                    "title": title,
                    "performer": performer,
                    "peak_pos": None,
                    "max_wks_on_chart": 0,
                    "first_chart_week": row.get("chart_week"),
                    # fame inputs (see compute_fame)
                    "first_year": None,
                    "chart_years": set(),
                    "has_award": False,
                }
                song_by_title_perf[(normalize_title(title), performer)] = song_id
                performer_titles[performer].add(song_id)

            s = songs[song_id]
            try:
                pp = int(row["peak_pos"])
                if s["peak_pos"] is None or pp < s["peak_pos"]:
                    s["peak_pos"] = pp
            except (ValueError, KeyError):
                pass
            try:
                wks = int(row["wks_on_chart"])
                if wks > s["max_wks_on_chart"]:
                    s["max_wks_on_chart"] = wks
            except (ValueError, KeyError):
                pass
            try:
                year = int(row["year"])
                s["chart_years"].add(year)
                if s["first_year"] is None or year < s["first_year"]:
                    s["first_year"] = year
            except (ValueError, KeyError, TypeError):
                pass
            if row.get("wd_awards"):
                s["has_award"] = True

            # --- CSV-only connections ---
            add(groups, "same_performer", performer, song_id)
            add(groups, "same_title", normalize_title(title), song_id)
            # NB: chart tier and chart run are deliberately NOT computed
            # here. Both depend on the song's *final* peak/week totals, and
            # inside this loop those are only the running values seen so far
            # - a song that debuts at #80 and climbs to #2 would be filed
            # under both tiers. They're derived after the read loop instead.

            collab_names = split_performers(performer)
            if len(collab_names) > 1:
                # only a real collaboration if the credit actually split into
                # 2+ names -- a solo artist's own name shouldn't create a
                # "collaboration" match against their other solo songs
                for name in collab_names:
                    add(groups, "collaboration", name, song_id)

            # --- Wikidata-derived connections, if present ---
            if has_wikidata:
                for genre in (row.get("wd_performer_genres") or "").split("|"):
                    if genre:
                        add(groups, "same_artist_genre", genre, song_id)
                for genre in (row.get("wd_song_genres") or "").split("|"):
                    if genre:
                        add(groups, "same_song_genre", genre, song_id)
                for label in (row.get("wd_performer_labels") or "").split("|"):
                    if label:
                        add(groups, "same_label", label, song_id)
                for writer in (row.get("wd_writers") or "").split("|"):
                    if writer:
                        add(groups, "same_writer", writer, song_id)
                for producer in (row.get("wd_producers") or "").split("|"):
                    if producer:
                        add(groups, "same_producer", producer, song_id)
                for award in (row.get("wd_awards") or "").split("|"):
                    if award:
                        add(groups, "same_award", award, song_id)
                for member in (row.get("wd_band_members") or "").split("|"):
                    if member:
                        add(groups, "band_membership", member, song_id)
                for group_name in (row.get("wd_member_of") or "").split("|"):
                    if group_name:
                        add(groups, "band_membership", group_name, song_id)
                mbid = row.get("wd_performer_mbid")
                if mbid:
                    add(groups, "same_artist_identity", mbid, song_id)  # catches name variants of the same act

    # Chart tier and chart run, both derived once per song from its final
    # totals so each song lands in exactly one group of each pair.
    #
    # Tier replaces exact peak position: "both peaked at #63" is a
    # coincidence no player can reason about, whereas "both were Top 40
    # hits" is a fact about a song someone might actually know. Run length
    # replaces the old five-way week buckets, which asked players to tell a
    # 20-29 week run from a 30-49 week one. Each is two mutually exclusive
    # connection types rather than one type with two groups, so the tile the
    # player picks names which side it is.
    for song_id, s in songs.items():
        if s["peak_pos"] is not None:
            tier = "top_40" if s["peak_pos"] <= TOP_40_CUTOFF else "outside_top_40"
            add(groups, tier, tier, song_id)
        run = "long_run" if s["max_wks_on_chart"] >= LONG_RUN_CUTOFF_WEEKS else "short_run"
        add(groups, run, run, song_id)

    # shared title words (only for titles that aren't exact matches -- that's same_title's job)
    word_groups = defaultdict(set)
    for song_id, s in songs.items():
        for w in title_words(s["title"]):
            word_groups[w].add(song_id)
    groups["shared_title_word"] = {w: ids for w, ids in word_groups.items() if len(ids) >= 2}

    # one-hit-wonders: performers with exactly one unique song in the dataset
    one_hit = {p for p, ids in performer_titles.items() if len(ids) == 1}
    songs_one_hit = {sid for p in one_hit for sid in performer_titles[p]}
    groups["one_hit_wonder_flag"] = {"one_hit_wonder": songs_one_hit} if songs_one_hit else {}

    # --- assign compact integer IDs -------------------------------------
    # Position in this list IS the song's ID everywhere else in the file.
    # Only songs that appear in at least one surviving connection group are
    # worth keeping -- anything with zero shared traits can't be used as a
    # ladder rung anyway, so we drop it rather than pay for it in the file.
    referenced = set()
    for valmap in groups.values():
        for id_set in valmap.values():
            if len(id_set) >= args.min_group_size:
                referenced |= id_set

    ordered_song_ids = sorted(referenced)  # stable order -> stable IDs across runs
    id_index = {sid: i for i, sid in enumerate(ordered_song_ids)}

    # Fame is ranked across every song in the CSV, not just the referenced
    # subset, so a song's score doesn't shift depending on which connection
    # types happened to survive the min-group-size filter.
    fame = compute_fame(songs)

    songs_array = []
    for sid in ordered_song_ids:
        s = songs[sid]
        songs_array.append([s["title"], s["performer"], s["peak_pos"], s["max_wks_on_chart"], fame[sid]])
    # songs_array columns, in order: [title, performer, peak_pos, max_wks_on_chart, fame]

    # finalize: drop groups below min size, cap oversized groups, remap to int IDs
    final = {}
    stats = {}
    import random
    random.seed(42)
    for conn_type, valmap in groups.items():
        out = {}
        for key, id_set in valmap.items():
            if len(id_set) < args.min_group_size:
                continue
            ids = sorted(id_set)
            if len(ids) > args.max_group_size:
                ids = random.sample(ids, args.max_group_size)
            out[key] = [id_index[sid] for sid in ids]
        if out:
            final[conn_type] = out
            group_sizes = [len(v) for v in out.values()]
            stats[conn_type] = {
                "num_groups": len(out),
                "total_songs_involved": len(set().union(*[set(v) for v in out.values()])),
                "avg_group_size": round(sum(group_sizes) / len(group_sizes), 1),
                "largest_group": max(group_sizes),
            }

    result = {
        "song_fields": ["title", "performer", "peak_pos", "max_wks_on_chart", "fame"],
        "songs": songs_array,
        "connections": final,
    }

    dump_kwargs = {"indent": 1} if args.pretty else {"separators": (",", ":")}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, **dump_kwargs)

    plain_size = os.path.getsize(args.out)
    gz_size = None
    if not args.no_gzip:
        gz_path = args.out + ".gz"
        with open(args.out, "rb") as fin, gzip.open(gz_path, "wb", compresslevel=9) as fout:
            fout.write(fin.read())
        gz_size = os.path.getsize(gz_path)

    print(f"Wrote {args.out}  ({plain_size/1e6:.2f} MB)")
    if gz_size:
        print(f"Wrote {gz_path}  ({gz_size/1e6:.2f} MB gzipped, {plain_size/max(gz_size,1):.1f}x smaller) <- serve this one")
    print(f"\n{len(songs_array)} songs referenced by at least one connection "
          f"(of {len(songs)} total unique songs in the CSV), {len(final)} connection types\n")
    print(f"{'connection_type':<24}{'groups':>8}{'songs covered':>16}{'avg size':>10}{'max size':>10}")
    for conn_type, s in sorted(stats.items(), key=lambda x: -x[1]["total_songs_involved"]):
        print(f"{conn_type:<24}{s['num_groups']:>8}{s['total_songs_involved']:>16}{s['avg_group_size']:>10}{s['largest_group']:>10}")

    emitted_fame = sorted((fame[sid] for sid in ordered_song_ids), reverse=True)
    print(f"\n{'fame floor':<14}{'songs above':>13}{'% of pool':>11}")
    for floor in (80, 70, 60, 50, 0):
        above = sum(1 for f in emitted_fame if f >= floor)
        print(f"{floor:<14}{above:>13}{100 * above / max(1, len(emitted_fame)):>10.1f}%")

    if not has_wikidata:
        print("\nNote: no wd_* columns found -- this ran CSV-only connections. "
              "Run wikidata_enrich.py first and pass its output to get genre/label/writer/producer/award/band connections.")


if __name__ == "__main__":
    main()
