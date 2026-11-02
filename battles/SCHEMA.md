# Battle Wiki — Schema

This folder is an **LLM Wiki** (Karpathy pattern): raw sources stay untouched, an
LLM maintains a linked set of markdown pages on top of them, and two files keep
it navigable — `index.md` (catalog, read first) and `log.md` (append-only record).
The PixelBattles app reads this folder at runtime: the wiki pages ground the chat
assistant, and the scenario files drive the map and the simulation.

```
battles/
  OldBatles1.md          RAW SOURCE — the original battle table. Never edit.
  SCHEMA.md              This file: conventions for every page and scenario.
  index.md               Catalog of every page, one line each. Read first.
  log.md                 Append-only log of ingests and edits (newest last).
  wiki/
    battles/<slug>.md    One page per battle (the main pages).
    commanders/<slug>.md One page per commander.
    concepts/<slug>.md   Tactics, formations, weapons, doctrines.
  scenarios/<slug>.json  Machine-readable map + armies + historical timeline.
```

Slugs are lowercase kebab-case (`battle-of-cannae` → `cannae`, `Hannibal Barca`
→ `hannibal-barca`). Link pages with `[[slug]]` wikilinks, e.g.
`[[hannibal-barca]]`, `[[double-envelopment]]`, `[[cannae]]`.

## Battle page — `wiki/battles/<slug>.md`

```markdown
---
type: battle
slug: cannae
title: Battle of Cannae
date: 2 August 216 BCE
war: Second Punic War
location: Cannae, Apulia, Italy
belligerents: [Carthage, Roman Republic]
commanders: [hannibal-barca, lucius-aemilius-paullus, gaius-terentius-varro]
victor: Carthage
duration: ~1 day (afternoon)
scenario: ../../scenarios/cannae.json
sources: 4
updated: 2026-11-01
---

# Battle of Cannae

> One-paragraph summary (what, who, why it matters).

## Background strategic context, campaign leading up to the battle

## Belligerents table: side, commanders, strength, composition

## Terrain ground, rivers, slopes, weather, sun/wind — what the map shows

## Order of battle each side's deployment, left → right, with unit sizes

## Course of the battle numbered phases with times; matches the scenario phases

## Outcome & casualties table + result

## Aftermath & significance

## What-if levers 3–6 decision points where history could have turned

## Commanders [[links]]

## Concepts [[links]]

## Sources numbered list of URLs actually consulted
```

Every factual claim should be traceable to a source in the list. Where sources
disagree (army sizes are the usual case), give the range and say so.

## Commander page — `wiki/commanders/<slug>.md`

Frontmatter `type: commander`, `slug`, `name`, `lifespan`, `allegiance`,
`battles: [slugs]`. Sections: summary, career, command style, battles
(`[[links]]`), sources.

## Concept page — `wiki/concepts/<slug>.md`

Frontmatter `type: concept`, `slug`, `name`, `battles: [slugs]`. Sections:
definition, how it worked, where it appears (`[[battle links]]`), sources. If the
page already exists, add your battle to `battles:` and to "where it appears" —
never overwrite another battle's content.

## Scenario — `scenarios/<slug>.json`

The simulator's input. Validate with `node scripts/validate-battles.mjs`.

```jsonc
{
  "id": "cannae", // = slug
  "title": "Battle of Cannae",
  "year": "216 BCE",
  "date": "2 August 216 BCE",
  "location": "Cannae, Apulia, Italy",
  "wiki": "wiki/battles/cannae.md",
  "summary": "Two or three sentences.",
  "map": {
    "cols": 48,
    "rows": 30, // always 48 × 30
    "scale": "1 tile ≈ 60 m", // free text
    "north": "up",
    "terrain": ["...48 chars...", "... 30 rows ..."],
    "labels": [{ "text": "River Aufidus", "col": 4, "row": 2 }],
  },
  "sides": [
    {
      "id": "A",
      "name": "Carthage",
      "commander": "Hannibal Barca",
      "color": "#c0392b",
      "flag": "carthage",
    },
    {
      "id": "B",
      "name": "Roman Republic",
      "commander": "Varro & Paullus",
      "color": "#2e64c8",
      "flag": "rome",
    },
  ],
  "victor": "A", // side id, or "draw"
  "units": [
    {
      "id": "car-gauls", // unique, kebab-case
      "side": "A",
      "name": "Gallic & Spanish infantry (centre)",
      "type": "infantry", // see unit types
      "strength": 20000, // men (ships/tanks: count of men aboard is fine)
      "col": 24,
      "row": 14, // starting tile, must be passable
      "facing": "down", // up | down | left | right
      "morale": 70, // 0–100
      "commander": "Hannibal Barca", // optional
      "enterPhase": "p4", // optional: arrives at the start of that phase
    },
  ],
  "phases": [
    {
      "id": "p1",
      "title": "Deployment",
      "time": "dawn, ~07:00", // historical clock or date
      "durationSec": 8, // playback seconds at 1× (4–15)
      "narration": "2–4 sentences of what happened in this phase.",
      "orders": [
        { "unit": "car-gauls", "action": "move", "to": [24, 16] },
        { "unit": "rom-centre", "action": "attack", "target": "car-gauls" },
      ],
      "outcomes": [
        // state at the END of the phase (historical)
        { "unit": "rom-centre", "strength": 40000, "morale": 40 },
        { "unit": "rom-cav-right", "status": "routed" },
      ],
    },
  ],
  "result": {
    "summary": "One paragraph.",
    "casualties": { "A": "~5,700 killed", "B": "~50,000–70,000 killed or captured" },
  },
  "sources": [{ "title": "Battle of Cannae — Wikipedia", "url": "https://..." }],
}
```

### Terrain characters

| Char | Terrain                         | Passable                    |
| ---- | ------------------------------- | --------------------------- |
| `.`  | open ground / grassland         | yes                         |
| `,`  | fields / farmland               | yes                         |
| `b`  | sand, beach, desert, dry plain  | yes                         |
| `:`  | road / track                    | yes (fast)                  |
| `^`  | hills / high ground             | yes (slow, defensive bonus) |
| `T`  | forest / woods / orchards       | yes (slow, cover)           |
| `s`  | marsh / swamp                   | yes (very slow)             |
| `~`  | river / stream / ford           | yes (very slow)             |
| `c`  | town, village, farm buildings   | yes (slow, cover)           |
| `r`  | ruins, rubble (e.g. Stalingrad) | yes (slow, cover)           |
| `g`  | gate in a wall                  | yes                         |
| `=`  | sea / deep water / wide river   | no (only `ships`)           |
| `M`  | mountains / cliffs              | no                          |
| `#`  | fortification wall              | no                          |

Keep the map honest to the real geography: put rivers, coasts, hills and walls
where the sources put them, and orient it so the armies face each other across
the screen.

### Flags

`flag` (optional) names a pixel flag in `webview-ui/src/office/sprites/battleFlags.ts`, drawn on the
unit banners, the commanders' standards and the legend; without one a side flies a plain banner in
its `color`. Available: `athens`, `persia`, `greek-lambda`, `macedon`, `carthage`, `rome`, `wessex`,
`normandy`, `seljuk`, `byzantine-labarum`, `palaiologan`, `england-royal`, `france-ancient`,
`ottoman`, `burgundy-cross`, `france-tricolor`, `union-flag`, `soviet`, `german-cross`. Pre-modern "flags" are the
standards or emblems the sources associate with the army; add a sprite there to add a flag.

### Unit types

`infantry`, `heavy_infantry`, `light_infantry`, `archers`, `cavalry`,
`heavy_cavalry`, `horse_archers`, `chariots`, `elephants`, `artillery`, `siege`,
`ships`, `armor`, `command`.

### Order actions

| Action    | Fields                            | Meaning                                                          |
| --------- | --------------------------------- | ---------------------------------------------------------------- |
| `move`    | `to: [col,row]`                   | march to a tile                                                  |
| `attack`  | `target: unitId`                  | close with and fight a unit                                      |
| `charge`  | `target: unitId`                  | fast attack, bonus on impact (cavalry, chariots, elephants)      |
| `flank`   | `target: unitId`, `to: [col,row]` | go round via `to`, then attack                                   |
| `bombard` | `target: unitId`                  | ranged attack without closing (archers, artillery, siege, ships) |
| `hold`    | —                                 | stand and defend in place                                        |
| `retreat` | `to: [col,row]`                   | fall back in order                                               |
| `rout`    | —                                 | break and flee off the map                                       |

`outcomes` pin the historical result at the end of a phase: `strength` (men
left), `morale`, and `status` (`active`, `routed`, `destroyed`, `surrendered`,
`withdrawn`). In historical playback the engine moves units by `orders` and
blends their numbers toward `outcomes`; once the user changes the battle from
the chat, outcomes stop applying and the combat rules decide.
