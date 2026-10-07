/**
 * UI Foundation v1 — Standalone Verification Preview
 *
 * Demonstrates only the three foundational UI swatches:
 * 1. Buttons (Normal, Hover, Focus, Disabled)
 * 2. Panels (Title, Body, Border & Surface Hierarchy)
 * 3. Player Cards (Portrait, Name, Season, Positions, Existing Abilities, Selected / Unavailable states)
 *
 * Security & Architecture:
 * - Uses `el()` and `.textContent` exclusively (zero `innerHTML`).
 * - Consumes `TEAM_SEASONS` and media/i18n helpers read-only.
 * - Preview state is strictly local; never invokes game transitions or network calls.
 */

import { TEAM_SEASONS } from '../data/team-seasons.js';
import { el } from '../game/shared/dom.js';
import { getPlayerOverall } from '../game/draft/rules.js';
import {
  createPlayerPortrait,
  createClubCrest,
  createLeagueEmblem,
} from '../media/media-ui.js';
import {
  SUPPORTED_LOCALES,
  getLocale,
  setLocale,
  subscribeLocaleChange,
  getPlayerDisplayName,
  formatClubName,
  formatLeagueName,
} from '../i18n/i18n.js';
import {
  BUTTON_BASE_CLASSES,
  BUTTON_VARIANT_CLASSES,
  PANEL_SHELL_CLASSES,
  PLAYER_CARD_BASE_CLASSES,
  PLAYER_CARD_STATE_CLASSES,
  PLAYER_CARD_BADGE_STATE_CLASSES,
  POSITION_BADGE_CLASSES,
  getAbilityTierClasses,
} from './foundation-tokens.js';

const LOCALE_LABELS = Object.freeze({
  ja: '日本語 (ja)',
  en: 'English (en)',
  'zh-CN': '简体中文 (zh-CN)',
});

function pickSamplePlayerSeasons() {
  const allPlayers = TEAM_SEASONS.flatMap((ts) => ts.players ?? []);
  const findByIdOrRole = (preferredId, roleFallback, usedIds) => {
    const exact = allPlayers.find((p) => p.id === preferredId && !usedIds.has(p.id));
    if (exact) {
      usedIds.add(exact.id);
      return exact;
    }
    const byRole = allPlayers.find(
      (p) => Array.isArray(p.positions) && p.positions.includes(roleFallback) && !usedIds.has(p.id)
    );
    if (byRole) {
      usedIds.add(byRole.id);
      return byRole;
    }
    const fallback = allPlayers.find((p) => !usedIds.has(p.id)) ?? allPlayers[0];
    if (fallback) usedIds.add(fallback.id);
    return fallback;
  };

  const used = new Set();
  const sampleSelected = findByIdOrRole('juventus-2017-7', 'FW', used);
  const sampleNormal = findByIdOrRole('ac-milan-2007-4', 'MF', used);
  const sampleUnavailable = findByIdOrRole('manchester-united-1999-0', 'GK', used);

  return [
    { player: sampleSelected, lockedUnavailable: false },
    { player: sampleNormal, lockedUnavailable: false },
    { player: sampleUnavailable, lockedUnavailable: true },
  ].filter((entry) => Boolean(entry.player));
}

function getReadOnlyAbilityList(player) {
  if (Array.isArray(player.positions) && player.positions.includes('GK')) {
    return [
      { key: 'GK', score: player.goalkeeping },
      { key: 'DEF', score: player.defense },
      { key: 'PHY', score: player.physical },
      { key: 'CRE', score: player.creation },
    ];
  }
  return [
    { key: 'ATK', score: player.attack },
    { key: 'CRE', score: player.creation },
    { key: 'DEF', score: player.defense },
    { key: 'PHY', score: player.physical },
  ];
}

const sampleEntries = pickSamplePlayerSeasons();

const previewState = {
  buttonActionCount: 0,
  lastActionLabel: 'None',
  selectedPlayerId: sampleEntries[0]?.player?.id ?? null,
};

function renderPreviewHeader() {
  const header = el(
    'header',
    'ui-panel-header-sheen mb-3.5 flex flex-col gap-2.5 rounded-panel border border-panel-border bg-panel px-4 py-3 shadow-panel sm:flex-row sm:items-center sm:justify-between'
  );
  header.dataset.previewSection = 'header';

  const titleGroup = el('div', 'flex flex-col gap-0.5');
  const badgeRow = el('div', 'flex items-center gap-2');
  badgeRow.append(
    el(
      'span',
      'inline-flex items-center rounded-badge border border-selected/40 bg-accent-soft px-2 py-0.5 text-2xs font-bold tracking-wider text-selected uppercase',
      'UI Foundation v1'
    ),
    el('span', 'text-xs text-muted', 'Tailwind CSS v4.3.3 · No Preflight · Layered Cascade')
  );
  const heading = el(
    'h1',
    'm-0 text-lg font-bold tracking-wide text-fg',
    'Tactical UI Foundation Verification'
  );
  titleGroup.append(badgeRow, heading);

  const controls = el('div', 'flex items-center gap-2.5');
  const langLabel = el('label', 'm-0 text-xs font-medium text-fg-secondary', 'Locale');
  langLabel.htmlFor = 'preview-lang-select';

  const langSelect = el(
    'select',
    'rounded-control border border-panel-border-strong bg-panel-inset px-2.5 py-1.5 text-xs font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-selected'
  );
  langSelect.id = 'preview-lang-select';
  const currentLocale = getLocale();
  for (const locale of SUPPORTED_LOCALES) {
    const opt = el('option', '', LOCALE_LABELS[locale] ?? locale);
    opt.value = locale;
    opt.selected = locale === currentLocale;
    langSelect.append(opt);
  }
  langSelect.addEventListener('change', (e) => {
    setLocale(e.target.value);
  });

  const hiddenProbe = el(
    'span',
    'flex items-center rounded-badge bg-accent px-2 py-1 text-xs',
    'Hidden attribute probe'
  );
  hiddenProbe.id = 'preview-hidden-probe';
  hiddenProbe.hidden = true;

  controls.append(langLabel, langSelect, hiddenProbe);
  header.append(titleGroup, controls);
  return header;
}

function renderButtonsSwatch(onTriggerUpdate) {
  const section = el('section', PANEL_SHELL_CLASSES.primary);
  section.id = 'swatch-buttons';
  section.dataset.swatch = 'buttons';

  const headerRow = el(
    'div',
    'mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-panel-border-subtle pb-2'
  );
  headerRow.append(
    el('h2', 'm-0 text-base font-bold tracking-wide text-fg', '1. Buttons (Normal / Hover / Focus / Disabled)'),
    el(
      'span',
      'font-mono text-xs text-muted',
      `Preview clicks: ${previewState.buttonActionCount} (${previewState.lastActionLabel})`
    )
  );

  const desc = el(
    'p',
    'mt-0 mb-2.5 text-xs text-fg-secondary',
    'Native <button> elements styled via @layer utilities overriding @layer legacy button rules without !important.'
  );

  const btnGrid = el('div', 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4');

  const btnPrimary = el(
    'button',
    `${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES.primary}`,
    'Primary Action (Normal / Hover)'
  );
  btnPrimary.type = 'button';
  btnPrimary.id = 'preview-btn-primary';
  btnPrimary.addEventListener('click', () => {
    previewState.buttonActionCount += 1;
    previewState.lastActionLabel = 'Primary';
    onTriggerUpdate();
  });

  const btnSecondary = el(
    'button',
    `${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES.secondary}`,
    'Tactical Panel Action (Hover)'
  );
  btnSecondary.type = 'button';
  btnSecondary.id = 'preview-btn-secondary';
  btnSecondary.addEventListener('click', () => {
    previewState.buttonActionCount += 1;
    previewState.lastActionLabel = 'Secondary';
    onTriggerUpdate();
  });

  const btnFocus = el(
    'button',
    `${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES.focusDemo}`,
    'Focus Ring Active State'
  );
  btnFocus.type = 'button';
  btnFocus.id = 'preview-btn-focus';
  btnFocus.addEventListener('click', () => {
    previewState.buttonActionCount += 1;
    previewState.lastActionLabel = 'Focus';
    onTriggerUpdate();
  });

  const btnDisabled = el(
    'button',
    `${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES.primary}`,
    'Disabled Action (Locked)'
  );
  btnDisabled.type = 'button';
  btnDisabled.id = 'preview-btn-disabled';
  btnDisabled.disabled = true;
  btnDisabled.addEventListener('click', () => {
    previewState.buttonActionCount += 1;
    previewState.lastActionLabel = 'DisabledShouldNeverRun';
    onTriggerUpdate();
  });

  btnGrid.append(btnPrimary, btnSecondary, btnFocus, btnDisabled);
  section.append(headerRow, desc, btnGrid);
  return section;
}

function renderPanelsSwatch() {
  const section = el('section', PANEL_SHELL_CLASSES.primary);
  section.id = 'swatch-panels';
  section.dataset.swatch = 'panels';

  const headerRow = el(
    'div',
    'mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-panel-border-subtle pb-2'
  );
  headerRow.append(
    el('h2', 'm-0 text-base font-bold tracking-wide text-fg', '2. Panels (Title / Body / Border & Surface Hierarchy)'),
    el(
      'span',
      'inline-flex items-center rounded-badge border border-panel-border-strong bg-panel-elevated px-2 py-0.5 font-mono text-2xs text-fg-secondary',
      'bg-panel → bg-panel-elevated → bg-panel-inset'
    )
  );

  const bodyLead = el(
    'p',
    'mt-0 mb-2.5 text-sm text-fg-secondary',
    'Demonstrates semantic surface tiers, border contrast tokens, and typography hierarchy on <section> containers.'
  );

  const tierGrid = el('div', 'grid grid-cols-1 gap-3 md:grid-cols-2');

  const elevatedPanel = el('section', PANEL_SHELL_CLASSES.elevated);
  elevatedPanel.id = 'preview-panel-elevated';
  const elevatedHead = el('div', 'mb-2 flex items-center justify-between gap-2');
  elevatedHead.append(
    el('h3', 'm-0 text-sm font-bold text-fg', 'Elevated Tactical Sub-Panel'),
    el(
      'span',
      'rounded-badge border border-selected/40 bg-accent-soft px-1.5 py-0.5 text-2xs font-semibold text-selected',
      'Tier 2 · Elevated'
    )
  );
  const elevatedBody = el(
    'p',
    'm-0 text-xs leading-relaxed text-fg-secondary',
    'Used for active sub-containers, squad summary headers, and interactive drawers with strong border contrast.'
  );

  const nestedInset = el('div', `${PANEL_SHELL_CLASSES.inset} mt-3`);
  nestedInset.id = 'preview-panel-inset';
  nestedInset.append(
    el('div', 'text-2xs font-bold tracking-wider text-muted uppercase', 'Tier 3 · Inset Data Well'),
    el(
      'p',
      'mt-1 mb-0 text-xs text-fg-secondary',
      'Recessed surface (--color-panel-inset) for stat rows, slot counters, and compact metadata.'
    )
  );
  elevatedPanel.append(elevatedHead, elevatedBody, nestedInset);

  const statusPanel = el('section', PANEL_SHELL_CLASSES.elevated);
  statusPanel.id = 'preview-panel-tokens';
  statusPanel.append(
    el('h3', 'm-0 mb-2 text-sm font-bold text-fg', 'Semantic Token Contrast Check'),
    el(
      'p',
      'mt-0 mb-2.5 text-xs text-muted',
      'All colors reference semantic CSS custom properties mapped via @theme.'
    )
  );
  const tokenRows = el('div', 'grid grid-cols-2 gap-2');
  const tokenItems = [
    { label: 'Primary Text', cls: 'bg-panel-inset border-panel-border-subtle text-fg' },
    { label: 'Muted Text', cls: 'bg-panel-inset border-panel-border-subtle text-muted' },
    { label: 'Selected State', cls: 'bg-selected-surface border-selected text-selected' },
    { label: 'Danger State', cls: 'bg-danger-surface border-danger text-fg' },
  ];
  for (const item of tokenItems) {
    tokenRows.append(
      el(
        'div',
        `rounded-badge border px-2.5 py-1.5 text-xs font-semibold ${item.cls}`,
        item.label
      )
    );
  }
  statusPanel.append(tokenRows);

  tierGrid.append(elevatedPanel, statusPanel);
  section.append(headerRow, bodyLead, tierGrid);
  return section;
}

function renderPlayerCardItem(entry, onSelectCard) {
  const { player, lockedUnavailable } = entry;
  const isSelected = !lockedUnavailable && previewState.selectedPlayerId === player.id;
  const stateKey = lockedUnavailable ? 'unavailable' : isSelected ? 'selected' : 'normal';
  const stateClasses = PLAYER_CARD_STATE_CLASSES[stateKey];
  const badgeClasses = PLAYER_CARD_BADGE_STATE_CLASSES[stateKey];

  const card = el('article', `${PLAYER_CARD_BASE_CLASSES} ${stateClasses}`);
  card.dataset.playerCard = player.id;
  card.dataset.cardState = stateKey;
  card.tabIndex = lockedUnavailable ? -1 : 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  card.setAttribute('aria-disabled', lockedUnavailable ? 'true' : 'false');

  // Top bar: Positions, Season Year Badge, and State Tag
  const topBar = el('div', 'flex items-center justify-between gap-2');
  const posGroup = el('div', 'flex flex-wrap items-center gap-1');
  for (const pos of player.positions) {
    const posCls = POSITION_BADGE_CLASSES[pos] ?? POSITION_BADGE_CLASSES.MF;
    posGroup.append(el('span', posCls, pos));
  }

  const rightMeta = el('div', 'flex items-center gap-1.5');
  const seasonBadge = el(
    'span',
    'inline-flex items-center rounded-badge border border-season-gold/45 bg-season-surface px-1.5 py-0.5 font-mono text-2xs font-bold text-season-gold',
    String(player.year)
  );
  const stateLabelText = lockedUnavailable
    ? 'UNAVAILABLE'
    : isSelected
      ? 'SELECTED ✓'
      : 'SELECTABLE';
  const stateBadge = el(
    'span',
    `inline-flex items-center rounded-badge border px-1.5 py-0.5 font-mono text-2xs font-bold ${badgeClasses}`,
    stateLabelText
  );
  rightMeta.append(seasonBadge, stateBadge);
  topBar.append(posGroup, rightMeta);

  // Middle bar: Portrait + Identity + OVR
  const heroRow = el(
    'div',
    'ui-card-portrait-well relative flex items-center gap-3 rounded-card border border-panel-border-subtle p-2.5'
  );
  const portraitWrap = el(
    'div',
    'relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control border border-panel-border bg-panel-inset'
  );
  const portraitImg = createPlayerPortrait(player, {
    className: 'h-14 w-14 object-contain',
    loading: 'eager',
  });
  portraitWrap.append(portraitImg);

  const identityCol = el('div', 'flex min-w-0 flex-1 flex-col gap-0.5');
  const displayName = getPlayerDisplayName(player.name);
  const primaryName = el('div', 'truncate text-sm font-bold text-fg', displayName.primary);
  identityCol.append(primaryName);
  if (displayName.secondary) {
    identityCol.append(
      el('div', 'truncate text-2xs text-muted', displayName.secondary)
    );
  }

  const clubRow = el('div', 'mt-1 flex items-center gap-1.5 text-xs text-fg-secondary');
  const clubCrest = createClubCrest(player.club, {
    className: 'h-4 w-4 shrink-0 object-contain',
    loading: 'eager',
    wrapperEl: clubRow,
  });
  if (clubCrest) clubRow.append(clubCrest);
  clubRow.append(el('span', 'truncate font-medium', formatClubName(player.club)));

  const leagueRow = el('div', 'flex items-center gap-1.5 text-2xs text-muted');
  const leagueEmblem = createLeagueEmblem(player.league, {
    className: 'h-3.5 w-3.5 shrink-0 object-contain',
    loading: 'eager',
    wrapperEl: leagueRow,
  });
  if (leagueEmblem) leagueRow.append(leagueEmblem);
  leagueRow.append(el('span', 'truncate', formatLeagueName(player.league)));

  identityCol.append(clubRow, leagueRow);

  const ovrBox = el(
    'div',
    'flex shrink-0 flex-col items-center justify-center rounded-control border border-panel-border-strong bg-panel-inset px-2.5 py-1.5'
  );
  ovrBox.append(
    el('span', 'text-2xs font-bold tracking-wider text-muted uppercase', 'OVR'),
    el('span', 'font-mono text-ovr font-extrabold text-selected tabular-nums', String(getPlayerOverall(player)))
  );

  heroRow.append(portraitWrap, identityCol, ovrBox);

  // Ability list (read-only from existing PlayerSeason stats)
  const statsContainer = el(
    'div',
    'grid grid-cols-2 gap-2 rounded-control border border-panel-border-subtle bg-panel-inset p-2.5'
  );
  for (const stat of getReadOnlyAbilityList(player)) {
    const tier = getAbilityTierClasses(stat.score);
    const statCell = el('div', 'flex flex-col gap-1');
    const statLabelRow = el('div', 'flex items-center justify-between text-2xs');
    statLabelRow.append(
      el('span', 'font-semibold tracking-wider text-muted', stat.key),
      el('span', tier.value, String(stat.score))
    );
    const barTrack = el('div', 'h-1.5 w-full overflow-hidden rounded-badge bg-panel');
    const barFill = el('div', tier.bar);
    barFill.style.setProperty('--stat-pct', String(Math.max(0, Math.min(100, Number(stat.score) || 0))));
    barTrack.append(barFill);
    statCell.append(statLabelRow, barTrack);
    statsContainer.append(statCell);
  }

  card.append(topBar, heroRow, statsContainer);

  if (!lockedUnavailable) {
    const handleActivate = () => onSelectCard(player.id);
    card.addEventListener('click', handleActivate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    });
  }

  return card;
}

function renderPlayerCardsSwatch(onTriggerUpdate) {
  const section = el('section', PANEL_SHELL_CLASSES.primary);
  section.id = 'swatch-player-cards';
  section.dataset.swatch = 'player-cards';

  const headerRow = el(
    'div',
    'mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-panel-border-subtle pb-2'
  );
  headerRow.append(
    el(
      'h2',
      'm-0 text-base font-bold tracking-wide text-fg',
      '3. Player Cards (Portrait / Season / Positions / Read-Only Abilities / States)'
    ),
    el(
      'span',
      'font-mono text-xs text-selected',
      `Selected ID: ${previewState.selectedPlayerId ?? 'none'}`
    )
  );

  const desc = el(
    'p',
    'mt-0 mb-2.5 text-xs text-fg-secondary',
    'Read-only PlayerSeason records rendered with createPlayerPortrait(), createClubCrest(), and static Tailwind state maps. Click selectable cards to toggle selection; the third card is locked in the unavailable state.'
  );

  const cardsGrid = el('div', 'grid grid-cols-1 gap-3.5 md:grid-cols-3');
  const handleSelectCard = (playerId) => {
    previewState.selectedPlayerId = playerId;
    onTriggerUpdate();
  };

  for (const entry of sampleEntries) {
    cardsGrid.append(renderPlayerCardItem(entry, handleSelectCard));
  }

  section.append(headerRow, desc, cardsGrid);
  return section;
}

function renderApp() {
  const root = document.getElementById('ui-foundation-root');
  if (!root) return;

  const stack = el('div', 'flex flex-col gap-3.5');
  stack.append(
    renderButtonsSwatch(renderApp),
    renderPanelsSwatch(),
    renderPlayerCardsSwatch(renderApp)
  );

  root.replaceChildren(renderPreviewHeader(), stack);
}

subscribeLocaleChange(() => {
  renderApp();
});

renderApp();
