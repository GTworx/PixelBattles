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

## [2026-11-03] ingest | World War I (1914–1918)

Added `battles/world-war-i` and `scenarios/world-war-i.json`, the simulator's first war-scale scenario: one
48×30 map of Europe, the Middle East and North Africa (1 tile ≈ 100 km) from Ireland and Scandinavia to the
Sahara and the Persian Gulf, with every front on it — Western, Eastern, Italian, Balkan/Salonika, Gallipoli,
Caucasus, Sinai–Palestine, Mesopotamia and the Senussi campaign — and the Grand Fleet and High Seas Fleet in
the North Sea. Units are armies and army groups; fifteen phases run from the invasion of Belgium to the
armistice of 11 November 1918. Geography is compressed (the Western Front is about seven tiles; Gallipoli is
a two-tile spit cut off from Thrace so that the evacuation leaves the map). Russia and Romania leave the war
as `surrendered`, the German western armies as `withdrawn`. New pages: `commanders/joseph-joffre`,
`ferdinand-foch`, `douglas-haig`, `aleksei-brusilov`, `paul-von-hindenburg`, `erich-ludendorff`,
`enver-pasha`, `mustafa-kemal`; `concepts/trench-warfare`, `concepts/infiltration-tactics`; World War I
added to `concepts/encirclement` (Tannenberg), `concepts/combined-arms` (Amiens) and `concepts/siege-warfare`
(Liège, Przemyśl, Kut). New flags `entente` (the allied colours quartered) and `german-imperial` (the
black-white-red tricolour). Sources: Wikipedia's articles on the war, its casualties and each campaign; unit
strengths are representative theatre figures, and the casualty ranges follow the sources' disagreement.

## [2026-11-24] ingest | World War II in Europe (1939–1945)

Added `battles/world-war-ii` and `scenarios/world-war-ii.json`, the second war-scale scenario, on the
World War I map (1 tile ≈ 100 km) with Stalingrad and the lower Volga added at the eastern edge. Units are
army groups, fronts, fleets and air forces; fifteen phases run from the invasion of Poland to the surrender
of 8 May 1945 — France and Dunkirk, the Battle of Britain, the desert war, Barbarossa, Case Blue,
Stalingrad and El Alamein, Uranus and Tunisia, Kursk and Sicily, Italy, D-Day and Bagration, the Bulge,
Berlin. The Pacific War is off the map and appears only in the narration. The three German army groups
carry their commanders through renamings (Bock's North/B/Centre, Rundstedt's South/A/South, Leeb's C/North),
so a unit's name lists its successive titles.

Schema: new unit type `aircraft` (flies over any terrain, starts anywhere, ignores terrain speed and
cover, bombards at range 6) for the Luftwaffe, RAF Fighter Command and the Allied bomber forces. New flag
`allies` (Union Flag, Stars and Stripes, Soviet flag and French tricolour quartered); the Axis flies the
existing Balkenkreuz `german-cross`. New pages: `commanders/dwight-d-eisenhower`, `bernard-montgomery`,
`erwin-rommel`, `heinz-guderian`, `hugh-dowding`; `concepts/blitzkrieg`, `concepts/strategic-bombing`.
World War II added to the Stalingrad commanders (Zhukov, Chuikov, Paulus, Yeryomenko, Manstein, Hoth) and
to `concepts/encirclement`, `combined-arms`, `urban-warfare` and `operation-uranus`. Sources: Wikipedia's
articles on the war, its European theatre, its casualties and each major campaign; strengths are
representative theatre figures, and casualty ranges follow the sources' disagreement.

## [2026-11-24] ingest | The Pacific War (1937–1945)

Added `battles/pacific-war` and `scenarios/pacific-war.json`, the third war-scale scenario and the companion
to `world-war-ii` (Europe), on a new 48×30 map of Asia and the Pacific (1 tile ≈ 250–300 km, 88°E–155°W,
52°N–28°S) rasterised from approximate coastlines: China with the Yangtze, Manchuria, Korea, Japan, Burma,
Malaya, the East Indies, the Philippines, New Guinea with the Kokoda Track across the Owen Stanleys,
northern Australia, the Solomons, and the Central Pacific islands as single tiles out to Midway and Pearl
Harbor. Fifteen phases run from the Marco Polo Bridge (1937) to the surrender (2 September 1945). Ships move
only on the sea, so each island assault (Guadalcanal, Tarawa, Saipan, Iwo Jima, Okinawa, Leyte) is its own
unit that comes ashore on its island; Kido Butai is sunk at Midway, the Mobile Fleet at Leyte Gulf and the
Combined Fleet off Okinawa. New flags `japan` (the Hinomaru, the national flag rather than the military
Rising Sun) and `allies-pacific` (US, UK, Republic of China and Australian flags quartered). New pages:
`commanders/chester-w-nimitz`, `douglas-macarthur`, `chiang-kai-shek`, `william-slim`, `isoroku-yamamoto`,
`tomoyuki-yamashita`; `concepts/carrier-warfare`, `concepts/leapfrogging`, `concepts/kamikaze`; the Pacific War
added to `concepts/strategic-bombing`. Sources: twenty Wikipedia articles on the war and its campaigns;
casualty totals are the articles' ranges, and the Philippines campaign of 1941–42 rests on the Pacific War
article because its own page could not be fetched.
