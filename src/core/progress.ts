// My Game: points, levels, streaks, skills and badges, worked out from what a player has played.
import type { Feedback, SessionType, Skill } from "./types";
import { addDays, dateKey, startOfWeek, timeKey } from "./time";

export const SKILLS: { key: Skill; label: string }[] = [
  { key: "forehand", label: "Forehand" },
  { key: "backhand", label: "Backhand" },
  { key: "serve", label: "Serve" },
  { key: "volley", label: "Volley" },
  { key: "movement", label: "Movement" },
  { key: "match_play", label: "Match play" },
];
export const skillLabel = (k: Skill) => SKILLS.find((s) => s.key === k)?.label ?? k;

/** Small numbers on purpose: a session is worth 2 or 3, and every 10 points is a level. */
export const POINTS = { group: 2, performance_accelerator: 3, skill: 1, goal: 1 } as const;
export const POINTS_PER_LEVEL = 10;
export const MAX_SKILL_LEVEL = 10;
export const WEEKLY_GOALS = [1, 2, 3] as const;

const LEVEL_NAMES = ["First Serve", "Ball Chaser", "Court Regular", "Rally Starter", "Spin Doctor", "Net Rusher", "Rally Builder", "Baseline Boss", "Match Maker", "Court Captain", "Ace Hunter", "Patio Pro"];
export const levelName = (level: number) => LEVEL_NAMES[level - 1] ?? "Patio Legend";
export const levelFor = (points: number) => Math.floor(points / POINTS_PER_LEVEL) + 1;

/** A community session the player was on court for. */
export interface Played {
  starts_at: string;
  session_type: SessionType;
}

export const goalOf = (p: { weekly_goal?: number | null }) => Math.min(3, Math.max(1, p.weekly_goal ?? 1));

/** First name and last initial, as the leaderboard shows everyone. */
export function shortName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts.at(-1)![0].toUpperCase()}.`;
}

/**
 * Weeks in a row on court, ending this week (or last week, while this one is still open).
 * One missed week a calendar month is forgiven, so a single holiday doesn't wipe the streak.
 */
export function streakWeeks(weeks: Set<string>, now: Date) {
  const thisWeek = startOfWeek(dateKey(now));
  let week = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let count = 0;
  const frozen: string[] = [];
  for (;;) {
    if (weeks.has(week)) {
      count++;
    } else {
      const before = addDays(week, -7);
      // A freeze only bridges a gap back to a played week, and only once per month.
      if (!weeks.has(before) || frozen.some((w) => w.slice(0, 7) === week.slice(0, 7))) break;
      frozen.push(week);
    }
    week = addDays(week, -7);
  }
  if (!count) frozen.length = 0;
  const month = dateKey(now).slice(0, 7);
  return { weeks: count, frozen, freeze_left: !frozen.some((w) => w.slice(0, 7) === month) };
}

/** The longest run of back-to-back weeks on court, freezes aside. */
function longestRun(weeks: Set<string>) {
  let best = 0;
  for (const w of weeks) {
    if (weeks.has(addDays(w, -7))) continue;
    let n = 0;
    for (let x = w; weeks.has(x); x = addDays(x, 7)) n++;
    best = Math.max(best, n);
  }
  return best;
}

export interface BadgeView {
  key: string;
  label: string;
  hint: string; // how to earn it
  earned: boolean;
  have: number;
  need: number;
}

export function progress(input: { played: Played[]; feedback: Pick<Feedback, "skills" | "created_at">[]; goal: number; now: Date }) {
  const { feedback, goal, now } = input;
  const played = [...input.played].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const perWeek = new Map<string, number>();
  for (const p of played) {
    const w = startOfWeek(dateKey(p.starts_at));
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  const weeks = new Set(perWeek.keys());
  const thisWeek = startOfWeek(dateKey(now));
  const goalWeeks = [...perWeek.values()].filter((n) => n >= goal).length;

  const marks = feedback.flatMap((f) => f.skills);
  const points = played.reduce((n, p) => n + POINTS[p.session_type], 0) + marks.length * POINTS.skill + goalWeeks * POINTS.goal;
  const level = levelFor(points);
  const into = points % POINTS_PER_LEVEL;
  const streak = streakWeeks(weeks, now);
  const bestStreak = Math.max(streak.weeks, longestRun(weeks));

  const fresh = now.getTime() - 7 * 86400000;
  const skills = SKILLS.map((s) => {
    const n = marks.filter((m) => m === s.key).length;
    const recent = feedback.some((f) => f.skills.includes(s.key) && new Date(f.created_at).getTime() >= fresh);
    return { ...s, level: Math.min(MAX_SKILL_LEVEL, 1 + n), recent };
  });

  const early = played.filter((p) => timeKey(p.starts_at) < "09:00").length;
  const late = played.filter((p) => timeKey(p.starts_at) >= "19:00").length;
  const comeback = played.some((p, i) => i > 0 && new Date(p.starts_at).getTime() - new Date(played[i - 1].starts_at).getTime() >= 28 * 86400000);
  const pa = played.filter((p) => p.session_type === "performance_accelerator").length;
  const atFive = skills.filter((s) => s.level >= 5).length;
  const badge = (key: string, label: string, hint: string, have: number, need: number): BadgeView => ({ key, label, hint, have: Math.min(have, need), need, earned: have >= need });
  const badges = [
    badge("first", "First hit", "Play your first session", played.length, 1),
    badge("s10", "10 sessions", "Play 10 sessions", played.length, 10),
    badge("streak4", "4-week streak", "Play 4 weeks in a row", bestStreak, 4),
    badge("accelerated", "Accelerated", "Play a Performance Accelerator", pa, 1),
    badge("coach_pick", "Coach's pick", "Have a coach move up one of your skills", marks.length, 1),
    badge("goal4", "Goal getter", "Hit your weekly goal 4 times", goalWeeks, 4),
    badge("s25", "25 sessions", "Play 25 sessions", played.length, 25),
    badge("streak8", "8-week streak", "Play 8 weeks in a row", bestStreak, 8),
    badge("early", "Early bird", "Play 3 sessions that start before 9am", early, 3),
    badge("night", "Night owl", "Play 3 sessions that start at 7pm or later", late, 3),
    badge("comeback", "Comeback", "Back after 4+ weeks away", comeback ? 1 : 0, 1),
    badge("all_round", "All-rounder", "Get every skill to level 5", atFive, SKILLS.length),
    badge("s50", "50 sessions", "Play 50 sessions", played.length, 50),
  ];

  return {
    points,
    level,
    level_name: levelName(level),
    into_level: into,
    to_next: POINTS_PER_LEVEL - into,
    // Counted in Group Sessions, the commonest way to earn.
    sessions_to_next: Math.ceil((POINTS_PER_LEVEL - into) / POINTS.group),
    played: played.length,
    streak_weeks: streak.weeks,
    freeze_left: streak.freeze_left,
    frozen_weeks: streak.frozen,
    goal,
    this_week: perWeek.get(thisWeek) ?? 0,
    goal_weeks: goalWeeks,
    skills,
    badges,
  };
}

export type Progress = ReturnType<typeof progress>;
