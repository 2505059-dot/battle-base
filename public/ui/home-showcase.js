import { TEAM_SEASONS } from '../data/team-seasons.js';
import { getPlayerIdentityKey } from '../game/player-identity.js';
import { createPlayerPortrait, createClubCrest } from '../media/media-ui.js';
import { formatClubName, formatPlayerName, subscribeLocaleChange, t } from '../i18n/i18n.js';
import { getPitchSlotCoord } from '../game/shared/pitch-coords.js';
import { getPlayerOverall } from '../game/draft/rules.js';
import { formatSlotLabel, getSlotRole, SLOTS } from '../game/shared/constants.js';

const ROTATION_DELAY_MS = 8_750;
const MARQUEE_RESUME_DELAY_MS = 2_400;
const LINEUP_COUNT = 4;
const MAX_ASSIGNMENT_VISITS = 12_000;
const ROLE_ORDER = Object.freeze(['GK', 'DF', 'MF', 'FW']);

function randomIndex(rng, length) {
  const value = Number(rng());
  const normalized = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
  return Math.floor(normalized * length);
}

function shuffled(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(rng, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function assertCompleteLineup(slots) {
  if (slots.length !== 11 || new Set(slots.map((entry) => entry.identityKey)).size !== 11) {
    throw new Error('[home-showcase] A featured XI must contain 11 distinct player identities.');
  }
  const counts = Object.fromEntries(ROLE_ORDER.map((role) => [role, 0]));
  for (const entry of slots) {
    const role = getSlotRole(entry.slot);
    if (!role || !entry.player.positions?.includes(role)) {
      throw new Error(`[home-showcase] ${entry.player.name} is not eligible for ${entry.slot}.`);
    }
    counts[role] += 1;
  }
  if (counts.GK !== 1 || counts.DF !== 4 || counts.MF !== 3 || counts.FW !== 3) {
    throw new Error(`[home-showcase] Unexpected 4-3-3 role counts: ${JSON.stringify(counts)}.`);
  }
}

/** Build one random 4-3-3 solely from real, position-eligible season players. */
export function buildFeaturedLineup(teamSeasons = TEAM_SEASONS, rng = Math.random) {
  const sourcePlayers = [];
  for (const season of teamSeasons) {
    for (const player of season?.players ?? []) {
      const identityKey = getPlayerIdentityKey(player);
      if (!identityKey || !ROLE_ORDER.some((role) => player.positions?.includes(role))) continue;
      sourcePlayers.push({ player, identityKey, teamSeasonId: season.id });
    }
  }

  const candidatesByRole = new Map(
    ROLE_ORDER.map((role) => [
      role,
      shuffled(sourcePlayers.filter((entry) => entry.player.positions?.includes(role)), rng),
    ])
  );
  const identityCounts = new Map(
    ROLE_ORDER.map((role) => [
      role,
      new Set(candidatesByRole.get(role).map((entry) => entry.identityKey)).size,
    ])
  );
  const slotOrder = [...SLOTS].sort(
    (left, right) => identityCounts.get(getSlotRole(left)) - identityCounts.get(getSlotRole(right))
  );
  const selected = new Map();
  const usedIdentities = new Set();
  let assignmentVisits = 0;

  function assignSlot(index) {
    if (index === slotOrder.length) return true;
    assignmentVisits += 1;
    if (assignmentVisits > MAX_ASSIGNMENT_VISITS) return false;
    const slot = slotOrder[index];
    const role = getSlotRole(slot);
    for (const entry of candidatesByRole.get(role)) {
      if (usedIdentities.has(entry.identityKey)) continue;
      usedIdentities.add(entry.identityKey);
      selected.set(slot, entry);
      if (assignSlot(index + 1)) return true;
      selected.delete(slot);
      usedIdentities.delete(entry.identityKey);
    }
    return false;
  }

  if (!assignSlot(0)) {
    throw new Error('[home-showcase] The player dataset cannot fill a valid, identity-unique 4-3-3.');
  }
  const lineup = SLOTS.map((slot) => ({ slot, ...selected.get(slot) }));
  assertCompleteLineup(lineup);
  return lineup;
}

function buildRandomLineups(rng = Math.random) {
  const lineups = [];
  const signatures = new Set();
  for (let attempt = 0; lineups.length < LINEUP_COUNT && attempt < LINEUP_COUNT * 12; attempt += 1) {
    let lineup;
    try {
      lineup = buildFeaturedLineup(TEAM_SEASONS, rng);
    } catch (error) {
      if (lineups.length === 0) throw error;
      break;
    }
    const signature = lineupSignature(lineup);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    lineups.push(lineup);
  }
  while (lineups.length < LINEUP_COUNT) lineups.push([...lineups[lineups.length - 1]]);
  return lineups;
}

function lineupSignature(lineup) {
  return lineup.map((entry) => entry.identityKey).sort().join('|');
}

function makeElement(tagName, className, text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function clubAbbreviation(canonicalClub) {
  const normalized = String(canonicalClub ?? '').trim();
  const words = normalized.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 3).map((word) => Array.from(word)[0]).join('').toUpperCase();
  return Array.from(words[0] ?? '').slice(0, 3).join('').toUpperCase();
}

function createPlayerCard(entry, { duplicate = false } = {}) {
  const role = getSlotRole(entry.slot);
  const player = entry.player;
  const playerName = formatPlayerName(player.name);
  const clubName = formatClubName(player.club);
  const card = makeElement(
    'div',
    `bb-home-player bb-home-player--${role.toLowerCase()} bb-home-player--rail`
  );
  card.title = clubName;
  card.setAttribute('aria-label', `${playerName} · ${clubName} · ${player.year}`);
  card.dataset.homePlayerSeasonId = player.id;
  card.dataset.homePlayerIdentity = entry.identityKey;
  card.dataset.homeTeamSeasonId = entry.teamSeasonId;
  card.dataset.homeSlot = entry.slot;
  card.dataset.homeRole = role;
  card.dataset.homeClone = duplicate ? '1' : '0';
  card.setAttribute('role', 'listitem');
  if (duplicate) {
    card.setAttribute('aria-hidden', 'true');
    card.inert = true;
  }

  const avatar = makeElement('span', 'bb-home-player-avatar');
  avatar.setAttribute('aria-hidden', 'true');
  avatar.append(
    createPlayerPortrait(player, {
      className: 'bb-home-player-image',
      alt: '',
      loading: 'lazy',
    })
  );
  const details = makeElement('span', 'bb-home-player-details');
  details.append(
    makeElement('span', 'bb-home-player-name', playerName),
    makeElement('span', 'bb-home-player-season', `${clubAbbreviation(player.club)} · ${player.year}`)
  );
  card.append(avatar, details);

  return card;
}

function createPitchPlayer(entry) {
  const { player, slot, identityKey, teamSeasonId } = entry;
  const role = getSlotRole(slot);
  const roleKey = role.toLowerCase();
  const playerName = formatPlayerName(player.name);
  const clubName = formatClubName(player.club);
  const overall = getPlayerOverall(player);
  const node = makeElement('div', `bb-home-player bb-home-player--${roleKey}`);
  const coord = getPitchSlotCoord('single', 0, slot);
  node.style.left = coord.xPct;
  node.style.top = coord.yPct;
  node.dataset.homePlayerSeasonId = player.id;
  node.dataset.homePlayerIdentity = identityKey;
  node.dataset.homeTeamSeasonId = teamSeasonId;
  node.dataset.homeSlot = slot;
  node.dataset.homeRole = role;
  node.setAttribute('role', 'listitem');
  node.setAttribute(
    'aria-label',
    `${playerName} · ${clubName} · ${player.year} · ${t('common.overallRating', { rating: overall })} · ${formatSlotLabel(slot)}`
  );

  const figure = makeElement('span', 'fd-pitch-figure rv-single-figure');
  const portrait = createPlayerPortrait(player, {
    className: 'fd-slot-player-img fd-reveal-player-img',
    alt: '',
    loading: 'lazy',
  });
  const silhouette = portrait.classList?.contains('fd-player-img--silhouette');
  const avatar = makeElement(
    'span',
    `fd-pitch-avatar rv-single-avatar${silhouette ? ' fd-pitch-avatar--silhouette' : ''}`
  );
  avatar.setAttribute('aria-hidden', 'true');
  avatar.append(portrait);
  figure.append(avatar, makeElement('span', 'fd-pitch-rating fd-reveal-player-ovr', String(overall)));

  const namePill = makeElement('span', 'rv-single-label');
  namePill.append(makeElement('span', 'fd-pitch-name rv-single-name', playerName));

  const metaPill = makeElement('span', 'rv-single-meta');
  const crest = createClubCrest(player.club, {
    className: 'fd-reveal-club-crest rv-single-crest',
    alt: '',
    loading: 'lazy',
    wrapperEl: metaPill,
  });
  if (crest) metaPill.append(crest);
  else metaPill.classList.add('bb-home-meta--no-crest');
  const clubTag = makeElement('span', 'bb-home-player-club-tag', clubAbbreviation(player.club));
  clubTag.title = clubName;
  clubTag.setAttribute('aria-hidden', 'true');
  metaPill.title = clubName;
  metaPill.append(
    clubTag,
    makeElement('span', 'rv-single-year', `'${String(player.year).slice(-2)}`),
    makeElement('span', 'rv-single-slot fd-reveal-slot-tag', formatSlotLabel(slot))
  );

  node.append(figure, namePill, metaPill);
  return node;
}

function localizedLabel(element, key) {
  if (element) element.setAttribute('aria-label', t(key));
}

function initHomeShowcase() {
  const home = document.getElementById('home');
  const pitch = document.getElementById('home-pitch');
  const stage = document.getElementById('home-showcase-stage');
  const marquee = document.getElementById('home-player-marquee');
  const track = document.getElementById('home-player-marquee-track');
  if (!home || !pitch || !stage || !marquee || !track) return;

  const lineups = buildRandomLineups();
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileViewport = window.matchMedia('(max-width: 640px)');
  const desktopToggle = document.getElementById('home-showcase-toggle');
  const desktopToggleIcon = document.getElementById('home-showcase-toggle-icon');
  const mobileToggle = document.getElementById('home-showcase-mobile-toggle');
  const mobileHeading = document.getElementById('home-player-marquee-heading');
  let activeLineupIndex = 0;
  let activeLayer = null;
  let rotationTimer = null;
  let transitionTimer = null;
  let marqueeResumeTimer = null;
  let hovered = false;
  let focused = false;
  let pointerHeld = false;
  let manualPaused = false;
  let marqueeHovered = false;
  let marqueeFocused = false;

  const isHomeVisible = () =>
    !home.hidden && document.body.classList.contains('in-home') && document.visibilityState === 'visible';

  function finishTransition() {
    if (transitionTimer !== null) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    for (const leaving of pitch.querySelectorAll('.bb-home-lineup-layer.is-leaving')) leaving.remove();
    activeLayer?.classList.add('is-active');
    activeLayer?.removeAttribute('aria-hidden');
  }

  function makeLineupLayer(lineup, index) {
    const layer = makeElement('div', 'bb-home-lineup-layer');
    layer.dataset.homeLineupIndex = String(index);
    layer.setAttribute('role', 'list');
    layer.setAttribute('aria-label', t('home.showcaseLineupLabel'));
    for (const entry of lineup) layer.append(createPitchPlayer(entry));
    return layer;
  }

  function showLineup(index, animate = false) {
    const nextLayer = makeLineupLayer(lineups[index], index);
    if (activeLayer && animate && !motionPreference.matches && isHomeVisible()) {
      finishTransition();
      const previous = activeLayer;
      previous.classList.remove('is-active');
      previous.classList.add('is-leaving');
      previous.setAttribute('aria-hidden', 'true');
      pitch.append(nextLayer);
      activeLayer = nextLayer;
      window.requestAnimationFrame(() => nextLayer.classList.add('is-active'));
      transitionTimer = window.setTimeout(() => {
        previous.remove();
        transitionTimer = null;
      }, 620);
    } else {
      finishTransition();
      pitch.replaceChildren(nextLayer);
      activeLayer = nextLayer;
      nextLayer.classList.add('is-active');
    }
  }

  function renderMarquee() {
    const players = new Map();
    for (const lineup of lineups) {
      for (const entry of lineup) {
        if (!players.has(entry.identityKey)) players.set(entry.identityKey, entry);
      }
    }
    const featured = [...players.values()];
    const firstSet = document.createDocumentFragment();
    const repeatSet = document.createDocumentFragment();
    for (const entry of featured) {
      firstSet.append(createPlayerCard(entry));
      repeatSet.append(createPlayerCard(entry, { duplicate: true }));
    }
    track.replaceChildren(firstSet, repeatSet);
  }

  function renderLabels() {
    localizedLabel(stage, 'home.showcaseStageLabel');
    localizedLabel(pitch, 'home.showcaseLineupLabel');
    localizedLabel(marquee, 'home.showcasePlayersLabel');
    if (activeLayer) activeLayer.setAttribute('aria-label', t('home.showcaseLineupLabel'));
    if (mobileHeading) mobileHeading.textContent = t('home.showcasePlayersLabel');
    updateToggleLabels();
  }

  function updateToggleLabels() {
    const actionKey = manualPaused ? 'home.showcaseResumeAction' : 'home.showcasePauseAction';
    for (const button of [desktopToggle, mobileToggle]) {
      if (!button) continue;
      button.setAttribute('aria-label', t('home.showcaseToggleLabel'));
      button.setAttribute('aria-pressed', String(manualPaused));
      button.disabled = motionPreference.matches;
    }
    if (desktopToggleIcon) {
      desktopToggleIcon.textContent = motionPreference.matches ? '—' : manualPaused ? '▶' : 'Ⅱ';
    }
    if (mobileToggle) {
      mobileToggle.textContent = motionPreference.matches
        ? t('home.showcaseStaticAction')
        : t(actionKey);
    }
  }

  function syncMarqueePause() {
    marquee.classList.toggle(
      'is-paused',
      !isHomeVisible() ||
        !mobileViewport.matches ||
        motionPreference.matches ||
        manualPaused ||
        marqueeHovered ||
        marqueeFocused ||
        pointerHeld ||
        marqueeResumeTimer !== null
    );
  }

  function setManualPaused(paused) {
    manualPaused = Boolean(paused);
    updateToggleLabels();
    syncMarqueePause();
    syncLifecycle();
  }

  function clearRotation() {
    if (rotationTimer !== null) {
      window.clearTimeout(rotationTimer);
      rotationTimer = null;
    }
  }

  function canRotate() {
    return (
      isHomeVisible() &&
      !motionPreference.matches &&
      !mobileViewport.matches &&
      !manualPaused &&
      !hovered &&
      !focused
    );
  }

  function scheduleRotation() {
    if (rotationTimer !== null || !canRotate()) return;
    rotationTimer = window.setTimeout(() => {
      rotationTimer = null;
      if (!canRotate()) return;
      const nextIndex = (activeLineupIndex + 1) % lineups.length;
      try {
        const freshLineup = buildFeaturedLineup();
        if (lineupSignature(freshLineup) !== lineupSignature(lineups[activeLineupIndex])) {
          lineups[nextIndex] = freshLineup;
        }
      } catch {
        // Keep a previously validated lineup if random sampling cannot complete.
      }
      activeLineupIndex = nextIndex;
      showLineup(activeLineupIndex, true);
      scheduleRotation();
    }, ROTATION_DELAY_MS);
  }

  function syncLifecycle() {
    syncMarqueePause();
    if (canRotate()) {
      scheduleRotation();
      return;
    }
    clearRotation();
    if (!isHomeVisible() || motionPreference.matches || manualPaused) finishTransition();
  }

  function clearMarqueeResume() {
    if (marqueeResumeTimer !== null) {
      window.clearTimeout(marqueeResumeTimer);
      marqueeResumeTimer = null;
    }
  }

  function scheduleMarqueeResume() {
    clearMarqueeResume();
    marqueeResumeTimer = window.setTimeout(() => {
      marqueeResumeTimer = null;
      syncMarqueePause();
    }, MARQUEE_RESUME_DELAY_MS);
    syncMarqueePause();
  }

  stage.addEventListener('mouseenter', () => {
    hovered = true;
    syncLifecycle();
  });
  stage.addEventListener('mouseleave', () => {
    hovered = false;
    syncLifecycle();
  });
  stage.addEventListener('focusin', () => {
    focused = true;
    syncLifecycle();
  });
  stage.addEventListener('focusout', (event) => {
    if (event.relatedTarget && stage.contains(event.relatedTarget)) return;
    focused = false;
    syncLifecycle();
  });

  marquee.addEventListener('mouseenter', () => {
    marqueeHovered = true;
    syncMarqueePause();
  });
  marquee.addEventListener('mouseleave', () => {
    marqueeHovered = false;
    syncMarqueePause();
  });
  marquee.addEventListener('focusin', () => {
    marqueeFocused = true;
    syncMarqueePause();
    clearMarqueeResume();
  });
  marquee.addEventListener('focusout', (event) => {
    if (event.relatedTarget && marquee.contains(event.relatedTarget)) return;
    marqueeFocused = false;
    scheduleMarqueeResume();
  });
  mobileToggle?.addEventListener('focus', () => {
    marqueeFocused = true;
    syncMarqueePause();
  });
  mobileToggle?.addEventListener('blur', () => {
    marqueeFocused = false;
    scheduleMarqueeResume();
  });
  desktopToggle?.addEventListener('click', () => setManualPaused(!manualPaused));
  mobileToggle?.addEventListener('click', () => setManualPaused(!manualPaused));
  marquee.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    pointerHeld = true;
    syncMarqueePause();
    clearMarqueeResume();
  });
  marquee.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch') return;
    pointerHeld = false;
    scheduleMarqueeResume();
  });
  marquee.addEventListener('pointercancel', () => {
    pointerHeld = false;
    scheduleMarqueeResume();
  });
  marquee.addEventListener('scroll', () => {
    syncMarqueePause();
    if (!pointerHeld && !marquee.contains(document.activeElement)) scheduleMarqueeResume();
  }, { passive: true });

  const homeObserver = new MutationObserver(syncLifecycle);
  homeObserver.observe(home, { attributes: true, attributeFilter: ['hidden'] });
  homeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', syncLifecycle);
  motionPreference.addEventListener?.('change', syncLifecycle);
  motionPreference.addEventListener?.('change', updateToggleLabels);
  mobileViewport.addEventListener?.('change', syncLifecycle);
  subscribeLocaleChange(() => {
    renderLabels();
    showLineup(activeLineupIndex);
    renderMarquee();
  });

  renderLabels();
  showLineup(activeLineupIndex);
  renderMarquee();
  syncLifecycle();
}

if (typeof document !== 'undefined') initHomeShowcase();
