/**
 * UI Foundation v1 — Static Tailwind Class Mappings
 *
 * IMPORTANT:
 * All class strings in this module are complete, static literals so that
 * `@tailwindcss/cli` can detect them during build-time source scanning.
 * Never construct Tailwind classes via dynamic string interpolation
 * (e.g. avoid `bg-${color}-500` or `grid-cols-${count}`).
 * For continuous values (progress bars, coordinates), use CSS custom properties
 * (e.g. `style.setProperty('--stat-pct', value)`).
 */

export const BUTTON_BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-control border px-3.5 py-2 text-sm font-semibold tracking-wide transition-colors duration-150 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected disabled:bg-disabled disabled:text-disabled-fg disabled:border-disabled-border disabled:opacity-100 disabled:cursor-not-allowed';

export const BUTTON_VARIANT_CLASSES = Object.freeze({
  primary:
    'bg-accent text-fg-on-accent border-accent hover:bg-accent-hover active:bg-accent-active shadow-xs',
  secondary:
    'bg-panel-elevated text-fg border-panel-border-strong hover:bg-accent-soft hover:border-selected active:bg-panel',
  danger:
    'bg-danger text-fg-on-accent border-danger hover:bg-danger-hover active:bg-danger-surface shadow-xs',
  focusDemo:
    'bg-panel-elevated text-selected border-selected outline-2 outline-offset-2 outline-selected shadow-selected',
});

export const PANEL_SHELL_CLASSES = Object.freeze({
  primary:
    'bg-panel text-fg border border-panel-border rounded-panel p-3.5 shadow-panel',
  elevated:
    'bg-panel-elevated text-fg border border-panel-border-strong rounded-card p-3 shadow-card',
  inset:
    'bg-panel-inset text-fg-secondary border border-panel-border-subtle rounded-card p-2.5',
});

export const PLAYER_CARD_BASE_CLASSES =
  'group relative flex flex-col gap-2.5 rounded-card border p-3 text-left transition-all duration-150';

export const PLAYER_CARD_STATE_CLASSES = Object.freeze({
  normal:
    'bg-panel text-fg border-panel-border shadow-card hover:bg-panel-elevated hover:border-panel-border-strong cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected',
  selected:
    'bg-selected-surface text-fg border-selected shadow-selected cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected',
  unavailable:
    'bg-disabled text-disabled-fg border-disabled-border opacity-65 cursor-not-allowed select-none',
});

export const PLAYER_CARD_BADGE_STATE_CLASSES = Object.freeze({
  normal:
    'bg-panel-inset text-fg-muted border-panel-border-subtle',
  selected:
    'bg-accent-soft text-selected border-selected',
  unavailable:
    'bg-disabled text-disabled-fg border-disabled-border',
});

export const POSITION_BADGE_CLASSES = Object.freeze({
  GK: 'inline-flex items-center rounded-badge border border-pos-gk/45 bg-pos-gk/15 px-1.5 py-0.5 text-2xs font-bold tracking-wider text-pos-gk',
  DF: 'inline-flex items-center rounded-badge border border-pos-df/45 bg-pos-df/15 px-1.5 py-0.5 text-2xs font-bold tracking-wider text-pos-df',
  MF: 'inline-flex items-center rounded-badge border border-pos-mf/45 bg-pos-mf/15 px-1.5 py-0.5 text-2xs font-bold tracking-wider text-pos-mf',
  FW: 'inline-flex items-center rounded-badge border border-pos-fw/45 bg-pos-fw/15 px-1.5 py-0.5 text-2xs font-bold tracking-wider text-pos-fw',
});

export const ABILITY_TIER_CLASSES = Object.freeze({
  elite: {
    value: 'font-mono text-xs font-bold text-selected tabular-nums',
    bar: 'ui-stat-bar-fill h-full rounded-badge bg-selected',
  },
  high: {
    value: 'font-mono text-xs font-bold text-fg tabular-nums',
    bar: 'ui-stat-bar-fill h-full rounded-badge bg-accent',
  },
  standard: {
    value: 'font-mono text-xs font-semibold text-fg-secondary tabular-nums',
    bar: 'ui-stat-bar-fill h-full rounded-badge bg-fg-muted',
  },
  muted: {
    value: 'font-mono text-xs font-normal text-muted tabular-nums',
    bar: 'ui-stat-bar-fill h-full rounded-badge bg-panel-border-strong',
  },
});

export function getAbilityTierClasses(score) {
  const numeric = Number(score) || 0;
  if (numeric >= 88) return ABILITY_TIER_CLASSES.elite;
  if (numeric >= 78) return ABILITY_TIER_CLASSES.high;
  if (numeric >= 60) return ABILITY_TIER_CLASSES.standard;
  return ABILITY_TIER_CLASSES.muted;
}

export const GLOBAL_THEME_CLASSES = Object.freeze({
  hudPanel: 'bb-hud-panel bg-panel/85 text-fg border border-panel-border/70 rounded-panel shadow-panel',
  primaryGoldBtn: 'bb-btn-primary bg-season-gold text-canvas font-extrabold rounded-control shadow-card',
  accentCyanBtn: 'bb-btn-accent bg-accent text-fg-on-accent font-bold rounded-control',
});

