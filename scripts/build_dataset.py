"""
Chartcross data pipeline.

Reads the raw Billboard Hot 100 weekly chart-history CSV and produces two
normalized JSON files used by the game:

  data/songs.json    - one entry per unique (title, performer-credit) song
  data/artists.json  - one entry per unique individual artist, with the
                        set of years/peaks they've charted at and the set
                        of artists they've directly co-credited with

Design decisions locked in with the user (2026-07-12):
  - Tiles can be ARTIST or SONG (matches the mockup, not just the rules text).
  - A song's "year" for matching purposes is its PEAK year (the calendar
    year in which it achieved its all-time-low peak_pos), not its debut year.
  - An artist tile's year-set/peak-set is the UNION across every song they
    are credited on (any overlap with a neighboring tile counts as a match).
  - An artist tile connects to a song tile (20-pt collaboration tier)
    whenever that artist is anywhere in the song's credit list - performing
    it alone is enough, no second co-artist required.
  - Artist-artist collaboration (20-pt tier) requires a DIRECT co-credit on
    at least one shared song - it is not transitive through a common
    third collaborator.
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict

RAW_CSV = "Billboard Hot 100 History - hot-100-current.csv"

# Real act names that contain characters we otherwise treat as collaborator
# separators. Matched case-insensitively, longest first, before splitting.
PROTECTED_NAMES = [
    "Crosby, Stills, Nash & Young",
    "Crosby, Stills & Nash",
    "Emerson, Lake & Palmer",
    "Blood, Sweat & Tears",
    "Peter, Paul & Mary",
    "England Dan & John Ford Coley",
    "Bob Seger & The Silver Bullet Band",
    "Gladys Knight & The Pips",
    "Martha & The Vandellas",
    "Booker T. & The M.G.'s",
    "Kenny Rogers & The First Edition",
    "Huey Lewis & The News",
    "Toots & The Maytals",
    "Big Brother & The Holding Company",
    "Bill Haley & His Comets",
    "The Mamas & The Papas",
    "Sly & The Family Stone",
    "Josie & The Pussycats",
    "Bob Marley & The Wailers",
    "Tom Petty & The Heartbreakers",
    "Wayne Fontana & The Mindbenders",
    "Gary Puckett & The Union Gap",
    "Question Mark & The Mysterians",
    "Danny & The Juniors",
    "Gerry & The Pacemakers",
    "Derek & The Dominos",
    "Diana Ross & The Supremes",
    "Ike & Tina Turner",
    "Earth, Wind & Fire",
    "Hall & Oates",
    "Ashford & Simpson",
    "Peaches & Herb",
    "Sam & Dave",
    "Simon & Garfunkel",
    "Captain & Tennille",
    "Sonny & Cher",
    "Chad & Jeremy",
    "Homer & Jethro",
    "Mickey & Sylvia",
    "Foster & Allen",
    "Loggins & Messina",
    "Seals & Crofts",
    "Kool & The Gang",
    "Chase & Status",
    "Above & Beyond",
    "Timbaland & Magoo",
    "Peter & Gordon",
    "Brooks & Dunn",
    "Big & Rich",
    "Y & T",
    "Lil Nas X",
    "HUNTR/X",
    "AC/DC",
    "Do Or Die",
    "M/A/R/R/S",
    "PG&E",
    "Y&T",
    "The Product G&B",
]

# Longest-first so multi-word protected names win before shorter substrings.
PROTECTED_NAMES.sort(key=len, reverse=True)

_SPLIT_RE = re.compile(
    r"""
    \s+Featuring\s+ |
    \s+Feat\.\s+ |
    \s+feat\.\s+ |
    \s+Duet\s+With\s+ |
    \s+With\s+ |
    \s+Or\s+ |
    \s+Vs\.\s+ |
    \s+vs\.\s+ |
    \s*&\s* |
    \s+[Xx]\s+ |
    \s*/\s* |
    \s*,\s*
    """,
    re.VERBOSE,
)

_PLACEHOLDER = "\x00{}\x00"

# Generic backing-ensemble descriptors that show up as their own comma/&
# separated fragment (e.g. "Reg Owen & His Orchestra" splits into "Reg Owen"
# and "His Orchestra"). Unlike a real band name (Bill Haley's "Comets"),
# this exact phrase is reused by dozens of unrelated 1950s-60s bandleaders,
# so treating it as one shared "artist" merges their distinct chart
# histories into a single bogus decades-spanning entity. Dropped entirely
# rather than kept as a phantom performer - the named artist is the real
# credit either way.
_GENERIC_ENSEMBLE_RE = re.compile(
    r"^(and\s+)?(his|her|their|the)\s+"
    r"(orchestra|band|trio|combo|quartet|quintet|ensemble|singers|choir|chorus)"
    r"(\s+and\s+chorus)?$",
    re.IGNORECASE,
)


def split_performers(raw: str):
    """Parse a messy Billboard performer credit string into individual artist names."""
    working = raw.strip().replace("(", " ").replace(")", " ")
    placeholders = {}
    for i, name in enumerate(PROTECTED_NAMES):
        pattern = re.compile(re.escape(name), re.IGNORECASE)
        if pattern.search(working):
            token = _PLACEHOLDER.format(i)
            working = pattern.sub(token, working)
            placeholders[token] = name

    parts = _SPLIT_RE.split(working)

    result = []
    seen = set()
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if part in placeholders:
            part = placeholders[part]
        else:
            for token, name in placeholders.items():
                part = part.replace(token, name)
        part = part.strip(" \"'")
        if not part:
            continue
        if _GENERIC_ENSEMBLE_RE.match(part):
            continue
        if part.lower() not in seen:
            seen.add(part.lower())
            result.append(part)
    return result


def main():
    parser = argparse.ArgumentParser(description="Build a normalized Chartcross dataset from a chart-history CSV.")
    parser.add_argument("--input", default=RAW_CSV, help="Source chart-history CSV.")
    parser.add_argument("--output-dir", default="data", help="Directory for songs.json, artists.json, and parse_report.json.")
    args = parser.parse_args()
    raw_csv = args.input
    output_dir = args.output_dir
    out_songs = os.path.join(output_dir, "songs.json")
    out_artists = os.path.join(output_dir, "artists.json")
    out_report = os.path.join(output_dir, "parse_report.json")
    os.makedirs(output_dir, exist_ok=True)

    songs = {}  # (title, raw_performer) -> song dict accumulator
    row_count = 0

    with open(raw_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            title = row["title"].strip()
            performer_raw = row["performer"].strip()
            year = int(row["year"])
            peak_pos = int(row["peak_pos"])
            key = (title, performer_raw)

            s = songs.get(key)
            if s is None:
                s = {
                    "title": title,
                    "raw_performer": performer_raw,
                    "debut_year": year,
                    "peak_year": year,
                    "peak_pos": peak_pos,
                    "wks_on_chart": int(row["wks_on_chart"] or 0),
                }
                songs[key] = s
            else:
                if year < s["debut_year"]:
                    s["debut_year"] = year
                if peak_pos < s["peak_pos"]:
                    s["peak_pos"] = peak_pos
                    s["peak_year"] = year
                elif peak_pos == s["peak_pos"] and year < s["peak_year"]:
                    s["peak_year"] = year
                wks = int(row["wks_on_chart"] or 0)
                if wks > s["wks_on_chart"]:
                    s["wks_on_chart"] = wks

    print(f"Parsed {row_count} chart-week rows into {len(songs)} unique songs.", file=sys.stderr)

    # Parse performer credits into individual artists, assign ids.
    artist_ids = {}  # normalized name (lower) -> artist_id
    artist_display = {}  # artist_id -> display name
    artist_songs = defaultdict(list)  # artist_id -> [song_id]
    artist_years = defaultdict(set)
    artist_peaks = defaultdict(set)
    collab_edges = defaultdict(set)  # artist_id -> set(artist_id)

    flagged = []  # performer strings whose parse looks suspicious
    songs_out = []

    for idx, ((title, performer_raw), s) in enumerate(songs.items()):
        song_id = f"s{idx}"
        names = split_performers(performer_raw)

        for n in names:
            if len(n) <= 2 or n.lower() in {"the", "his", "her", "and", "orchestra"}:
                flagged.append(performer_raw)
                break

        performer_ids = []
        for name in names:
            key_l = name.lower()
            aid = artist_ids.get(key_l)
            if aid is None:
                aid = f"a{len(artist_ids)}"
                artist_ids[key_l] = aid
                artist_display[aid] = name
            performer_ids.append(aid)
            artist_songs[aid].append(song_id)
            artist_years[aid].add(s["peak_year"])
            artist_peaks[aid].add(s["peak_pos"])

        for i in range(len(performer_ids)):
            for j in range(i + 1, len(performer_ids)):
                collab_edges[performer_ids[i]].add(performer_ids[j])
                collab_edges[performer_ids[j]].add(performer_ids[i])

        songs_out.append({
            "id": song_id,
            "title": title,
            "raw_performer": performer_raw,
            "performer_ids": performer_ids,
            "debut_year": s["debut_year"],
            "peak_year": s["peak_year"],
            "peak_pos": s["peak_pos"],
            "wks_on_chart": s["wks_on_chart"],
        })

    artists_out = []
    for aid, name in artist_display.items():
        artists_out.append({
            "id": aid,
            "name": name,
            "song_ids": artist_songs[aid],
            "years": sorted(artist_years[aid]),
            "peaks": sorted(artist_peaks[aid]),
            "collaborator_ids": sorted(collab_edges[aid]),
        })

    with open(out_songs, "w", encoding="utf-8") as f:
        json.dump(songs_out, f, ensure_ascii=False)
    with open(out_artists, "w", encoding="utf-8") as f:
        json.dump(artists_out, f, ensure_ascii=False)

    flagged_unique = sorted(set(flagged))
    report = {
        "chart_week_rows": row_count,
        "unique_songs": len(songs_out),
        "unique_artists": len(artists_out),
        "protected_names_count": len(PROTECTED_NAMES),
        "flagged_performer_strings_count": len(flagged_unique),
        "flagged_performer_strings_sample": flagged_unique[:100],
    }
    with open(out_report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(json.dumps(report, indent=2), file=sys.stderr)


if __name__ == "__main__":
    main()
