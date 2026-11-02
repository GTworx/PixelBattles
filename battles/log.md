# Battle Wiki — Log

Append-only record of ingests, edits and checks, newest last. Each entry:
`## [date] kind | subject` then what changed and anything left open.

## [2026-11-01] schema | wiki created

Set up the LLM Wiki on top of the raw source `OldBatles1.md` (left untouched): `SCHEMA.md`
(page formats, scenario format, terrain and order vocabularies), `wiki/{battles,commanders,concepts}/`,
`scenarios/`, the validator `scripts/validate-battles.mjs` and the index generator
`scripts/build-battle-index.mjs`.

## [2026-11-01] ingest | 10 battles from OldBatles1.md

Researched on the web and wrote one battle page and one scenario per row of the raw table:
Marathon, Thermopylae, Gaugamela, Cannae, Hastings, Manzikert, Agincourt, Constantinople,
Waterloo, Stalingrad. Created commander pages for every named commander and concept pages for the
tactics, formations and weapons the pages link. All ten scenarios pass the validator.

## [2026-11-01] verify | second-pass sourcing

Each battle went through a second research pass to add independent sources beyond Wikipedia and
to check every detail first written from memory. Corrections made in this pass include:

- Marathon: the 2,000-Spartan figure was removed (unsourced). Cynegeirus is now correctly the
  brother of Aeschylus who lost his hand seizing a ship. The Persian fleet's course (round Sounion
  per Herodotus; Phaleron per Livius) is given as disputed.
- Thermopylae: two royal brothers fell, not four (Abrocomes and Hyperanthes). Megistias no longer
  "warned Leonidas". Ephialtes' death is credited to Athenades, with Livius' doubt about the
  betrayal story.
- Constantinople: Baltoghlu was stripped of rank and wounded, not simply dismissed. The unsourced
  18–19 May siege-tower date and the "Hamza Bey" flotilla name were removed. The Kerkoporta story is
  framed as Doukas' account and possibly legend.
- Hastings and Manzikert: added World History Encyclopedia, De Re Militari (Lawson),
  Medievalists.net and The Latin Library. Disputed points (Harold's death, the Malfosse, the
  Manzikert retreat order, Doukas' motive) are presented as disputed.

Open: Britannica, English Heritage, History.com and several museum sites refused automated access
(403/404), so some pages still lean on Wikipedia plus one or two independent sources. Exact
battlefield geography is schematic for Manzikert (site not firmly identified) and approximate for
the Malfosse at Hastings. Unit strengths in scenarios are mid-range picks inside the sourced ranges.

## [2026-11-02] verify | second-pass sourcing, Gaugamela–Cannae and Waterloo–Stalingrad

The remaining four battles went through the same second research pass: each page now cites 5–8
sources, and details first written from memory were checked or removed. Added
`concepts/war-elephants` (Gaugamela's 15 Persian elephants).

## [2026-11-02] schema | side flags

Scenario sides gained an optional `flag` (see SCHEMA.md "Flags"): each side now names a pixel flag
or standard — Athenian owl, Achaemenid falcon, Spartan lambda, Vergina sun, sign of Tanit, Roman
eagle, Wessex wyvern, Norman lions, Seljuk bow, Chi-Rho labarum, Palaiologan cross, English royal
arms, French fleurs-de-lis, Ottoman crescent, French tricolour, Union Flag, Soviet red flag and the
Wehrmacht Balkenkreuz. Pre-modern ones are the emblems the sources tie to each army, not national flags.

## [2026-11-02] ingest | Battle of Preveza (1538)

Added `battles/preveza` and `scenarios/preveza.json`, the simulator's first naval battle: a sea map of
the Ionian coast with Preveza, Actium, the narrow mouth of the Gulf of Arta and Lefkada (the fighting
off Sessola is drawn closer than it was), and nine phases from Grimani's failed landing through the
stand-off and Barbarossa's sortie to the Holy League's night withdrawal. New pages:
`commanders/hayreddin-barbarossa`, `commanders/andrea-doria`, `concepts/galley-warfare`; Preveza
added to `concepts/janissaries`. New flag `burgundy-cross` (the Habsburg saltire) for the Holy League.
Sources: Wikipedia's Preveza, Barbarossa, Doria and Galley articles; the three contemporary
accounts (Venetian-Papal, Hispano-Imperial, Hospitaller) disagree, and the pages say so.
