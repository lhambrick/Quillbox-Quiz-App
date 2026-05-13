/**
 * Default points for a multiple-choice option based on index and direction.
 * Index is 0-based; A=0, B=1, ... E=4.
 */
export function defaultPointsForOption(index: number, direction: "asc" | "desc"): number {
  if (index < 0) return 0;
  return direction === "asc" ? index + 1 : 5 - index;
}

/**
 * Compute points earned for a multiple-choice answer. If the option has a
 * custom `points` value, it takes precedence over the asc/desc default.
 */
export function pointsForOption(
  index: number,
  direction: "asc" | "desc",
  options?: Array<{ points?: number | null }>,
): number {
  if (index < 0) return 0;
  const custom = options?.[index]?.points;
  if (typeof custom === "number" && Number.isFinite(custom)) return custom;
  return defaultPointsForOption(index, direction);
}

/**
 * Maximum points achievable on a multiple-choice question, honoring custom
 * per-option points where provided.
 */
export function maxPointsForQuestion(
  options: Array<{ points?: number | null }>,
  direction: "asc" | "desc",
): number {
  if (!options || options.length === 0) return 0;
  let max = -Infinity;
  options.forEach((o, i) => {
    const pts =
      typeof o?.points === "number" && Number.isFinite(o.points)
        ? o.points
        : defaultPointsForOption(i, direction);
    if (pts > max) max = pts;
  });
  return Number.isFinite(max) ? max : 0;
}

export interface Tier {
  id: string;
  name: string;
  min_value: number;
  max_value: number;
  range_type: "points" | "percent";
  description: string | null;
  cta_text: string | null;
  image_url?: string | null;
}

export function pickTier(tiers: Tier[], totalScore: number, percentage: number): Tier | null {
  for (const t of tiers) {
    const value = t.range_type === "points" ? totalScore : percentage;
    if (value >= t.min_value && value <= t.max_value) return t;
  }
  return null;
}

/**
 * Validates that tiers don't overlap and cover 0–100%.
 * All tiers must use the same range_type to be validated as a set.
 */
export function validateTiers(tiers: Tier[]): { ok: boolean; error?: string } {
  if (tiers.length === 0) return { ok: false, error: "Add at least one tier." };
  const types = new Set(tiers.map((t) => t.range_type));
  if (types.size > 1) return { ok: false, error: "All tiers must use the same range type (points or percent)." };

  const sorted = [...tiers].sort((a, b) => a.min_value - b.min_value);
  for (const t of sorted) {
    if (t.min_value > t.max_value) return { ok: false, error: `"${t.name}" has min greater than max.` };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].max_value >= sorted[i + 1].min_value) {
      return { ok: false, error: `"${sorted[i].name}" overlaps with "${sorted[i + 1].name}".` };
    }
  }
  // Coverage check (only for percent — points coverage depends on total)
  if (tiers[0].range_type === "percent") {
    if (sorted[0].min_value > 0) return { ok: false, error: "Tiers must start at 0%." };
    if (sorted[sorted.length - 1].max_value < 100) return { ok: false, error: "Tiers must extend to 100%." };
  }
  return { ok: true };
}
