import { loadLocalDataset } from "../loadLocalDataset";
import {
  createEmptyBoard,
  hasWildRescueOption,
  placeStarterAndAnchor,
  relocateMultiplier,
  tileMatchesMultiplierType,
  wildGapPairing,
} from "../board";
import { GRID_SIZE } from "../types";
import { bestConnectionReason, connectionPoints } from "../moves";
import { isStarterPathConnectedToAnchor } from "../graph";
import { GameEngine } from "../engine";
import { buildDataIndex, findArtistCandidatesFor, findCollabCandidatesFor } from "../dataIndex";
import { decadePoints, tileValue } from "../tileValue";
import { getAllConnections } from "../connections";
import {
  GUIDED_CONNECTION_BONUS,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  GUIDED_TILE_POINTS,
  GuidedGameEngine,
  isSelfReferentialGuidedConnection,
} from "../guidedGame";
import {
  ArtistTile,
  SongTile,
  Dataset,
  ConnectionCategory,
  CONNECTION_CATEGORIES,
  ConnectionEdge,
  GameStatus,
  MultiplierType,
  WildcardTile,
  WILD_TILE_COST,
} from "../types";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
  }
}

function findArtist(dataset: Dataset, name: string): ArtistTile {
  const a = dataset.artists.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!a) throw new Error(`artist not found: ${name}`);
  return a;
}

function findSong(dataset: Dataset, title: string, performerSubstr: string): SongTile {
  const s = dataset.songs.find(
    (x) =>
      x.title.toLowerCase() === title.toLowerCase() &&
      x.performerIds.some((id) => {
        const a = dataset.artistById.get(id);
        return a && a.name.toLowerCase().includes(performerSubstr.toLowerCase());
      }),
  );
  if (!s) throw new Error(`song not found: ${title} / ${performerSubstr}`);
  return s;
}

interface ResolvedMove {
  legal: boolean;
  finalScore: number;
  connectionScore: number;
  tileValue: number;
  multiplierApplied?: MultiplierType;
  multiplierMissed?: MultiplierType;
  status: GameStatus;
  edge?: ConnectionEdge;
}

/**
 * Drives a full turn through the two-phase gap-placement API: placeTile()
 * followed by placeConnector() with the correct guess (read straight off
 * the edge legalMovesForRackTile() already surfaced - tests are allowed to
 * peek at the answer the way the real engine's own preview does; only the
 * player-facing UI keeps it hidden). No-ops the connector step for the
 * wildcard fast path, which resolves inside placeTile() itself.
 */
function resolveMove(
  engine: GameEngine,
  tileIndex: number,
  move: { row: number; col: number; edges: ConnectionEdge[] },
): ResolvedMove {
  const placeResult = engine.placeTile(tileIndex, move.row, move.col);
  if (!placeResult.legal) {
    return { legal: false, finalScore: 0, connectionScore: 0, tileValue: 0, status: placeResult.status };
  }
  if (placeResult.resolved) {
    return {
      legal: true,
      finalScore: placeResult.finalScore,
      connectionScore: placeResult.connectionScore,
      tileValue: placeResult.tileValue,
      multiplierApplied: placeResult.multiplierApplied,
      multiplierMissed: placeResult.multiplierMissed,
      status: placeResult.status,
      edge: placeResult.edge,
    };
  }
  const reason = move.edges[0].reason as ConnectionCategory;
  const connResult = engine.placeConnector(reason);
  return {
    legal: connResult.legal,
    finalScore: connResult.finalScore,
    connectionScore: connResult.connectionScore,
    tileValue: connResult.tileValue,
    multiplierApplied: connResult.multiplierApplied,
    multiplierMissed: connResult.multiplierMissed,
    status: connResult.status,
    edge: connResult.edge,
  };
}

const dataset = loadLocalDataset();
console.log(`Loaded ${dataset.songs.length} songs, ${dataset.artists.length} artists.\n`);

console.log("Mockup scenario checks:");
{
  const ladyGaga = findArtist(dataset, "Lady Gaga");
  const brunoMars = findArtist(dataset, "Bruno Mars");
  const markRonson = findArtist(dataset, "Mark Ronson");
  const kendrickLamar = findArtist(dataset, "Kendrick Lamar");
  const amyWinehouse = findArtist(dataset, "Amy Winehouse");
  const dieWithASmile = findSong(dataset, "Die With A Smile", "Lady Gaga");
  const uptownFunk = findSong(dataset, "Uptown Funk!", "Mark Ronson");
  const humble = findSong(dataset, "Humble.", "Kendrick Lamar");
  const cruelSummerTaylor = findSong(dataset, "Cruel Summer", "Taylor Swift");
  const cruelSummerBananarama = findSong(dataset, "Cruel Summer", "Bananarama");

  // ARTIST-ARTIST: two people who actually worked together -> COLLAB.
  check("Lady Gaga -> Bruno Mars is COLLAB", bestConnectionReason(ladyGaga, brunoMars) === "COLLAB");
  check("Bruno Mars -> Mark Ronson is COLLAB", bestConnectionReason(brunoMars, markRonson) === "COLLAB");

  // ARTIST-SONG: the artist performed on that song -> ARTIST, not COLLAB.
  check("Lady Gaga -> Die With A Smile is ARTIST", bestConnectionReason(ladyGaga, dieWithASmile) === "ARTIST");
  check("Bruno Mars -> Uptown Funk is ARTIST", bestConnectionReason(brunoMars, uptownFunk) === "ARTIST");
  check("Mark Ronson -> Uptown Funk is ARTIST", bestConnectionReason(markRonson, uptownFunk) === "ARTIST");
  check("Kendrick Lamar -> Humble. is ARTIST", bestConnectionReason(kendrickLamar, humble) === "ARTIST");

  check(
    "Two different Cruel Summer songs by unrelated performers do not COLLAB",
    bestConnectionReason(cruelSummerTaylor, cruelSummerBananarama) !== "COLLAB",
  );
  check(
    "Amy Winehouse never collaborated with Mark Ronson or performed on Uptown Funk",
    bestConnectionReason(amyWinehouse, uptownFunk) !== "COLLAB" &&
      bestConnectionReason(amyWinehouse, uptownFunk) !== "ARTIST",
  );

  const sameYearA: SongTile = {
    kind: "SONG",
    id: "same-year-a",
    title: "Same Year A",
    performerIds: ["same-year-artist-a"],
    peakYear: 1999,
    peakPos: 10,
    debutYear: 1999,
  };
  const sameYearB: SongTile = {
    kind: "SONG",
    id: "same-year-b",
    title: "Same Year B",
    performerIds: ["same-year-artist-b"],
    peakYear: 1999,
    peakPos: 20,
    debutYear: 1999,
  };
  const sameDecadeDifferentYear: SongTile = {
    kind: "SONG",
    id: "same-decade-different-year",
    title: "Same Decade, Different Year",
    performerIds: ["same-year-artist-c"],
    peakYear: 1994,
    peakPos: 30,
    debutYear: 1994,
  };
  check("Two unrelated tiles from the same exact year connect via SAME_YEAR", bestConnectionReason(sameYearA, sameYearB) === "SAME_YEAR");
  check("Two unrelated tiles in the same decade but different years do not connect", bestConnectionReason(sameYearA, sameDecadeDifferentYear) === null);
  check("Same Year connection keeps the former lowest-tier point value", connectionPoints("SAME_YEAR") === 5);
}

console.log("\nBridging (pure touching, independent of any real connection):");
{
  const board = createEmptyBoard();
  const starter = findArtist(dataset, "Lady Gaga");
  const anchor = findArtist(dataset, "Amy Winehouse");
  placeStarterAndAnchor(board, starter, anchor);

  check("Starter placed bottom-left", board[GRID_SIZE - 1][0].tile?.id === starter.id);
  check("Anchor placed top-right", board[0][GRID_SIZE - 1].tile?.id === anchor.id);
  check("Not yet bridged", !isStarterPathConnectedToAnchor(board));

  // isStarterPathConnectedToAnchor only cares about raw tile occupancy and
  // orthogonal touching - not whether the pair scores a connection, and not
  // whether any gap was ever filled by a real connector tile. Prove that
  // directly by hand-placing tiles, bypassing the engine's placement rules.
  const dieWithASmile = findSong(dataset, "Die With A Smile", "Lady Gaga");
  board[GRID_SIZE - 1][1].tile = dieWithASmile;
  check("Still not bridged (chain incomplete)", !isStarterPathConnectedToAnchor(board));

  // Carve a full path of *unrelated* tiles from STARTER to END_ANCHOR - none
  // of them match their neighbors at all, only touch. This is the exact
  // scenario the bridge rule targets: "even if there's no real connection
  // between some of the tiles."
  const pathBoard = createEmptyBoard();
  placeStarterAndAnchor(pathBoard, starter, anchor);
  const filler = dataset.songs
    .filter((s) => s.id !== dieWithASmile.id)
    .slice(0, GRID_SIZE - 2 + GRID_SIZE - 1); // enough unrelated songs to fill an L-shaped path
  let fillerIdx = 0;
  for (let row = GRID_SIZE - 2; row >= 0; row--) {
    pathBoard[row][0].tile = filler[fillerIdx++];
  }
  for (let col = 1; col < GRID_SIZE - 1; col++) {
    pathBoard[0][col].tile = filler[fillerIdx++];
  }
  check(
    "Unrelated, non-matching tiles still bridge STARTER to END_ANCHOR by touching alone",
    isStarterPathConnectedToAnchor(pathBoard),
  );
}

console.log("\ngetAllConnections reads placed connector tiles:");
{
  const board = createEmptyBoard();
  const starter = findArtist(dataset, "Lady Gaga");
  const brunoMars = findArtist(dataset, "Bruno Mars");
  const anchor = findArtist(dataset, "Amy Winehouse");
  placeStarterAndAnchor(board, starter, anchor);

  check("No connections on a freshly-set-up board", getAllConnections(board).length === 0);

  // Hand-build the exact shape a real gap-placement + correct connector
  // guess leaves behind: a content tile two cells from STARTER, and a
  // connector tile filling the gap cell between them.
  check(
    "Bruno Mars two cells from Lady Gaga is a COLLAB match",
    bestConnectionReason(starter, brunoMars) === "COLLAB",
  );
  board[GRID_SIZE - 1][2].tile = brunoMars; // anchor, 2 cells right of STARTER
  board[GRID_SIZE - 1][1].tile = {
    kind: "CONNECTOR",
    id: "test-connector",
    connectionType: "COLLAB",
    contentRow: GRID_SIZE - 1,
    contentCol: 0,
    anchorRow: GRID_SIZE - 1,
    anchorCol: 2,
  };

  // A third, unrelated tile also touching the connector cell (e.g. placed
  // by a completely different move later in the game) must not confuse
  // which pair the connector actually links - this is exactly the bug
  // where a crowded board could report the wrong two tiles for a
  // correctly-validated connection.
  const unrelated = findArtist(dataset, "Dolly Parton");
  board[GRID_SIZE - 2][1].tile = unrelated;

  const connections = getAllConnections(board);
  check("getAllConnections finds exactly the one connector-linked pair", connections.length === 1);
  check("The connection's reason matches the connector's type", connections[0]?.reason === "COLLAB");
  check("The connection is worth the COLLAB point value", connections[0]?.points === connectionPoints("COLLAB"));
  const tileIds = connections.length
    ? new Set([connections[0].tileA.id, connections[0].tileB.id])
    : new Set<string>();
  check(
    "The crowding third tile is not mistaken for one side of the connection",
    !tileIds.has(unrelated.id),
  );
  check(
    "The connection references STARTER and Bruno Mars, not the connector itself",
    tileIds.has(starter.id) && tileIds.has(brunoMars.id) && !tileIds.has("test-connector"),
  );
}

console.log("\nGameEngine integration:");
{
  const engine = new GameEngine(dataset, 45, 12345);
  const state = engine.getState();
  check("Rack has 5 tiles at start", state.rack.length === 5);
  check("Starter tile present", !!state.board[GRID_SIZE - 1][0].tile);
  check("Anchor tile present", !!state.board[0][GRID_SIZE - 1].tile);
  check("No connector pending at start", state.pendingConnector === null);

  const illegal = engine.placeTile(0, 4, 4); // middle of empty board, nothing two cells away yet
  check("Placing in the empty middle of the board is illegal", illegal.legal === false);

  // Try every non-wildcard rack tile against every legal move surfaced by
  // the engine itself; if any exist, placing + correctly guessing its
  // connector should succeed and score > 0 (wildcards always score 0, so
  // they're excluded from this check and covered separately below).
  let placedOk = false;
  for (let i = 0; i < engine.getState().rack.length && !placedOk; i++) {
    if (engine.getState().rack[i].kind === "WILDCARD") continue;
    const moves = engine.legalMovesForRackTile(i);
    if (moves.length > 0) {
      const result = resolveMove(engine, i, moves[0]);
      check(`Legal move for rack tile ${i} succeeds`, result.legal === true);
      check(`Legal move scores > 0`, result.finalScore > 0);
      placedOk = true;
    }
  }
  check("At least one legal move was available and played from the starting rack", placedOk);
  check("Rack refilled back to 5 after a placement", engine.getState().rack.length === 5);
  check("No connector left pending after resolving correctly", engine.getState().pendingConnector === null);
}

console.log("\nGap-placement + connector guessing:");
{
  const engine = new GameEngine(dataset, 46, 999);
  let tested = false;
  for (let i = 0; i < engine.getState().rack.length && !tested; i++) {
    if (engine.getState().rack[i].kind === "WILDCARD") continue;
    const moves = engine.legalMovesForRackTile(i);
    if (moves.length === 0) continue;
    const move = moves[0];
    const required = move.edges[0].reason as ConnectionCategory;
    const wrongGuess = (["COLLAB", "ARTIST", "SAME_YEAR"] as ConnectionCategory[]).find((c) => c !== required)!;

    const placeResult = engine.placeTile(i, move.row, move.col);
    check("Placing a tile two cells from a matching anchor is legal", placeResult.legal === true);
    check("A real connection type leaves the placement unresolved", placeResult.resolved === false);
    check("pendingConnector is now set", engine.getState().pendingConnector !== null);
    check("Rack is not refilled while a connector is pending", engine.getState().rack.length === 4);

    const scoreBeforeGuess = engine.getState().score;
    const wrong = engine.placeConnector(wrongGuess);
    check("A wrong connector guess is still a legal call", wrong.legal === true);
    check("A wrong guess is reported as incorrect", wrong.correct === false);
    check("A wrong guess costs exactly the wrong-connector penalty", wrong.pointsDelta === -2);
    check(
      "A wrong guess docks the score by exactly 2",
      engine.getState().score === scoreBeforeGuess - 2,
    );
    check("The pending connector stays open after a wrong guess", engine.getState().pendingConnector !== null);
    check("The rack is still not refilled after a wrong guess", engine.getState().rack.length === 4);

    const scoreBeforeRetry = engine.getState().score;
    const correct = engine.placeConnector(required);
    check("Retrying with the correct type succeeds", correct.legal === true);
    check("The correct guess is reported as correct", correct.correct === true);
    check("The correct guess scores > 0", correct.finalScore > 0);
    check(
      "The score increases by exactly the correct guess's finalScore",
      engine.getState().score === scoreBeforeRetry + correct.finalScore,
    );
    check("pendingConnector clears once resolved", engine.getState().pendingConnector === null);
    check("The rack refills back to 5 once resolved", engine.getState().rack.length === 5);

    tested = true;
  }
  check("Found a rack tile with a real (non-wildcard) connection to test guessing against", tested);
}

console.log("\nWildcard tile checks:");
{
  const wildcard: WildcardTile = { kind: "WILDCARD", id: "wild-test" };
  const brunoMars = findArtist(dataset, "Bruno Mars");
  const uptownFunk = findSong(dataset, "Uptown Funk!", "Mark Ronson");

  // A placed wildcard tile is inert for bestConnectionReason() - it must
  // never act as a free anchor for a *new* placement, or a single bought
  // charge could chain into unlimited free connections instead of being
  // spent once per purchase.
  check("A wildcard tile never matches an artist via bestConnectionReason", bestConnectionReason(wildcard, brunoMars) === null);
  check("A wildcard tile never matches a song via bestConnectionReason", bestConnectionReason(uptownFunk, wildcard) === null);
  check("Wildcard connection is worth 0 points", connectionPoints("WILDCARD") === 0);
  check("Wildcard never triggers a multiplier", !tileMatchesMultiplierType(wildcard, "2X_SONG"));
  check(
    "Wildcard never triggers CHART_BOOST either",
    !tileMatchesMultiplierType(wildcard, "CHART_BOOST"),
  );

  // Wildcards are only ever obtainable via buyWildcard() now - never drawn
  // into the rack as a placeable content tile.
  let sawWildcardInRack = false;
  for (let seed = 0; seed < 500; seed++) {
    const candidate = new GameEngine(dataset, 1, seed);
    if (candidate.getState().rack.some((t) => t.kind === "WILDCARD")) {
      sawWildcardInRack = true;
      break;
    }
  }
  check("No wildcard ever appears in a starting rack across 500 seeds", !sawWildcardInRack);

  // Buy a wild connector, get into a pending guess, and spend it instead of
  // guessing - it should always succeed, score 0 connection points, and
  // fill the gap with a wildcard tile.
  const engine = new GameEngine(dataset, 47, 555);
  let guard = 0;
  while (engine.getState().score < WILD_TILE_COST && engine.getState().status === "playing" && guard++ < 200) {
    const rack = engine.getState().rack;
    for (let i = 0; i < rack.length; i++) {
      const moves = engine.legalMovesForRackTile(i);
      if (moves.length > 0) {
        resolveMove(engine, i, moves[0]);
        break;
      }
    }
  }

  if (engine.getState().status === "playing" && engine.getState().score >= WILD_TILE_COST) {
    const purchase = engine.buyWildcard();
    check("Buying a wild connector succeeds when affordable", purchase.success === true);
    check("wildcardConnectors increments by one", engine.getState().wildcardConnectors === 1);
    check("Rack size is unaffected by buying a wild connector", engine.getState().rack.length === 5);

    const rack = engine.getState().rack;
    let placed = false;
    for (let i = 0; i < rack.length && !placed; i++) {
      const moves = engine.legalMovesForRackTile(i);
      if (moves.length === 0) continue;
      const placeResult = engine.placeTile(i, moves[0].row, moves[0].col);
      if (!placeResult.legal || placeResult.resolved || !placeResult.pendingConnector) continue; // only care about a real pending guess
      placed = true;
      const { gapRow, gapCol, anchorRow, anchorCol } = placeResult.pendingConnector;

      const scoreBefore = engine.getState().score;
      const wildResult = engine.useWildcardConnector();
      check("useWildcardConnector succeeds when a connector is pending and charges are available", wildResult.legal === true);
      check("useWildcardConnector is always reported as correct", wildResult.correct === true);
      check("useWildcardConnector scores 0 connection points", wildResult.connectionScore === 0);
      check("useWildcardConnector still awards the tile's own value", wildResult.finalScore === wildResult.tileValue);
      check(
        "Score increases by exactly the wild connector's finalScore",
        engine.getState().score === scoreBefore + wildResult.finalScore,
      );
      check("wildcardConnectors decrements back to 0", engine.getState().wildcardConnectors === 0);
      check("pendingConnector clears after using a wild connector", engine.getState().pendingConnector === null);
      check(
        "The gap cell is filled with a WILDCARD-kind tile",
        engine.getState().board[gapRow][gapCol].tile?.kind === "WILDCARD",
      );

      const again = engine.useWildcardConnector();
      check("useWildcardConnector fails once out of charges", again.legal === false);

      // The used-up wild connector must not become a free anchor for a
      // *new* placement - the cell two steps beyond it (continuing the same
      // direction) must never auto-resolve off the wildcard.
      const dr = Math.sign(gapRow - anchorRow);
      const dc = Math.sign(gapCol - anchorCol);
      const beyondRow = gapRow + dr;
      const beyondCol = gapCol + dc;
      if (
        beyondRow >= 0 && beyondRow < GRID_SIZE && beyondCol >= 0 && beyondCol < GRID_SIZE &&
        !engine.getState().board[beyondRow][beyondCol].tile
      ) {
        const otherIdx = engine.getState().rack.findIndex((t) => t.kind !== "WILDCARD");
        if (otherIdx !== -1) {
          const chainAttempt = engine.placeTile(otherIdx, beyondRow, beyondCol);
          check(
            "Placing beyond a spent wild connector never auto-resolves through it for free",
            !chainAttempt.legal || chainAttempt.resolved === false,
          );
          if (chainAttempt.legal && chainAttempt.pendingConnector) {
            check(
              "If it happened to be legal via a different anchor, that anchor isn't the wildcard cell",
              !(chainAttempt.pendingConnector.anchorRow === gapRow && chainAttempt.pendingConnector.anchorCol === gapCol),
            );
          }
        }
      }
    }
    check("Found a real (non-wildcard) pending connector to spend the charge on", placed);
  } else {
    check("Reached enough score to buy a wild connector within 200 moves", false);
  }
}

console.log("\nWild rescue checks:");
{
  // Direct geometry checks against a hand-built board, independent of the
  // engine. STARTER alone already has empty neighbors with empty space
  // beyond them, so a rescue gap exists from the very first cell.
  const board = createEmptyBoard();
  const starter = findArtist(dataset, "Lady Gaga");
  const anchor = findArtist(dataset, "Amy Winehouse");
  placeStarterAndAnchor(board, starter, anchor);

  const pairing = wildGapPairing(board, GRID_SIZE - 1, 1); // one cell right of STARTER
  check("wildGapPairing finds a gap next to STARTER with empty space beyond it", pairing !== null);
  check("The pairing's anchor is STARTER", pairing?.anchor.tile?.id === starter.id);
  check(
    "The pairing's content cell is the empty cell on the far side of the gap",
    pairing?.content.row === GRID_SIZE - 1 && pairing?.content.col === 2,
  );
  check("hasWildRescueOption is true as soon as any tile has room beside it", hasWildRescueOption(board));
  check("An already-occupied cell (STARTER's own) can't be a gap", wildGapPairing(board, GRID_SIZE - 1, 0) === null);
  check("A cell with no adjacent placed tile at all can't be a gap", wildGapPairing(board, 3, 3) === null);

  // Occupy the content cell from that specific pairing - the same gap tap
  // should now fail in that direction (though STARTER still has other
  // valid directions, which is fine; this only checks the one spot).
  const filler = findSong(dataset, "Die With A Smile", "Lady Gaga");
  board[GRID_SIZE - 1][2].tile = filler;
  check(
    "That exact gap/direction fails once its content cell is occupied",
    wildGapPairing(board, GRID_SIZE - 1, 1) === null,
  );

  // Engine-level: force a stuck-but-rescuable state by buying a wild
  // connector, then greedily playing real moves until none remain. Try
  // several seeds since not every game runs out of real moves within a
  // bounded number of turns.
  let rescued = false;
  for (let seed = 0; seed < 30 && !rescued; seed++) {
    const engine = new GameEngine(dataset, 49, seed);
    let guard = 0;

    // Buy a wild connector as soon as affordable, once, then keep playing.
    let bought = false;
    while (engine.getState().status === "playing" && guard++ < 300) {
      if (!bought && engine.getState().score >= WILD_TILE_COST) {
        engine.buyWildcard();
        bought = true;
      }
      if (!engine.hasAnyLegalMove()) break; // either stuck-with-rescue or truly stuck
      const rack = engine.getState().rack;
      let played = false;
      for (let i = 0; i < rack.length; i++) {
        const moves = engine.legalMovesForRackTile(i);
        if (moves.length > 0) {
          resolveMove(engine, i, moves[0]);
          played = true;
          break;
        }
      }
      if (!played) break;
    }

    if (
      bought &&
      engine.getState().status === "playing" &&
      !engine.hasAnyLegalMove() &&
      engine.getState().wildcardConnectors > 0
    ) {
      check(
        `Seed ${seed}: status stays "playing" when stuck but a wild rescue is available`,
        engine.getState().status === "playing",
      );
      const gapCells = engine.legalWildRescueGapCells();
      check(`Seed ${seed}: at least one rescue gap cell is available`, gapCells.length > 0);
      check(
        `Seed ${seed}: awaitingStuckDecision is false once buying a wild connector opens up a rescue`,
        engine.getState().awaitingStuckDecision === false,
      );
      if (gapCells.length === 0) continue;

      const rackBefore = engine.getState().rack.length;
      const wildBefore = engine.getState().wildcardConnectors;
      const scoreBefore = engine.getState().score;
      const gap = gapCells[0];

      const wrongOrder = engine.completeWildRescue(0);
      check(`Seed ${seed}: completeWildRescue fails with no pending rescue`, wrongOrder.legal === false);

      const withMoves = engine.hasAnyLegalMove();
      check(`Seed ${seed}: confirmed no legal move exists before starting the rescue`, !withMoves);

      const started = engine.startWildRescue(gap.row, gap.col);
      check(`Seed ${seed}: startWildRescue succeeds on a valid gap cell`, started.legal === true);
      check(`Seed ${seed}: wildcardConnectors decrements by one`, engine.getState().wildcardConnectors === wildBefore - 1);
      check(`Seed ${seed}: the gap cell is now filled with a WILDCARD-kind tile`, engine.getState().board[gap.row][gap.col].tile?.kind === "WILDCARD");
      check(`Seed ${seed}: pendingWildRescue is now set`, engine.getState().pendingWildRescue !== null);
      check(`Seed ${seed}: rack is untouched until the rescue completes`, engine.getState().rack.length === rackBefore);

      const again = engine.startWildRescue(gap.row, gap.col);
      check(`Seed ${seed}: a second startWildRescue is rejected while one is already pending`, again.legal === false);

      const blockedPlace = engine.placeTile(0, 0, 0);
      check(`Seed ${seed}: placeTile is rejected while a rescue is pending`, blockedPlace.legal === false);

      const pending = engine.getState().pendingWildRescue!;
      const done = engine.completeWildRescue(0);
      check(`Seed ${seed}: completeWildRescue succeeds with a valid rack index`, done.legal === true);
      check(`Seed ${seed}: pendingWildRescue clears once resolved`, engine.getState().pendingWildRescue === null);
      check(`Seed ${seed}: the content cell now holds the chosen rack tile`, !!engine.getState().board[pending.contentRow][pending.contentCol].tile);
      // The rescue itself always scores 0 - but completing it can leave the
      // board/rack in a state with no more legal moves and no more wild
      // charges, ending the game right there. That end-game penalty is a
      // separate, expected score change, not a rescue payout.
      if (engine.getState().status === "playing") {
        check(`Seed ${seed}: a rescue placement scores nothing while the game continues`, engine.getState().score === scoreBefore);
      } else {
        check(
          `Seed ${seed}: if completing the rescue ended the game, the score only reflects the end-game penalty`,
          engine.getState().score === scoreBefore - engine.getState().penaltyApplied,
        );
      }
      check(`Seed ${seed}: rack refills back to size after the rescue`, engine.getState().rack.length === Math.min(5, rackBefore - 1 + 1));

      rescued = true;
    }
  }
  check("Found a seed where a wild rescue could be exercised end-to-end within 30 tries", rescued);
}

console.log("\nStuck decision checks:");
{
  const fresh = new GameEngine(dataset, 50, 1);
  check("A fresh game is not awaiting a stuck decision", fresh.getState().awaitingStuckDecision === false);

  const earlyEnd = fresh.endStuckGame();
  check("endStuckGame() fails while a real move is still available", earlyEnd.legal === false);
  check("A rejected endStuckGame() leaves the game playing", fresh.getState().status === "playing");

  // Play greedily (never buying a wild connector) until genuinely stuck -
  // with wildcardConnectors at 0 throughout, awaitingStuckDecision should
  // flip on exactly when hasAnyLegalMove() does, and the game must NOT end
  // itself; it should just sit there until endStuckGame() is called.
  let foundStuck = false;
  for (let seed = 0; seed < 15 && !foundStuck; seed++) {
    const engine = new GameEngine(dataset, 51, seed);
    let guard = 0;
    while (engine.getState().status === "playing" && engine.hasAnyLegalMove() && guard++ < 200) {
      const rack = engine.getState().rack;
      for (let i = 0; i < rack.length; i++) {
        const moves = engine.legalMovesForRackTile(i);
        if (moves.length > 0) {
          resolveMove(engine, i, moves[0]);
          break;
        }
      }
    }

    if (engine.getState().status === "playing" && !engine.hasAnyLegalMove()) {
      foundStuck = true;
      check("wildcardConnectors is 0 - this loop never bought one", engine.getState().wildcardConnectors === 0);
      check("awaitingStuckDecision is true once out of moves with no rescue available", engine.getState().awaitingStuckDecision === true);
      check("The game does not end itself just for running out of moves", engine.getState().status === "playing");

      const scoreBefore = engine.getState().score;
      const expectedPenalty = engine.getState().rack.reduce((sum, t) => sum + tileValue(t), 0);

      const result = engine.endStuckGame();
      check("endStuckGame() succeeds once truly stuck with no rescue", result.legal === true);
      check("Status transitions to stuck", engine.getState().status === "stuck");
      check(
        "penaltyApplied matches the value of the tiles left in the rack",
        engine.getState().penaltyApplied === expectedPenalty,
      );
      check(
        "Score drops by exactly the penalty",
        engine.getState().score === scoreBefore - engine.getState().penaltyApplied,
      );
      check("awaitingStuckDecision is false once the game is over", engine.getState().awaitingStuckDecision === false);

      const again = engine.endStuckGame();
      check("endStuckGame() fails once the game is already over", again.legal === false);
    }
  }
  check("Found a seed that genuinely ran out of moves within 15 tries", foundStuck);
}

console.log("\nMultiplier relocation checks:");
{
  // A connector/wild tile can never benefit from a multiplier, so
  // relocateMultiplier() should move the bonus elsewhere rather than waste
  // it whenever a connector fills a cell that had one.
  const board = createEmptyBoard();
  const starter = findArtist(dataset, "Lady Gaga");
  const anchor = findArtist(dataset, "Amy Winehouse");
  placeStarterAndAnchor(board, starter, anchor);
  const cell = board[3][3];
  cell.multiplier = "3X_SONG";

  const rng = () => 0; // deterministic - always picks the first eligible cell
  relocateMultiplier(board, rng, cell);
  check("The original cell's multiplier is cleared", cell.multiplier === undefined);
  const relocated = board.some(
    (row) => row.some((c) => c !== cell && c.multiplier === "3X_SONG"),
  );
  check("The multiplier reappears on exactly one other cell", relocated);
  const totalMultiplierCells = board.flat().filter((c) => c.multiplier).length;
  check("Exactly one cell on the board still has a multiplier", totalMultiplierCells === 1);

  const untouched = createEmptyBoard();
  placeStarterAndAnchor(untouched, starter, anchor);
  relocateMultiplier(untouched, rng, untouched[2][2]);
  check("Relocating a cell with no multiplier is a no-op", untouched.flat().every((c) => !c.multiplier));

  // End-to-end through the real engine: force a multiplier onto the gap
  // cell of an in-progress pending connector, resolve it, and confirm the
  // bonus moved rather than vanished.
  let relocationTested = false;
  for (let seed = 0; seed < 50 && !relocationTested; seed++) {
    const attempt = new GameEngine(dataset, 48, seed);
    const rack = attempt.getState().rack;
    for (let i = 0; i < rack.length && !relocationTested; i++) {
      const moves = attempt.legalMovesForRackTile(i);
      if (moves.length === 0) continue;
      const move = moves[0];
      const placeResult = attempt.placeTile(i, move.row, move.col);
      if (!placeResult.legal || placeResult.resolved || !placeResult.pendingConnector) continue;

      const { gapRow, gapCol, contentRow, contentCol } = placeResult.pendingConnector;
      const gapCellBefore = attempt.getState().board[gapRow][gapCol];
      // Force a multiplier onto the gap cell directly to exercise the path
      // deterministically, regardless of what scatterMultipliers rolled.
      gapCellBefore.multiplier = "CHART_BOOST";
      const before = attempt.getState().board.flat().filter((c) => c.multiplier).length;

      const required = move.edges[0].reason as ConnectionCategory;
      const connResult = attempt.placeConnector(required);
      relocationTested = true;

      check("The resolved connector placement was legal and correct", connResult.legal && connResult.correct);
      const gapCellAfter = attempt.getState().board[gapRow][gapCol];
      check("The gap cell no longer carries the multiplier once occupied", gapCellAfter.multiplier === undefined);
      const after = attempt.getState().board.flat().filter((c) => c.multiplier).length;
      check("The total number of multiplier cells on the board is unchanged", after === before);
      check(
        "The content tile's own cell is untouched by relocation",
        attempt.getState().board[contentRow][contentCol].tile !== undefined,
      );
    }
  }
  check("Found a real pending connector to verify multiplier relocation end-to-end", relocationTested);
}

console.log("\nTile value (decade points) checks:");
{
  check("2020s decade is worth 1 point", decadePoints(2023) === 1);
  check("2010s decade is worth 2 points", decadePoints(2015) === 2);
  check("2000s decade is worth 3 points", decadePoints(2004) === 3);
  check("1950s decade is worth 8 points", decadePoints(1958) === 8);

  const songSameDecade: SongTile = {
    kind: "SONG",
    id: "test-song-1",
    title: "T",
    performerIds: [],
    debutYear: 2014,
    peakYear: 2015,
    peakPos: 1,
  };
  check("Song within a single decade uses that decade's points", tileValue(songSameDecade) === 2);

  const songCrossesDecades: SongTile = {
    kind: "SONG",
    id: "test-song-2",
    title: "T",
    performerIds: [],
    debutYear: 2009,
    peakYear: 2020,
    peakPos: 1,
  };
  check(
    "Song crossing decades takes the lower (more recent) point value",
    tileValue(songCrossesDecades) === 1,
  );

  const artistMultiDecade: ArtistTile = {
    kind: "ARTIST",
    id: "test-artist-1",
    name: "A",
    years: [1985, 1999, 2021],
    peaks: [],
    collaboratorIds: [],
    songIds: [],
  };
  check(
    "Artist spanning decades takes the lowest (most recent) point value",
    tileValue(artistMultiDecade) === 1,
  );

  const wildcardForValue: WildcardTile = { kind: "WILDCARD", id: "wild-value-test" };
  check("Wildcard has 0 tile value", tileValue(wildcardForValue) === 0);
}

console.log("\nTile value wired into engine scoring:");
{
  const engine = new GameEngine(dataset, 2, 777);
  let placed = false;
  for (let i = 0; i < engine.getState().rack.length && !placed; i++) {
    const moves = engine.legalMovesForRackTile(i);
    if (moves.length > 0) {
      const before = engine.getState().score;
      const result = resolveMove(engine, i, moves[0]);
      check("finalScore equals connectionScore + tileValue", result.finalScore === result.connectionScore + result.tileValue);
      check("Total score increases by exactly finalScore", engine.getState().score === before + result.finalScore);
      placed = true;
    }
  }
  check("Found a move to verify tile-value scoring wiring", placed);
}

console.log("\nRack draw candidate index checks:");
{
  const index = buildDataIndex(dataset);
  const ladyGaga = findArtist(dataset, "Lady Gaga");
  const brunoMars = findArtist(dataset, "Bruno Mars");
  const dieWithASmile = findSong(dataset, "Die With A Smile", "Lady Gaga");

  const collabForArtist = findCollabCandidatesFor(ladyGaga, dataset);
  check("findCollabCandidatesFor(Lady Gaga) includes Bruno Mars", collabForArtist.some((t) => t.id === brunoMars.id));
  check("findCollabCandidatesFor never returns candidates for a SONG tile", findCollabCandidatesFor(dieWithASmile, dataset).length === 0);

  const artistForSong = [...findArtistCandidatesFor(dieWithASmile, dataset, index)];
  check("findArtistCandidatesFor(Die With A Smile) includes Lady Gaga", artistForSong.some((t) => t.id === ladyGaga.id));
  check("findArtistCandidatesFor(Die With A Smile) includes Bruno Mars", artistForSong.some((t) => t.id === brunoMars.id));
  check("findArtistCandidatesFor(Die With A Smile) doesn't include the song itself", !artistForSong.some((t) => t.id === dieWithASmile.id));

  const artistForArtist = [...findArtistCandidatesFor(ladyGaga, dataset, index)];
  check("findArtistCandidatesFor(Lady Gaga) includes Die With A Smile", artistForArtist.some((t) => t.id === dieWithASmile.id));
}

console.log("\nRack draw bias checks:");
{
  // The starting rack is drawn entirely against the same two-tile board
  // (STARTER + END_ANCHOR only) for every seed, so it's a clean, consistent
  // sample to check drawTile()'s COLLAB_DRAW_CHANCE/ARTIST_DRAW_CHANCE
  // split against - independently recomputed here via the same exported
  // candidate functions the engine itself uses.
  const index = buildDataIndex(dataset);
  let collabHits = 0;
  let artistHits = 0;
  let total = 0;

  for (let seed = 0; seed < 400; seed++) {
    const engine = new GameEngine(dataset, 1, seed);
    const state = engine.getState();
    const placed = [state.board[GRID_SIZE - 1][0].tile!, state.board[0][GRID_SIZE - 1].tile!];

    const collabIds = new Set<string>();
    const artistIds = new Set<string>();
    for (const p of placed) {
      for (const c of findCollabCandidatesFor(p, dataset)) collabIds.add(c.id);
      for (const c of findArtistCandidatesFor(p, dataset, index)) artistIds.add(c.id);
    }

    for (const tile of state.rack) {
      total++;
      if (collabIds.has(tile.id)) collabHits++;
      else if (artistIds.has(tile.id)) artistHits++;
    }
  }

  const collabRate = collabHits / total;
  const artistRate = artistHits / total;
  console.log(
    `  (info) of ${total} starting-rack draws: ${(collabRate * 100).toFixed(1)}% landed in the collab pool, ${(artistRate * 100).toFixed(1)}% in the artist pool`,
  );
  check("Collab-pool draw rate is roughly the intended 10% (within [3%, 20%])", collabRate >= 0.03 && collabRate <= 0.2);
  check("Artist-pool draw rate is roughly the intended 30% (within [20%, 42%])", artistRate >= 0.2 && artistRate <= 0.42);
  check("At least some draws land in the collab pool", collabHits > 0);
  check("At least some draws land in the artist pool", artistHits > 0);
}

console.log("\nGame-ending status checks:");
{
  let bridgedCount = 0;
  let stuckCount = 0;

  for (let seed = 0; seed < 15; seed++) {
    const engine = new GameEngine(dataset, 3, seed);
    let guard = 0;
    let lastResult: ResolvedMove | null = null;
    let scoreBeforeLastMove = engine.getState().score;
    while (engine.getState().status === "playing" && guard++ < 200) {
      const rack = engine.getState().rack;
      let played = false;
      for (let i = 0; i < rack.length; i++) {
        const moves = engine.legalMovesForRackTile(i);
        if (moves.length > 0) {
          scoreBeforeLastMove = engine.getState().score;
          lastResult = resolveMove(engine, i, moves[0]);
          played = true;
          break;
        }
      }
      if (!played) {
        // No rack tile has a legal move anymore - the game no longer ends
        // itself here, so give up explicitly rather than buy more wild
        // connectors indefinitely (this loop never buys any, so
        // endStuckGame() should always be legal once truly stuck).
        const gaveUp = engine.endStuckGame();
        if (!gaveUp.legal) break; // a wild rescue is still available - leave this seed "playing"
      }
    }

    const finalState = engine.getState();
    const expectedPenalty = finalState.rack.reduce((sum, t) => sum + tileValue(t), 0);

    if (finalState.status === "bridged" || finalState.status === "stuck") {
      const label = finalState.status;
      if (label === "bridged") {
        bridgedCount++;
        check(
          `Seed ${seed}: bridged status matches pure-adjacency connectivity`,
          isStarterPathConnectedToAnchor(finalState.board),
        );
      } else {
        stuckCount++;
        check(`Seed ${seed}: stuck status matches hasAnyLegalMove()`, !engine.hasAnyLegalMove());
      }
      check(
        `Seed ${seed}: penaltyApplied equals the tile value of everything left in the rack`,
        finalState.penaltyApplied === expectedPenalty,
      );
      if (lastResult) {
        check(
          `Seed ${seed}: final score reflects the last move's points minus the penalty`,
          finalState.score === scoreBeforeLastMove + lastResult.finalScore - finalState.penaltyApplied,
        );
      }
      const blocked = engine.placeTile(0, 0, 0);
      check(
        `Seed ${seed}: further placement rejected once ${label}`,
        blocked.legal === false && blocked.status === label,
      );
    }
  }

  console.log(`  (info) of 15 seeds: ${bridgedCount} bridged, ${stuckCount} stuck, ${15 - bridgedCount - stuckCount} still playing after 200 moves`);
  check("At least one game reached a terminal state across 15 seeds", bridgedCount + stuckCount > 0);
}

console.log("\nBuy wildcard checks:");
{
  // A fresh game starts at score 0, so buying should fail until enough
  // points are earned from real placements.
  const engine = new GameEngine(dataset, 4, 42);
  const zero = engine.buyWildcard();
  check("Cannot buy a wildcard at 0 points", zero.success === false);
  check("Failed purchase leaves score untouched", engine.getState().score === 0);
  check("Failed purchase leaves rack size untouched", engine.getState().rack.length === 5);

  // Play real moves (greedy first-legal-move) until there's enough score to
  // afford one, or the game ends first.
  let guard = 0;
  while (
    engine.getState().score < WILD_TILE_COST &&
    engine.getState().status === "playing" &&
    guard++ < 200
  ) {
    const rack = engine.getState().rack;
    let played = false;
    for (let i = 0; i < rack.length; i++) {
      const moves = engine.legalMovesForRackTile(i);
      if (moves.length > 0) {
        resolveMove(engine, i, moves[0]);
        played = true;
        break;
      }
    }
    if (!played) break;
  }

  if (engine.getState().status === "playing" && engine.getState().score >= WILD_TILE_COST) {
    const scoreBefore = engine.getState().score;
    const rackSizeBefore = engine.getState().rack.length;
    const wildcardsBefore = engine.getState().wildcardConnectors;
    const result = engine.buyWildcard();
    check("Purchase succeeds when affordable", result.success === true);
    check("Purchase costs exactly WILD_TILE_COST", result.cost === WILD_TILE_COST);
    check("Score drops by exactly WILD_TILE_COST", engine.getState().score === scoreBefore - WILD_TILE_COST);
    check("scoreAfter matches the new score", result.scoreAfter === engine.getState().score);
    check("Rack size is unaffected by a purchase", engine.getState().rack.length === rackSizeBefore);
    check("wildcardConnectors increments by exactly one", engine.getState().wildcardConnectors === wildcardsBefore + 1);
  } else {
    check("Reached enough score to test a successful purchase within 200 moves", false);
  }
}

console.log("\nBuy wildcard blocked once game is over:");
{
  // Reuse a seed already known (from the game-ending checks above) to end
  // via bridging.
  const engine = new GameEngine(dataset, 3, 0);
  let guard = 0;
  while (engine.getState().status === "playing" && guard++ < 200) {
    const rack = engine.getState().rack;
    let played = false;
    for (let i = 0; i < rack.length; i++) {
      const moves = engine.legalMovesForRackTile(i);
      if (moves.length > 0) {
        resolveMove(engine, i, moves[0]);
        played = true;
        break;
      }
    }
    if (!played) {
      const gaveUp = engine.endStuckGame();
      if (!gaveUp.legal) break;
    }
  }
  check("Game reached a terminal state to test purchase blocking", engine.getState().status !== "playing");
  const blocked = engine.buyWildcard();
  check("Purchase rejected once the game is over", blocked.success === false);
}

console.log("\nMultiplier applied/missed reporting checks:");
{
  // Sweep many seeds, greedily playing whatever move each rack tile finds
  // first, and inspect every placement that landed on a bonus cell.
  // Confirms multiplierApplied/multiplierMissed are mutually exclusive,
  // correctly reflect whether the bonus cell's type matched the tile, and
  // that the score math (connectionScore vs the edge's raw points) agrees
  // with which one fired.
  let sawApplied = false;
  let sawMissed = false;
  for (let seed = 0; seed < 60 && (!sawApplied || !sawMissed); seed++) {
    const engine = new GameEngine(dataset, 5, seed);
    let guard = 0;
    while (engine.getState().status === "playing" && guard++ < 200) {
      const rack = engine.getState().rack;
      let played = false;
      for (let i = 0; i < rack.length; i++) {
        const tile = rack[i];
        const moves = engine.legalMovesForRackTile(i);
        if (moves.length === 0) continue;
        const move = moves[0];
        const cellBefore = engine.getState().board[move.row][move.col];
        const cellMultiplier = cellBefore.multiplier;
        const points = move.edges[0]?.points ?? 0;
        const result = resolveMove(engine, i, move);
        played = true;

        if (cellMultiplier) {
          check(
            "Bonus cell placement sets exactly one of multiplierApplied/multiplierMissed",
            (result.multiplierApplied !== undefined) !== (result.multiplierMissed !== undefined),
          );
          if (result.multiplierApplied) {
            sawApplied = true;
            check("multiplierApplied matches the cell's bonus type", result.multiplierApplied === cellMultiplier);
            check(
              "multiplierApplied only fires when the tile type matches the bonus",
              tileMatchesMultiplierType(tile, cellMultiplier),
            );
            check(
              "connectionScore reflects the applied bonus (boosted above the edge's raw points)",
              points > 0 && result.connectionScore > points,
            );
          } else if (result.multiplierMissed) {
            sawMissed = true;
            check("multiplierMissed matches the cell's bonus type", result.multiplierMissed === cellMultiplier);
            check(
              "multiplierMissed fires when the tile type doesn't match the bonus, it's a wildcard, or the edge is worth 0",
              tile.kind === "WILDCARD" ||
                !tileMatchesMultiplierType(tile, cellMultiplier) ||
                points === 0,
            );
            check(
              "connectionScore is untouched when the bonus misses",
              result.connectionScore === points,
            );
          }
        } else {
          check(
            "Non-bonus cell placement sets neither multiplierApplied nor multiplierMissed",
            result.multiplierApplied === undefined && result.multiplierMissed === undefined,
          );
        }
        break;
      }
      if (!played) break;
    }
  }
  check("Observed at least one applied-bonus placement across the seed sweep", sawApplied);
  check("Observed at least one missed-bonus placement across the seed sweep", sawMissed);
}

console.log("\nGuided five-tile path checks:");
{
  const engine = new GuidedGameEngine(dataset, 20260723);
  let state = engine.getState();
  check("Guided board starts without multiplier cells", state.board.flat().every((cell) => !cell.multiplier));
  check("Guided turn offers exactly three choices", state.choices.length === 3);

  for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
    state = engine.getState();
    const previousPosition = GUIDED_PATH_POSITIONS[step];
    const previous = state.board[previousPosition.row][previousPosition.col].tile as ArtistTile | SongTile;
    const correctIndex = state.choices.findIndex(
      (choice) => bestConnectionReason(previous, choice) !== null,
    );
    const validChoices = state.choices.filter(
      (choice) => bestConnectionReason(previous, choice) !== null,
    );
    check(`Step ${step + 1} has exactly one connecting choice`, validChoices.length === 1);
    check(
      `Step ${step + 1} correct choice is not self-referential`,
      !isSelfReferentialGuidedConnection(previous, state.choices[correctIndex]),
    );

    if (step === 0) {
      const hint = engine.useHint();
      check("Hint reveals the connection type", hint === bestConnectionReason(previous, state.choices[correctIndex]));
      const expected =
        GUIDED_TILE_POINTS + tileValue(state.choices[correctIndex]) + tileValue(previous);
      const result = engine.chooseTile(correctIndex);
      check("First tile includes its value and the starter value", result.pointsAwarded === expected);
    } else {
      const choice = state.choices[correctIndex];
      const correctReason = bestConnectionReason(previous, choice) as ConnectionCategory;
      const choiceResult = engine.chooseTile(correctIndex);
      check(`Step ${step + 1} waits for a connection guess`, choiceResult.needsConnectionGuess);
      const guessedReason =
        step === 1
          ? CONNECTION_CATEGORIES.find((reason) => reason !== correctReason)!
          : correctReason;
      const guessResult = engine.guessConnection(guessedReason);
      const anchorPosition = GUIDED_PATH_POSITIONS[GUIDED_PATH_POSITIONS.length - 1];
      const anchor = state.board[anchorPosition.row][anchorPosition.col].tile!;
      const expected =
        GUIDED_TILE_POINTS +
        tileValue(choice) +
        (step === GUIDED_PATH_LENGTH - 1 ? tileValue(anchor) : 0) +
        (step === 1 ? 0 : GUIDED_CONNECTION_BONUS);
      check(`Step ${step + 1} awards the expected score`, guessResult.pointsAwarded === expected);
      if (step === 1) {
        check("Wrong connection guess reveals the correct reason", guessResult.correctReason === correctReason);
        check("Wrong connection guess does not end the game", guessResult.status === "playing");
      }
    }
  }

  state = engine.getState();
  check("Five correct tiles complete the guided path", state.status === "path-complete");
  check("All five intermediate board rows contain their prepared tiles",
    GUIDED_PATH_POSITIONS.slice(1, -1).every((position) => !!state.board[position.row][position.col].tile));
  check("Completed route draws six connections including the anchor edge", state.completedConnections.length === 6);
  check(
    "Every completed path edge joins distinct performer identities",
    GUIDED_PATH_POSITIONS.slice(0, -1).every((position, index) => {
      const next = GUIDED_PATH_POSITIONS[index + 1];
      return !isSelfReferentialGuidedConnection(
        state.board[position.row][position.col].tile as ArtistTile | SongTile,
        state.board[next.row][next.col].tile as ArtistTile | SongTile,
      );
    }),
  );
  const completedScore = state.score;
  engine.startNextRound();
  state = engine.getState();
  check("Another round preserves the accumulated score", state.score === completedScore);
  check("Another round starts a fresh five-tile path", state.status === "playing" && state.step === 0);
  check("Completed-round count carries into the next round", state.roundsCompleted === 1);
}

{
  const engine = new GuidedGameEngine(dataset, 20260724);
  for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
    const state = engine.getState();
    const previousPosition = GUIDED_PATH_POSITIONS[step];
    const previous = state.board[previousPosition.row][previousPosition.col].tile!;
    const wrongIndex = state.choices.findIndex((choice) => bestConnectionReason(previous, choice) === null);
    const result = engine.chooseTile(wrongIndex);
    check(`Miss ${step + 1} places the correct tile for the player`, !!engine.getState().board[GUIDED_PATH_POSITIONS[step + 1].row][GUIDED_PATH_POSITIONS[step + 1].col].tile);
    check(`Miss ${step + 1} awards no base points`, result.pointsAwarded === 0);
    if (step < GUIDED_PATH_LENGTH - 1) {
      check(`Miss ${step + 1} still offers the connection bonus`, result.needsConnectionGuess);
      const correctTile = result.correctTile;
      const correctReason = bestConnectionReason(previous, correctTile) as ConnectionCategory;
      const bonus = engine.guessConnection(correctReason);
      check(`Miss ${step + 1} can still earn the 10-point bonus`, bonus.pointsAwarded === GUIDED_CONNECTION_BONUS);
    }
  }
  check("The fifth artist/song miss ends the guided session", engine.getState().status === "game-over");
  check("The session tracks all five misses", engine.getState().misses === GUIDED_PATH_LENGTH);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
