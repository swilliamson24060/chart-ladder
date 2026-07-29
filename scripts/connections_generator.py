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

            # --- CSV-only connections ---
            add(groups, "same_performer", performer, song_id)
            add(groups, "same_title", normalize_title(title), song_id)
            if s["peak_pos"] is not None:
                add(groups, "same_peak_position", str(s["peak_pos"]), song_id)

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

    # chart longevity buckets (not exact-match; bucketed so it's a meaningful shared trait)
    longevity_buckets = defaultdict(set)
    for song_id, s in songs.items():
        w = s["max_wks_on_chart"]
        if w >= 50:
            bucket = "50+ weeks"
        elif w >= 30:
            bucket = "30-49 weeks"
        elif w >= 20:
            bucket = "20-29 weeks"
        elif w >= 10:
            bucket = "10-19 weeks"
        else:
            continue  # short runs aren't a distinctive shared trait
        longevity_buckets[bucket].add(song_id)
    groups["chart_longevity"] = longevity_buckets

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

    songs_array = []
    for sid in ordered_song_ids:
        s = songs[sid]
        songs_array.append([s["title"], s["performer"], s["peak_pos"], s["max_wks_on_chart"]])
    # songs_array columns, in order: [title, performer, peak_pos, max_wks_on_chart]

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
        "song_fields": ["title", "performer", "peak_pos", "max_wks_on_chart"],
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

    if not has_wikidata:
        print("\nNote: no wd_* columns found -- this ran CSV-only connections. "
              "Run wikidata_enrich.py first and pass its output to get genre/label/writer/producer/award/band connections.")


if __name__ == "__main__":
    main()
