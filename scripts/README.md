# Chart Ladder game data pipeline

Two scripts, run in order:

## 1. `wikidata_enrich.py` (run this locally -- needs real internet access)

```
pip install requests
python3 wikidata_enrich.py --csv "Billboard Hot 100 History - hot-100-current.csv"
```

Queries Wikidata (CC0-licensed data) in small batches for each unique performer
and song title in your CSV, pulling genre, record label, songwriter/composer,
producer, award, MusicBrainz ID, and band membership. Writes
`enriched_hot100.csv` (your original columns plus `wd_*` columns).

- Fully resumable: results are cached in `cache/*.json` as they come in, so if
  it's interrupted (network hiccup, you close the laptop) just re-run the same
  command and it picks up where it left off.
- Deliberately rate-limited (~1 request/sec, batches of 80 names) to stay
  within Wikidata's usage policy for anonymous use. A full run over ~11,275
  performers + ~27,000 titles will take a few hours -- let it run in the
  background.
- Not every performer/title will find a confident match -- the script prints
  a match-rate summary at the end. That's expected; Wikidata's coverage of
  minor chart entries is uneven. Rows that don't match just get blank `wd_*`
  fields and still work fine in step 2.

## 2. `connections_generator.py`

```
python3 connections_generator.py --csv enriched_hot100.csv --out connections.json
```

Turns the (enriched or raw) CSV into the game's connections dataset. Can also
be run directly against the original CSV (skip step 1) to get a CSV-only
version with same performer, collaboration graph, same title, same peak
position, chart longevity, shared title words, and one-hit-wonder flag --
no external dependency, works immediately.

**Output shape:** rather than every pair of connected songs (which would
explode into millions of combinations for prolific artists), each connection
type maps an attribute value to the list of song IDs sharing it. Songs are
stored once as a compact array -- a song's position in that array IS its ID,
referenced everywhere else as a small integer instead of a repeated string:

```json
{
  "song_fields": ["title", "performer", "peak_pos", "max_wks_on_chart"],
  "songs": [
    ["Perfect", "Ed Sheeran", 1, 34],
    ["Shape of You", "Ed Sheeran", 1, 40]
  ],
  "connections": {
    "same_writer": { "Ed Sheeran": [0, 1] },
    "same_label": { "Atlantic Records": [0, 1] }
  }
}
```

Look up a song by ID with `songs[id]`, and zip it against `song_fields` to
get a dict if your game code prefers that. This encoding is most of the
file-size win: on the full real dataset it took connections.json from
14.7MB (string keys) down to 2.7MB (int IDs), and 1.1MB gzipped -- serve the
`.gz` file, which the script writes automatically alongside the plain one.
Pass `--pretty` if you want indented, human-readable JSON for debugging
(much bigger, not for shipping). Only songs that appear in at least one
surviving connection group are kept in the array -- a song with zero shared
traits can't be used as a ladder rung anyway.

At game-build time: pick a connection type, pick a group with 2+ songs, pick
two songs from it as a ladder rung. The script prints a stats table (group
counts, average/max group size per connection type) so you can weight
category selection in the game -- e.g. down-weight `same_peak_position`
(huge, common groups) relative to `same_award` or `band_membership` (small,
distinctive groups) so the ladder doesn't lean on one connection type too
often.

Connection types produced when Wikidata data is present: `same_performer`,
`collaboration`, `same_title`, `same_peak_position`, `chart_longevity`,
`shared_title_word`, `one_hit_wonder_flag`, `same_artist_genre`,
`same_song_genre`, `same_label`, `same_writer`, `same_producer`,
`same_award`, `band_membership`, `same_artist_identity` (catches an act
charting under name variants via shared MusicBrainz ID).
