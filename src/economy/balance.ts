/**
 * ============================================================================
 *  Balance targets (single place to read before touching numbers)
 * ============================================================================
 *
 * Design goals (industry_giant_2_analiza_i_sequel.md): easy to learn, hard to
 * master; always something to do; no walls; ecology is an optimisation layer,
 * not a punishment. Verified by src/core/longrun.test.ts (CI subset) and its
 * IG3_LONG=1 variant (matrix easy/normal/hard × seeds, 1850 → 2030 run), using
 * the scripted "reasonable player" in src/ai/scripted.ts.
 *
 * Targets (normal difficulty unless stated):
 *  1. First chain (farm → mill → bakery → shop, ~32 k zł + carts) is in the
 *     black within ≤ 5 game months (measured: month 2–3) and pays back in ~10.
 *  2. Bankruptcy only through clearly bad play: the scripted player (no loans
 *     unless cash < 5 k, keeps ~3 months of costs in reserve) never goes
 *     bankrupt on any difficulty.
 *  3. By year ~12–15 a player running 5 chains out-earns the AVERAGE rival:
 *     company value 1.5–1.9× the average rival on normal (3.0–3.2 M vs 1.7–2.0 M zł
 *     at year 15), monthly profit 1.1–1.3×; easy 1.7–2× profit, 3× value; on
 *     hard the rivals earn ~2× such a player (hard = competitive). Before tuning a normal
 *     rival (2 base projects, +1 every 720 days, no efficiency handicap) ran
 *     7–9 chains by year 15 and matched or beat the 5-chain player.
 *     AI knobs (ai/profiles.ts DIFFICULTY): base projects easy 1 / normal 1 /
 *     hard 3, growthDays 900 / 800 / 540, efficiency 0.8 / 0.85 / 1.
 *  4. Rivals are never passive: a new building or an expansion at least every
 *     ~2.5 years (measured max gap: 330–890 days; was 1 400–7 000 days when a
 *     half-built chain blocked every new project forever), they repair,
 *     relocate depleted mines, re-link stuck vehicles, scrap chains that
 *     cannot be completed and expand their busiest building ~yearly. No rival
 *     went bankrupt in the 15-year matrix (hard: occasional bankruptcy after
 *     4+ years is acceptable).
 *  5. Eras bring new, more lucrative products: value demanded per 10 k
 *     inhabitants grows from ~18 k zł/month (bread) to 40–60 k (TVs,
 *     computers) and ~115 k (smartphones), at 5–20× the capital of a bread
 *     chain; tech-gated content needs research time.
 *  6. Wages vs prices: world wages 55/80/130/220/340 per era (×6.2) while the
 *     price level (market.priceIndex, PRICE_INDEX_BY_ERA in constants.ts)
 *     goes 1/1.18/1.4/1.7/2.0 (×2). An un-automated 1850 chain slowly loses
 *     margin (bread: 5.3 k → 7.2 k/month at digital-era prices, coal/planks go
 *     to ~0) — automation research answers it: automation_1 (mass) ×0.8,
 *     industrial_robots (modern) ×0.8, robotics (digital) ×0.6 workers keep
 *     every 1850 chain profitable. Era changes notify the player about it.
 *     Before tuning, priceIndex was fixed at 1 and ALL 1850 chains lost money
 *     from the modern era on (bread −1.3 k/month in the digital era).
 *  7. Market prices stay within 0.25–3× of base × priceIndex, median ≈ 1.
 *     (Seasonal swings are applied once — previously they were applied twice
 *     and coal hit 2.15× base every winter.)
 *  8. World events ≈ one per 40–80 days (÷ 0.7 easy / × 1.4 hard); a player
 *     building gets knocked out (< 25 % condition) about once per 20–30 years;
 *     every such case notifies with the repair cost, AI repairs on its own.
 *     Routine vehicle breakdowns no longer flood the log (only worn vehicles).
 *  9. Ecology: carbon-tax / emission-cap episodes cost a polluting player
 *     ~1–5 % of profit — a nudge toward filters / green tech, not a wall.
 * 10. Deposits: one mine site lasts ~8–12 years (DEPOSITS amounts ×1.8);
 *     depletion notifies the player, AI relocates the mine.
 * 11. Research: BASE_RESEARCH_POINTS 25 (was 10), 25 zł per point (was 40):
 *     first techs in ~2–3 months with a design office or ~1 000 zł/month,
 *     ~6 months with nothing (was 18). Era techs cost more (1 500 / 3 200 /
 *     6 500 / 14 000) because researching them moves the WORLD era (and wages),
 *     and can start at most ERA_EARLY_YEARS (20) before the era's calendar year —
 *     before that a rich player dragged the world into the digital era by 1880.
 *     Reaching an era grants every company that era's gateway `era_*` tech.
 * 12. Trains beat trucks on long hauls: steam 40/wagon at 14 tiles/day, a default
 *     consist of ceil((min+max)/2) wagons (steam 4 → 160 units ≈ 690 units/month
 *     over 40 tiles vs ~35 for a horse cart); stations feed their catchment daily.
 *
 * Performance budget (256×256, 12 cities, 3 rivals, ~300 vehicles): < 4 ms
 * per sim tick on average, no single tick > 16 ms (AI think ≈ 2–4 ms, capped
 * at AI_MAX_THINKS_PER_DAY per day — a deterministic count, never wall-clock).
 */

/** Numbers the long-run tests assert against (keep in sync with the notes above). */
export const BALANCE_TARGETS = {
  firstChainProfitMonths: 5,
  playerVsAverageRivalYear: 12,
  maxRivalIdleDays: 3 * 360,
  priceBand: [0.25, 3] as const,
  msPerTickAvg: 4,
  msPerTickMax: 16,
} as const;
