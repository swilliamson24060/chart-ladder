#!/usr/bin/env python3
"""
Enrich a Billboard Hot 100 CSV with Wikidata metadata (genre, record label,
songwriter/composer, producer, awards, band membership, MusicBrainz ID).

WHY THIS RUNS LOCALLY, NOT IN A SANDBOX:
This script makes real HTTP requests to query.wikidata.org. It's designed to
be run on your own machine (or any machine with normal internet access),
not inside a network-restricted sandbox.

Usage:
    pip install requests
    python3 wikidata_enrich.py --csv "Billboard Hot 100 History - hot-100-current.csv"

This will:
  1. Parse unique performers (and split collab credits like "A Featuring B"
     into individual artist names for a collaboration graph).
  2. Parse unique (title, performer) pairs.
  3. Query Wikidata in batches for performer metadata: genre, record label,
     MusicBrainz artist ID, band members / group memberships.
  4. Query Wikidata in batches for song metadata: composer/lyricist,
     producer, genre, record label, award received -- resolved against the
     correct performer when a title is ambiguous (shared by multiple songs).
  5. Cache all raw results to ./cache/*.json so the script is safely
     resumable if interrupted (rate limits, network hiccups, etc).
  6. Write an enriched CSV: enriched_hot100.csv, with the original columns
     plus new wikidata_* columns.

Rate limiting: this script is deliberately conservative (1 request/sec,
batches of 80 names) to stay well within Wikidata's usage policy for
anonymous/unauthenticated use. A full run over ~11k performers + ~27k
titles will take a few hours. It is fully resumable -- just re-run the
same command and it will pick up where it left off.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
from collections import defaultdict

import requests

SPARQL_URL = "https://query.wikidata.org/sparql"
USER_AGENT = "ChartLadderGameEnrichment/1.0 (research project; contact: essar21@gmail.com)"
BATCH_SIZE = 80
SLEEP_BETWEEN_REQUESTS = 1.2
CACHE_DIR = "cache"

PERFORMER_TYPES = ["wd:Q639669", "wd:Q177220", "wd:Q36834", "wd:Q855091"]  # singer, singer-songwriter, songwriter, musician
GROUP_TYPES = ["wd:Q215380", "wd:Q5741069"]  # musical group, band
SONG_TYPES = ["wd:Q134556", "wd:Q7366", "wd:Q207338"]  # single, song, musical composition


def normalize(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def split_performers(p):
    """Split a Billboard performer credit into individual artist names."""
    s = re.sub(r"\s+(Featuring|Feat\.|feat\.|With|with)\s+", " & ", p)
    parts = re.split(r"\s*&\s*|\s*,\s*|\s+[Aa]nd\s+", s)
    parts = [re.sub(r"\s*\(Of [^)]*\)", "", x).strip() for x in parts]
    return [x for x in parts if x]


def sparql_query(query, retries=5):
    for attempt in range(retries):
        try:
            resp = requests.get(
                SPARQL_URL,
                params={"query": query, "format": "json"},
                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
                timeout=60,
            )
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 10))
                print(f"  rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            wait = 5 * (attempt + 1)
            print(f"  request error ({e}), retrying in {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"SPARQL query failed after {retries} retries")


def load_cache(name):
    path = os.path.join(CACHE_DIR, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_cache(name, data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=0)
    os.replace(tmp, path)


def batched(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


def sparql_values(names):
    escaped = [n.replace("\\", "\\\\").replace('"', '\\"') for n in names]
    return " ".join(f'"{n}"@en' for n in escaped)


# ---------------------------------------------------------------------------
# Performers
# ---------------------------------------------------------------------------

def build_performer_query(names):
    values = sparql_values(names)
    group_exists = " || ".join(f"EXISTS {{ ?item wdt:P31 {t} }}" for t in GROUP_TYPES)
    return f"""
SELECT ?name (SAMPLE(?item) as ?item) (SAMPLE(?mbid) as ?mbid)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") as ?genres)
  (GROUP_CONCAT(DISTINCT ?labelLabel; separator="|") as ?labels)
  (GROUP_CONCAT(DISTINCT ?memberLabel; separator="|") as ?members)
  (GROUP_CONCAT(DISTINCT ?memberOfLabel; separator="|") as ?memberOf)
WHERE {{
  VALUES ?name {{ {values} }}
  ?item rdfs:label ?name.
  {{ ?item wdt:P106 ?occ. FILTER(?occ IN ({", ".join(PERFORMER_TYPES)})) }}
  UNION
  {{ FILTER({group_exists}) }}
  OPTIONAL {{ ?item wdt:P136 ?genre. ?genre rdfs:label ?genreLabel. FILTER(lang(?genreLabel)='en') }}
  OPTIONAL {{ ?item wdt:P264 ?label. ?label rdfs:label ?labelLabel. FILTER(lang(?labelLabel)='en') }}
  OPTIONAL {{ ?item wdt:P434 ?mbid. }}
  OPTIONAL {{ ?item wdt:P527 ?member. ?member rdfs:label ?memberLabel. FILTER(lang(?memberLabel)='en') }}
  OPTIONAL {{ ?item wdt:P463 ?memberOf. ?memberOf rdfs:label ?memberOfLabel. FILTER(lang(?memberOfLabel)='en') }}
}}
GROUP BY ?name
"""


def enrich_performers(unique_names):
    cache = load_cache("performers.json")
    todo = [n for n in unique_names if n not in cache]
    print(f"Performers: {len(cache)} cached, {len(todo)} to fetch")

    for i, batch in enumerate(batched(todo, BATCH_SIZE)):
        print(f"  performer batch {i+1}/{(len(todo)-1)//BATCH_SIZE + 1} ({len(batch)} names)")
        q = build_performer_query(batch)
        data = sparql_query(q)
        found = set()
        for row in data["results"]["bindings"]:
            name = row["name"]["value"]
            found.add(name)
            cache[name] = {
                "wikidata_id": row.get("item", {}).get("value", "").rsplit("/", 1)[-1],
                "musicbrainz_id": row.get("mbid", {}).get("value"),
                "genres": row.get("genres", {}).get("value", "").split("|") if row.get("genres") else [],
                "labels": row.get("labels", {}).get("value", "").split("|") if row.get("labels") else [],
                "members": row.get("members", {}).get("value", "").split("|") if row.get("members") else [],
                "member_of": row.get("memberOf", {}).get("value", "").split("|") if row.get("memberOf") else [],
            }
        for n in batch:
            if n not in found:
                cache[n] = None  # explicitly mark "no match" so we don't re-query it
        save_cache("performers.json", cache)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return cache


# ---------------------------------------------------------------------------
# Songs
# ---------------------------------------------------------------------------

def build_song_query(titles):
    values = sparql_values(titles)
    return f"""
SELECT ?title ?item
  (GROUP_CONCAT(DISTINCT ?performerLabel; separator="|") as ?performers)
  (GROUP_CONCAT(DISTINCT ?writerLabel; separator="|") as ?writers)
  (GROUP_CONCAT(DISTINCT ?producerLabel; separator="|") as ?producers)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") as ?genres)
  (GROUP_CONCAT(DISTINCT ?labelLabel; separator="|") as ?labels)
  (GROUP_CONCAT(DISTINCT ?awardLabel; separator="|") as ?awards)
WHERE {{
  VALUES ?title {{ {values} }}
  ?item rdfs:label ?title.
  ?item wdt:P31 ?type.
  FILTER(?type IN ({", ".join(SONG_TYPES)}))
  OPTIONAL {{ ?item wdt:P175 ?performer. ?performer rdfs:label ?performerLabel. FILTER(lang(?performerLabel)='en') }}
  OPTIONAL {{ ?item (wdt:P86|wdt:P676) ?writer. ?writer rdfs:label ?writerLabel. FILTER(lang(?writerLabel)='en') }}
  OPTIONAL {{ ?item wdt:P162 ?producer. ?producer rdfs:label ?producerLabel. FILTER(lang(?producerLabel)='en') }}
  OPTIONAL {{ ?item wdt:P136 ?genre. ?genre rdfs:label ?genreLabel. FILTER(lang(?genreLabel)='en') }}
  OPTIONAL {{ ?item wdt:P264 ?label. ?label rdfs:label ?labelLabel. FILTER(lang(?labelLabel)='en') }}
  OPTIONAL {{ ?item wdt:P166 ?award. ?award rdfs:label ?awardLabel. FILTER(lang(?awardLabel)='en') }}
}}
GROUP BY ?title ?item
"""


def enrich_songs(unique_titles, known_names_by_norm):
    cache = load_cache("songs_by_title.json")
    todo = [t for t in unique_titles if t not in cache]
    print(f"Songs: {len(cache)} titles cached, {len(todo)} to fetch")

    for i, batch in enumerate(batched(todo, BATCH_SIZE)):
        print(f"  song batch {i+1}/{(len(todo)-1)//BATCH_SIZE + 1} ({len(batch)} titles)")
        q = build_song_query(batch)
        data = sparql_query(q)
        by_title = defaultdict(list)
        for row in data["results"]["bindings"]:
            title = row["title"]["value"]
            by_title[title].append({
                "wikidata_id": row.get("item", {}).get("value", "").rsplit("/", 1)[-1],
                "performers": row.get("performers", {}).get("value", "").split("|") if row.get("performers") else [],
                "writers": row.get("writers", {}).get("value", "").split("|") if row.get("writers") else [],
                "producers": row.get("producers", {}).get("value", "").split("|") if row.get("producers") else [],
                "genres": row.get("genres", {}).get("value", "").split("|") if row.get("genres") else [],
                "labels": row.get("labels", {}).get("value", "").split("|") if row.get("labels") else [],
                "awards": row.get("awards", {}).get("value", "").split("|") if row.get("awards") else [],
            })
        for t in batch:
            cache[t] = by_title.get(t, [])
        save_cache("songs_by_title.json", cache)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return cache


def resolve_song_candidate(candidates, performer_name, collab_names):
    """Pick the right Wikidata item for a title when multiple songs share it."""
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    target_norms = {normalize(performer_name)} | {normalize(n) for n in collab_names}
    for c in candidates:
        perf_norms = {normalize(p) for p in c["performers"]}
        if target_norms & perf_norms:
            return c
    return None  # ambiguous, no confident match -- skip rather than guess wrong


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="Path to the Billboard Hot 100 CSV")
    ap.add_argument("--out", default="enriched_hot100.csv")
    ap.add_argument("--skip-performers", action="store_true")
    ap.add_argument("--skip-songs", action="store_true")
    args = ap.parse_args()

    rows = []
    performers = set()
    titles = set()
    collabs_by_performer = {}

    with open(args.csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
            performers.add(row["performer"])
            titles.add(row["title"])
            if row["performer"] not in collabs_by_performer:
                collabs_by_performer[row["performer"]] = split_performers(row["performer"])

    print(f"Loaded {len(rows)} rows, {len(performers)} unique performers, {len(titles)} unique titles")

    # also enrich the individual split-out collaborator names
    all_person_names = set(performers)
    for names in collabs_by_performer.values():
        all_person_names.update(names)

    perf_cache = {}
    if not args.skip_performers:
        perf_cache = enrich_performers(sorted(all_person_names))
    else:
        perf_cache = load_cache("performers.json")

    song_cache = {}
    if not args.skip_songs:
        song_cache = enrich_songs(sorted(titles), None)
    else:
        song_cache = load_cache("songs_by_title.json")

    # write enriched CSV
    fieldnames = list(rows[0].keys()) + [
        "wd_performer_genres", "wd_performer_labels", "wd_performer_mbid",
        "wd_collaborators", "wd_band_members", "wd_member_of",
        "wd_writers", "wd_producers", "wd_song_genres", "wd_song_labels", "wd_awards",
    ]
    out_path = args.out
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            perf = row["performer"]
            collab_names = [n for n in collabs_by_performer.get(perf, []) if n != perf]
            p_info = perf_cache.get(perf)
            candidates = song_cache.get(row["title"], [])
            s_info = resolve_song_candidate(candidates, perf, collab_names)

            out_row = dict(row)
            out_row["wd_performer_genres"] = "|".join(p_info["genres"]) if p_info else ""
            out_row["wd_performer_labels"] = "|".join(p_info["labels"]) if p_info else ""
            out_row["wd_performer_mbid"] = p_info["musicbrainz_id"] if p_info else ""
            out_row["wd_collaborators"] = "|".join(collab_names)
            out_row["wd_band_members"] = "|".join(p_info["members"]) if p_info else ""
            out_row["wd_member_of"] = "|".join(p_info["member_of"]) if p_info else ""
            out_row["wd_writers"] = "|".join(s_info["writers"]) if s_info else ""
            out_row["wd_producers"] = "|".join(s_info["producers"]) if s_info else ""
            out_row["wd_song_genres"] = "|".join(s_info["genres"]) if s_info else ""
            out_row["wd_song_labels"] = "|".join(s_info["labels"]) if s_info else ""
            out_row["wd_awards"] = "|".join(s_info["awards"]) if s_info else ""
            writer.writerow(out_row)

    matched_performers = sum(1 for v in perf_cache.values() if v)
    matched_songs = sum(1 for cands in song_cache.values() if cands)
    print(f"\nDone. Wrote {out_path}")
    print(f"Performer match rate: {matched_performers}/{len(perf_cache)} ({matched_performers/max(1,len(perf_cache))*100:.1f}%)")
    print(f"Song title match rate: {matched_songs}/{len(song_cache)} ({matched_songs/max(1,len(song_cache))*100:.1f}%)")


if __name__ == "__main__":
    main()
