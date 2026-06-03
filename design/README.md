# Gridiron Blitz — Design Docs

Foundation for the gameplay rebuild. Produced by a 14-agent research workflow (one agent per system + synthesis), each grounding its model in real football-game mechanics and coaching sources. **Goal:** fun, readable, somewhat-realistic football where AI players + one human per team behave close to the real thing — outcomes are a ratings-bound *distribution* with fat tails (blow-bys, pancakes, breakaways), not averages.

## Core design answers (owner)
- 11 players/team; human controls ONE, the other 10 are AI. A gel of AI + one human per team.
- **Balanced** skill vs ratings: a skilled human can scheme/maneuver, but the speed & strength of physical contests (shedding, breaking tackles, winning the rush) are bound to **ratings**.
- **Variance scales with the ratings mismatch**: big gap → extreme outcomes often; even matchup → mostly a grind with occasional RNG/X-factor tails, often enough to be exciting.
- Two POC teams are **pre-baked** with fixed ratings for deterministic headless tests.

## The synthesized foundation
- [contest-kernel.md](contest-kernel.md) — the ONE shared weighted-roll every physical interaction calls
- [foundation.md](foundation.md) — 2D kinematics + ratings schema + tick model
- [rosters.md](rosters.md) — the two pre-baked POC teams
- [systems-integration.md](systems-integration.md) — how each system plugs into the kernel
- [build-plan.md](build-plan.md) — phased build order + per-phase acceptance (distributions, not averages)
- [validation.md](validation.md) — headless-sim metrics + tuning knobs

## System specs
- [Movement & Kinematics (top-down 2D football locomotion: accel/decel, top speed, turn radius/agility, momentum, directional speed modifiers, pursuit-angle steering)](systems/movement.md)
- [Pass Blocking (pass protection mechanics)](systems/pass-blocking.md)
- [Run Blocking](systems/run-blocking.md)
- [Pass Rush — defensive line / edge rush behavior (moves, blocker contest, contain, scramble reaction)](systems/pass-rush-defensive-line-edge-rush-behav.md)
- [Man Coverage](systems/man-coverage.md)
- [Zone coverage](systems/zone-coverage.md)
- [Route Running](systems/route-running.md)
- [QB AI — CPU quarterback decision-making (progression reads, throw timing, pressure response, target selection)](systems/qb-ai-cpu-quarterback-decision-making.md)
- [Run Fits & Ball-Carrier Vision](systems/run-fits.md)
- [Tackling, Broken Tackles & Pursuit](systems/tackling-broken-tackles.md)
- [Catching](systems/catching.md)
- [Ratings system](systems/ratings-system.md)
- [Playbook & Formations](systems/playbook.md)

## Open design questions
- Severity payload sign convention: when a CONTINUOUS (perFrame) contest does NOT win on a given frame, should sev still be computed/applied (e.g. partial drive push) or only on the frame it resolves? I assumed sev only matters on the resolving frame for instant contests and on shed/pancake events for continuous ones — confirm.
- Human-player variance: the human bypasses AI decision clocks but uses the same contest rolls. Should a human-controlled attacker get any input-timing bonus (e.g. a well-timed juke flick adding leverage pts), or is the human's edge purely geometric (scheming the open angle)? The owner's 'balanced skill vs ratings' could go either way.
- Field width is compressed to 24yd (Tecmo-style). Several specs cite real-ball leverage/separation in yards (1-2yd) that I compressed to ~0.6yd. Confirm the compression factor is acceptable, or whether separation should be tuned independently of the compressed geometry so passing windows feel right.
- X-factor / superstar abilities (guaranteed-first-win, in-zone +12) are referenced by the Ratings and Pass-Rush specs but not in the two POC rosters. Do the POC teams need X-factor flags for the deterministic tests, or are abilities deferred past POC?
- Fumble/turnover frequency target: I set 1-3% overall. Arcade games often run hotter (more turnovers = more swings) — confirm the desired turnover rate, since it strongly shapes how dramatic games feel.
- Quarter length is 120s arcade-short. Confirm whether the headless validation should use real-length drives for realistic distribution shapes, or the arcade clock (which changes possessions-per-game and thus the score-margin distribution).

## Consolidated bibliography
- /Users/chrissparks/Documents/code/gridiron-blitz/src/game/Game.ts (contest() lines 738-766, rushPasser 1020-1024, passProtect 1171-1214, shedRating/blockRating 80-91)  
  _used by: pass-rush-defensive-line-edge-rush-behav_
- http://coachvint.blogspot.com/2020/12/teaching-running-back-to-read-1-to-2-on.html  
  _used by: run-fits_
- http://www.megabearsfan.net/post/2020/07/27/How-Madden-Fails-to-Simulate-Football-Quarterback-Progressions.aspx  
  _used by: qb-ai-cpu-quarterback-decision-making_
- http://www.vhpg.com/madden-24-quarterback-ai/  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://alleyesdbcamp.com/mastering-the-art-of-man-coverage/  
  _used by: man-coverage_
- https://alleyesdbcamp.com/teaching-leverage-and-alignment-across-multiple-coverages-a-blueprint-for-db-coaches/  
  _used by: catching_
- https://arxiv.org/html/2403.14769v2  
  _used by: tackling-broken-tackles_
- https://athletesuntapped.com/blog/breaking-the-coverage-mastering-route-separation-mechanics-in-football/  
  _used by: route-running_
- https://athletesuntapped.com/blog/deciphering-the-defense-mastering-football-coverage-recognition/  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://bigskillposition.wordpress.com/run-game/outside-zone/the-outside-zone-article-5/  
  _used by: run-fits_
- https://blogs.usafootball.com/blog/1047/reading-the-wide-receiver-s-hips-to-teach-man-coverage  
  _used by: man-coverage_
- https://blogs.usafootball.com/blog/5615/how-to-understand-nick-saban-s-pattern-match-cover-3-defense  
  _used by: zone-coverage_
- https://blogs.usafootball.com/blog/7085/coaching-the-wide-receiver-the-speed-cut  
  _used by: route-running_
- https://clutchpoints.com/gaming/all-madden-26-x-factors  
  _used by: ratings-system_
- https://cyberpost.co/what-is-rac-madden/  
  _used by: catching_
- https://dlineexamples.substack.com/p/pass-rush-moves-handbook  
  _used by: pass-rush-defensive-line-edge-rush-behav_
- https://en.wikipedia.org/wiki/40-yard_dash  
  _used by: movement_
- https://en.wikipedia.org/wiki/List_of_formations_in_American_football  
  _used by: playbook_
- https://en.wikipedia.org/wiki/Personnel_grouping_(gridiron_football)  
  _used by: playbook_
- https://en.wikipedia.org/wiki/Zone_defense_in_American_football  
  _used by: zone-coverage, playbook_
- https://fenixbazaar.com/2025/07/11/college-football-26-player-attributes/  
  _used by: zone-coverage_
- https://footballtoolbox.net/drop-zones-and-coverage  
  _used by: zone-coverage_
- https://forums.ea.com/discussions/madden-nfl-26-general-discussion-en/how-to-qb-contain-and-stop-the-qb-in-the-option-game/12492044  
  _used by: pass-rush-defensive-line-edge-rush-behav_
- https://forums.operationsports.com/forums/forum/football/madden-nfl-football/madden-nfl-old-gen/361126-locomotion-speed-agility-acceleration-question  
  _used by: movement_
- https://forums.operationsports.com/forums/madden-nfl-football/1014899-man-coverage-leverage-nuances.html  
  _used by: man-coverage_
- https://ftnfantasy.com/nfl/lessons-from-interception-worthy-throws  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://game8.co/games/Madden-NFL-25/archives/463828  
  _used by: ratings-system_
- https://gamedevelopment.tutsplus.com/tutorials/understanding-steering-behaviors-pursuit-and-evade--gamedev-2946  
  _used by: movement_
- https://gamefaqs.gamespot.com/nes/587686-tecmo-super-bowl/faqs/44195  
  _used by: tackling-broken-tackles_
- https://gorout.com/football-personnel-groupings/  
  _used by: playbook_
- https://insider.afca.com/xs-os-teaching-pursuit/  
  _used by: movement_
- https://madden.fandom.com/wiki/Attributes  
  _used by: movement, pass-blocking, run-blocking, pass-rush-defensive-line-edge-rush-behav, man-coverage, zone-coverage, route-running, tackling-broken-tackles, catching, ratings-system_
- https://maddenguides.com/pass-protection-schemes/  
  _used by: pass-blocking_
- https://maddenguides.com/personnel-groupings-101/  
  _used by: playbook_
- https://maddenunderground.com/new-madden-mechanics-dbwr-interaction/  
  _used by: man-coverage, route-running_
- https://mgoblog.com/diaries/anatomy-double-move  
  _used by: man-coverage_
- https://nicidob.github.io/nba_elo/  
  _used by: ratings-system_
- https://old.muthead.com/forums/madden-nfl-mobile/madden-nfl-mobile-discussion/1174473-understanding-how-speed-acceleration-and-agility  
  _used by: movement_
- https://old.muthead.com/forums/madden-nfl-mobile/madden-nfl-mobile-discussion/1265387-wr-drop-test-with-99-cat-and-100-tas  
  _used by: catching_
- https://old.muthead.com/forums/madden/mut-discussion/168030-fully-detailed-meaning-of-each-attribute-keep-this  
  _used by: route-running_
- https://oldmansim.wordpress.com/2014/03/27/madden-25-guide-to-player-ratings-attributes-traits/  
  _used by: run-fits_
- https://realsport101.com/article/madden-22-running-guide-controls-how-to-juke-truck-spin-stiff-arm-sprint-hurdle-jurdle-protect-ball  
  _used by: tackling-broken-tackles_
- https://simplifaster.com/articles/breakpoint-mechanics-separation-football/  
  _used by: route-running_
- https://sportmentary.com/football/football-basics/footballs-angle-of-pursuit/  
  _used by: tackling-broken-tackles_
- https://tecmobowl.org/forums/topic/4870-button-mashing/  
  _used by: tackling-broken-tackles_
- https://themaddenacademy.com/2025/01/play-man-coverage-madden-26  
  _used by: man-coverage_
- https://theriotreport.com/gap-discipline-what-it-means-and-how-it-defines-your-run-defense/  
  _used by: run-fits_
- https://throwdeeppublishing.com/blogs/football-glossary/run-fits-in-football-the-complete-guide  
  _used by: run-fits_
- https://throwdeeppublishing.com/blogs/football-glossary/the-types-of-blocks-in-football-the-complete-list  
  _used by: run-blocking_
- https://throwdeeppublishing.com/blogs/football-glossary/what-is-cover-3-in-football  
  _used by: zone-coverage_
- https://wismuth.com/elo/calculator.html  
  _used by: ratings-system_
- https://www.1v1me.com/blog/madden-26-catch-types-guide  
  _used by: catching_
- https://www.360player.com/blog/how-to-play-zone-defense-the-strengths-weaknesses-of-cover-2-cover-3-cover-4  
  _used by: zone-coverage_
- https://www.americanfootballmonthly.com/Subaccess/articles.php?article_id=6283 (pursuit angles, leverage, lead the carrier)  
  _used by: movement_
- https://www.bafca.co.uk/wp-content/uploads/2020/01/FORCE-SPILL-and-LEVERAGE-the-3-keys-to-stopping-the-running-game.pdf  
  _used by: run-fits_
- https://www.bigblueview.com/2023/5/30/23742809/summer-school-receiver-route-types-and-combinations  
  _used by: route-running_
- https://www.catscratchreader.com/2017/11/30/16719216/panthers-film-room-pattern-matching-seam-routes-in-the-cover-3-defense  
  _used by: zone-coverage_
- https://www.cougcenter.com/2013/3/28/4093000/air-raid-playbook-pass-protection-schemes  
  _used by: pass-blocking_
- https://www.dawgsbynature.com/2011/10/7/1838147/pass-protection-101  
  _used by: pass-blocking_
- https://www.dexerto.com/madden/how-to-complete-a-one-handed-spectacular-catch-in-madden-25-2864693/  
  _used by: catching_
- https://www.dexerto.com/madden/how-to-juke-in-madden-25-every-skill-move-and-setup-state-explained-2863098/  
  _used by: run-fits, tackling-broken-tackles_
- https://www.ea.com/en/games/madden-nfl/madden-nfl-25/news/gridiron-notes-madden-25-gameplay-deep-dive  
  _used by: tackling-broken-tackles_
- https://www.ea.com/games/ea-sports-college-football/college-football-26/news/college-football-26-campus-huddle-gameplay-deep-dive  
  _used by: zone-coverage_
- https://www.ea.com/games/madden-nfl/madden-nfl-26/controls-hub/m26-pc-defense-coverage-mechanics  
  _used by: catching_
- https://www.ea.com/games/madden-nfl/madden-nfl-26/news/madden-26-gridiron-notes-gameplay-deep-dive  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.ea.com/games/madden-nfl/madden-nfl-26/tips-and-tricks-hub/m26-how-to-stop-quarterback  
  _used by: pass-rush-defensive-line-edge-rush-behav_
- https://www.ea.com/inside-ea/news/gridiron-notes-madden-nfl-23-gameplay-foundational-football  
  _used by: zone-coverage_
- https://www.ea.com/news/madden-25-qb-ratings  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.ea.com/news/pass-blocking-rush  
  _used by: pass-blocking_
- https://www.ea.com/technology//news/boom-tech-ea-sports-madden-nfl-25  
  _used by: tackling-broken-tackles_
- https://www.easports.com/madden-nfl/news/2016/madden-17-gameplay-run-fits-gap-assignments  
  _used by: run-fits_
- https://www.espn.com/nfl/story/_/id/24892208/creating-better-nfl-pass-blocking-pass-rushing-stats-analytics-explainer-faq-how-work  
  _used by: pass-blocking, ratings-system_
- https://www.espn.com/nfl/story/_/id/46138675/2025-nfl-win-rates-top-teams-players-rankings-pass-run-block  
  _used by: pass-blocking, ratings-system_
- https://www.footballsavages.com/breaking-football-high-pointing-vs-catching-traffic-wide-receivers/  
  _used by: catching_
- https://www.gamesradar.com/games/madden-nfl/madden-26-qb-traits/  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.gooalsocial.com/blogs/view/9394/mmoexp-madden-25-ultimate-pass-rush-guide-dominate-the-pocket  
  _used by: pass-rush-defensive-line-edge-rush-behav_
- https://www.joedanielfootball.com/blog/combo-blocks  
  _used by: run-blocking_
- https://www.joedanielfootball.com/blog/umbrella-principle  
  _used by: run-fits_
- https://www.madden-school.com/block-shedding-power-move-ratings/  
  _used by: run-blocking, pass-rush-defensive-line-edge-rush-behav_
- https://www.madden-school.com/madden-17-ball-carrier-special-moves-details/  
  _used by: run-fits, tackling-broken-tackles, ratings-system_
- https://www.madden-school.com/playbooks/  
  _used by: playbook_
- https://www.maddenguides.com/run-blocking-schemes/  
  _used by: run-blocking_
- https://www.maddenuniversity.com/strategies/offense/rushing/madden-nfl-25-tackle-physics-contact-balance-and-ball-carrier-recovery.html  
  _used by: ratings-system_
- https://www.milehighreport.com/22451001/difference-between-zone-and-gap-scheme  
  _used by: run-blocking_
- https://www.milehighreport.com/denver-broncos-stats/155356/creating-time-in-the-pocket  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.mut.gg/news/ask-huddle-40-how-pass-blocking-actually-works-in-madden/  
  _used by: pass-blocking_
- https://www.mut.gg/news/ask-huddle-41-how-run-blocking-actually-works-in-madden/  
  _used by: run-blocking_
- https://www.mut.gg/news/mut-22-glossary-of-key-terms-and-ratings/  
  _used by: catching_
- https://www.naseinc.com/blog/comparison-of-backpedal-and-cross-over-technique-to-acceleration-and-change-of-direction-speed-blog-entry-by-naseinc/  
  _used by: movement_
- https://www.nature.com/articles/s41598-025-85993-1  
  _used by: tackling-broken-tackles_
- https://www.nfl.com/news/next-gen-stats-introduction-to-pressure-probability  
  _used by: pass-blocking_
- https://www.operationsports.com/10-best-madden-25-offensive-playbooks-ranked/  
  _used by: playbook_
- https://www.operationsports.com/all-catches-in-madden-26-and-how-to-use-them/  
  _used by: catching_
- https://www.operationsports.com/how-to-intercept-in-madden-25/  
  _used by: catching_
- https://www.operationsports.com/madden-26-new-ai-traits/  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.pastapadre.com/2016/05/18/extensive-detail-on-the-advancements-to-defensive-ai-in-madden-nfl-17  
  _used by: run-fits_
- https://www.pff.com/news/nfl-the-perfect-timing-a-deeper-dive-into-time-to-throw-data  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.pff.com/news/pro-how-speed-to-apply-pressure-affects-overall-pass-rushing  
  _used by: pass-blocking_
- https://www.red3d.com/cwr/steer/gdc99/ (Reynolds, Steering Behaviors for Autonomous Characters)  
  _used by: movement_
- https://www.sportsdefinitions.com/american-football/gang-tackle/  
  _used by: tackling-broken-tackles_
- https://www.sportsunlimitedinc.com/blog/the-complete-guide-to-the-football-route-tree/  
  _used by: qb-ai-cpu-quarterback-decision-making_
- https://www.stack.com/a/run-backward-faster/ (backpedal ~50% of forward speed)  
  _used by: movement_
- https://www.thegamer.com/madden-25-boom-tech-hit-stick-explained/  
  _used by: tackling-broken-tackles_
- https://www.thegamer.com/madden-25-x-factor-guide/  
  _used by: ratings-system_
- https://www.viqtorysports.com/cover-3-4-6/  
  _used by: zone-coverage_
- https://www.viqtorysports.com/defensive-coverages-in-football-complete-guide/  
  _used by: playbook_
- https://www.viqtorysports.com/pass-rush-moves/  
  _used by: pass-rush-defensive-line-edge-rush-behav_
- https://www.viqtorysports.com/understanding-run-fits-in-football/  
  _used by: run-fits_
- https://www.xandolabs.com/the-lab/defense/fundamentals/pursuit/6-in-season-pursuit-drill-progressions/  
  _used by: tackling-broken-tackles_
- https://xsosfootball.com/i-formation-and-sets/  
  _used by: playbook_

---
_Generated from workflow wf_32b155b4-2d2 — 13 system specs, 110 unique sources._
