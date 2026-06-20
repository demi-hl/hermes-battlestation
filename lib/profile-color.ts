// Deterministic per-profile color. The SAME profile name always maps to the
// SAME tint everywhere it renders (bottom-bar chip, ProfileSheet rows, Sessions
// filter chips), so a profile is identifiable at a glance across the app. Same
// hash + palette family as the repo-avatar tints for visual consistency.

const PROFILE_TINTS = [
  "#7dd3fc", // sky
  "#c4b5fd", // violet
  "#86efac", // green
  "#fca5a5", // red
  "#fcd34d", // amber
  "#f9a8d4", // pink
  "#5eead4", // teal
  "#fdba74", // orange
  "#a5b4fc", // indigo
  "#d8b4fe", // purple
];

export function profileTint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROFILE_TINTS[h % PROFILE_TINTS.length];
}
