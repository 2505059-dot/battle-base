// ERA DERBY Product Shell Controller (HOME / Game Lobby / Room Waiting / Game Session)
import { createNet } from './net.js';
import { startGame } from './game.js';
import { getLocale, setLocale, t, subscribeLocaleChange } from './i18n/i18n.js';

const $ = (id) => document.getElementById(id);
const net = createNet();

const GUEST_STORAGE_KEY = 'battle-base-name';

const COMING_SOON_MODE_KEY_MAP = {
    challenge120: 'home.challenge120',
    teamDatabase: 'home.teamDatabase',
    matchmaking: 'home.matchmaking',
    accountLogin: 'home.accountLoginLabel',
};

let pageView = 'HOME'; // 'HOME' | 'ROOM_ENTRY' | 'ROOM_WAITING' | 'GAME'
let me = null;
let hostId = null;
let started = false;
let inRoom = false;
let helpExpandedInRoom = false;
let lastHelpTrigger = null;
let players = [];
let messageHandlers = [];
let playersHandlers = [];
let lastToastSpec = null; // { key, params, rawText }
let activeGame = null;

// Map known server.js Japanese error messages to i18n keys without modifying server.js
const SERVER_ERROR_KEY_MAP = {
    '部屋が多すぎます。しばらくしてからやり直してください。': 'errors.tooManyRooms',
    '部屋が見つかりません。': 'errors.roomNotFound',
    'この部屋はもうゲームが始まっています。': 'errors.alreadyStarted',
    'この部屋は満員です。': 'errors.roomFull',
    'ゲームを始めるには2人以上必要です。': 'errors.needMinPlayers',
    '長い間動きがなかったので、部屋を閉じました。': 'errors.roomIdleClosed',
};

function readStoredGuestName() {
    try {
        return (localStorage.getItem(GUEST_STORAGE_KEY) ?? '').trim().slice(0, 12);
    } catch {
        return '';
    }
}

function writeStoredGuestName(name) {
    const clean = String(name ?? '').trim().slice(0, 12);
    try {
        localStorage.setItem(GUEST_STORAGE_KEY, clean);
    } catch {
        // Ignore storage errors in restricted environments
    }
    return clean;
}

function syncGuestProfileUI(nameValue, { skipInputId = null } = {}) {
    const clean = String(nameValue ?? '').trim().slice(0, 12);
    const hasName = clean.length > 0;

    if (skipInputId !== 'name' && $('name')) {
        $('name').value = clean;
    }
    if (skipInputId !== 'home-name-input' && $('home-name-input')) {
        $('home-name-input').value = clean;
    }

    const currentValEl = $('home-current-name-value');
    if (currentValEl) {
        currentValEl.textContent = hasName ? clean : t('home.nameUnset');
        currentValEl.classList.toggle('is-unset', !hasName);
    }

    const guideEl = $('home-name-guide');
    if (guideEl) {
        guideEl.textContent = hasName ? t('home.nameGuideSet') : t('home.nameGuideUnset');
    }

    const topbarGuestBtn = $('topbar-guest-btn');
    const topbarGuestName = $('topbar-guest-name');
    if (topbarGuestName) {
        topbarGuestName.textContent = hasName ? clean : t('home.topbarGuestUnset');
    }
    if (topbarGuestBtn) {
        topbarGuestBtn.classList.toggle('is-unset', !hasName);
    }
}

function saveGuestName(rawName, { showToast = false, skipInputId = null } = {}) {
    const clean = writeStoredGuestName(rawName);
    syncGuestProfileUI(clean, { skipInputId });
    const profileCard = $('home-profile-card');
    if (profileCard && showToast) {
        profileCard.classList.remove('is-editing');
    }
    if (showToast) {
        if (clean) {
            toastKey('home.toastNameSaved', { name: clean });
        } else {
            toastKey('home.toastNameCleared');
        }
    }
    return clean;
}

function myName() {
    const raw = $('name') ? $('name').value : readStoredGuestName();
    const clean = saveGuestName(raw, { showToast: false });
    return clean || t('home.guest');
}

function resolveToastParams(params) {
    if (!params || typeof params !== 'object') return {};
    const resolved = { ...params };
    if (resolved.modeKey) {
        resolved.mode = t(resolved.modeKey);
    }
    return resolved;
}

function renderToast() {
    const toastEl = $('toast');
    if (!toastEl) return;
    if (!lastToastSpec) {
        toastEl.textContent = '';
        toastEl.hidden = true;
        return;
    }
    const text = lastToastSpec.key
        ? t(lastToastSpec.key, resolveToastParams(lastToastSpec.params))
        : (lastToastSpec.rawText ?? '');
    toastEl.textContent = text;
    toastEl.hidden = !text;
}

function toastKey(key, params = {}) {
    lastToastSpec = key ? { key, params } : null;
    renderToast();
}

function toastRaw(text) {
    if (!text) {
        lastToastSpec = null;
    } else if (SERVER_ERROR_KEY_MAP[text]) {
        lastToastSpec = { key: SERVER_ERROR_KEY_MAP[text] };
    } else {
        lastToastSpec = { rawText: text };
    }
    renderToast();
}

function syncAboutVisibility() {
    const aboutEl = $('about');
    const toggleBtn = $('help-toggle-btn');
    if (!aboutEl) return;

    aboutEl.hidden = !helpExpandedInRoom;
    document.body.classList.toggle('guide-open', helpExpandedInRoom);
    if (toggleBtn) {
        toggleBtn.hidden = false;
        toggleBtn.setAttribute('aria-expanded', String(helpExpandedInRoom));
        toggleBtn.textContent = helpExpandedInRoom
            ? t('lobby.hideHelpBtn')
            : t('lobby.showHelpBtn');
    }
}

function openAboutModal(triggerEl = null) {
    lastHelpTrigger = triggerEl || document.activeElement;
    helpExpandedInRoom = true;
    syncAboutVisibility();
    const closeBtn = $('about-close-btn');
    if (closeBtn && typeof closeBtn.focus === 'function') {
        closeBtn.focus();
    }
}

function closeAboutModal() {
    if (!helpExpandedInRoom) return;
    helpExpandedInRoom = false;
    syncAboutVisibility();
    if (lastHelpTrigger && typeof lastHelpTrigger.focus === 'function') {
        lastHelpTrigger.focus();
    }
    lastHelpTrigger = null;
}

function syncPageState() {
    if ($('home')) $('home').hidden = pageView !== 'HOME';
    if ($('lobby')) $('lobby').hidden = pageView !== 'ROOM_ENTRY';
    if ($('room')) $('room').hidden = pageView !== 'ROOM_WAITING' && pageView !== 'GAME';
    if ($('game-area')) $('game-area').hidden = pageView !== 'GAME';

    document.body.classList.toggle('in-home', pageView === 'HOME');
    document.body.classList.toggle('in-lobby', pageView === 'ROOM_ENTRY');
    document.body.classList.toggle('in-room', pageView === 'ROOM_WAITING' || pageView === 'GAME');
    document.body.classList.toggle('in-game', pageView === 'GAME');

    if (pageView !== 'GAME') {
        document.body.classList.remove('in-draft', 'in-reveal', 'in-match', 'in-result');
    }
}

function setText(id, key) {
    const el = $(id);
    if (el) el.textContent = t(key);
}

function applyLobbyTranslations() {
    document.title = t('lobby.pageTitle');
    setText('app-heading', 'lobby.heading');
    setText('app-subtitle', 'lobby.brandSub');
    setText('topbar-badge', 'lobby.brandSlogan');
    setText('topbar-guest-tag', 'home.guest');
    setText('lang-label', 'common.language');
    if ($('lang-select')) $('lang-select').value = getLocale();

    // Formal 8-Step Game Guide (#about)
    setText('guide-badge', 'guide.badge');
    setText('about-title', 'lobby.aboutTitle');
    setText('about-close-btn', 'guide.closeBtn');
    setText('about-intro', 'lobby.aboutIntro');
    setText('about-builtin-label', 'lobby.aboutBuiltInLabel');
    setText('about-builtin-text', 'lobby.aboutBuiltInText');
    setText('about-custom-label', 'lobby.aboutCustomLabel');
    setText('about-custom-text', 'lobby.aboutCustomText');
    setText('about-footer', 'lobby.aboutFooter');
    setText('about-back-btn', 'guide.backBtn');

    for (let i = 1; i <= 8; i++) {
        setText(`guide-step${i}-title`, `guide.step${i}Title`);
        setText(`guide-step${i}-desc`, `guide.step${i}Desc`);
    }

    // ERA DERBY Home Main Menu (#home)
    setText('home-eyebrow', 'home.eyebrow');
    setText('home-archive-tag', 'home.archiveTag');
    setText('home-brand-sub', 'lobby.brandSub');
    setText('home-hero-desc', 'home.heroDesc');
    setText('home-spec1-title', 'home.spec1Title');
    setText('home-spec1-sub', 'home.spec1Sub');
    setText('home-spec2-title', 'home.spec2Title');
    setText('home-spec2-sub', 'home.spec2Sub');
    setText('home-spec3-title', 'home.spec3Title');
    setText('home-spec3-sub', 'home.spec3Sub');

    setText('home-lobby-live-badge', 'home.gameLobbyLiveBadge');
    setText('home-lobby-title', 'home.gameLobby');
    setText('home-lobby-sub', 'home.gameLobbySub');
    setText('home-lobby-desc', 'home.gameLobbyDesc');
    setText('enter-lobby-btn-text', 'home.enterLobbyBtn');

    setText('home-mode-120-badge', 'home.comingSoon');
    setText('home-mode-120-title', 'home.challenge120');
    setText('home-mode-120-desc', 'home.challenge120Desc');
    setText('home-mode-120-btn-text', 'home.comingSoon');

    setText('home-mode-db-badge', 'home.comingSoon');
    setText('home-mode-db-title', 'home.teamDatabase');
    setText('home-mode-db-desc', 'home.teamDatabaseDesc');
    setText('home-mode-db-btn-text', 'home.comingSoon');

    setText('home-mode-mm-badge', 'home.comingSoon');
    setText('home-mode-mm-title', 'home.matchmaking');
    setText('home-mode-mm-desc', 'home.matchmakingDesc');
    setText('home-mode-mm-btn-text', 'home.comingSoon');

    setText('home-profile-title', 'home.profileTitle');
    setText('home-guest-badge', 'home.guest');
    setText('home-current-name-label', 'home.currentNameLabel');
    setText('home-edit-name-btn', 'home.editNameBtn');
    setText('home-save-name-btn', 'home.saveNameBtn');
    if ($('home-name-input')) $('home-name-input').placeholder = t('home.nameInputPlaceholder');
    setText('home-guest-storage-note', 'home.guestStorageNote');
    setText('home-account-login-label', 'home.accountLoginLabel');
    setText('home-account-login-desc', 'home.accountLoginDesc');
    setText('home-account-login-badge', 'home.comingSoon');

    setText('home-guide-title', 'home.howToPlay');
    setText('home-guide-badge', 'home.guideAvailableBadge');
    setText('home-guide-desc', 'home.howToPlayDesc');
    setText('home-help-btn-text', 'home.openGuideBtn');

    // Sync native tooltips on Coming Soon cards
    for (const [key, i18nKey] of Object.entries(COMING_SOON_MODE_KEY_MAP)) {
        const el = document.querySelector(`[data-coming-soon="${key}"]`);
        if (el) {
            el.setAttribute('title', t('home.toastComingSoon', { mode: t(i18nKey) }));
        }
    }

    // Game Lobby / Room Entry (#lobby)
    setText('lobby-title', 'lobby.lobbyTitle');
    setText('lobby-subtitle', 'lobby.lobbySubtitle');
    setText('lobby-back-home-btn', 'lobby.backToHomeBtn');
    setText('lobby-create-title', 'lobby.createModeTitle');
    setText('lobby-create-desc', 'lobby.createModeDesc');
    setText('lobby-join-title', 'lobby.joinModeTitle');
    setText('lobby-join-desc', 'lobby.joinModeDesc');
    setText('name-label', 'lobby.nameLabel');
    if ($('name')) $('name').placeholder = t('lobby.namePlaceholder');
    setText('create-btn', 'lobby.createRoomBtn');
    if ($('room-code')) $('room-code').placeholder = t('lobby.roomCodePlaceholder');
    setText('join-btn', 'lobby.joinRoomBtn');

    // Room Waiting / In-Game Bar (#room)
    setText('room-code-label', 'lobby.roomCodeLabel');
    setText('copy-btn', 'lobby.copyInviteBtn');
    setText('start-btn', 'lobby.startGameBtn');
    setText('back-btn', 'lobby.backToLobbyBtn');
    setText('leave-btn', 'lobby.leaveRoomBtn');

    syncGuestProfileUI(readStoredGuestName());
    syncAboutVisibility();
    renderRoom();
    renderToast();
}

function renderRoom() {
    const list = $('players');
    if (!list) return;
    list.replaceChildren();
    for (const p of players) {
        const li = document.createElement('li');
        li.className = p.id === me ? 'bb-room-player bb-room-player--self' : 'bb-room-player';
        li.textContent = p.name + (p.id === me ? t('lobby.playerYouSuffix') : '');
        if (p.id === hostId) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = t('lobby.hostBadge');
            li.append(badge);
        }
        list.append(li);
    }
    list.hidden = started;
    const isHost = me === hostId;
    if ($('start-btn')) {
        $('start-btn').hidden = started || !isHost;
        $('start-btn').disabled = players.length < 2;
    }
    if ($('back-btn')) {
        $('back-btn').hidden = !started || !isHost;
    }
    const waitText = started
        ? ''
        : isHost
            ? (players.length < 2 ? t('lobby.waitNeedMorePlayers') : '')
            : t('lobby.waitForHost');
    if ($('wait-note')) {
        $('wait-note').textContent = waitText;
        $('wait-note').hidden = !waitText;
    }

    const roomSection = $('room');
    if (roomSection) {
        roomSection.classList.toggle('room--in-game', started);
    }

    if (inRoom) {
        pageView = started ? 'GAME' : 'ROOM_WAITING';
    }
    syncPageState();
}

function cleanupRoomSession() {
    if (activeGame && typeof activeGame.stop === 'function') {
        activeGame.stop();
        activeGame = null;
    }
    me = null;
    hostId = null;
    started = false;
    inRoom = false;
    helpExpandedInRoom = false;
    players = [];
    messageHandlers = [];
    playersHandlers = [];
    if ($('game-area')) {
        $('game-area').hidden = true;
        $('game-area').replaceChildren();
    }
}

function showHome() {
    cleanupRoomSession();
    pageView = 'HOME';
    syncGuestProfileUI(readStoredGuestName());
    syncPageState();
    syncAboutVisibility();
}

function showLobby() {
    cleanupRoomSession();
    pageView = 'ROOM_ENTRY';
    syncGuestProfileUI(readStoredGuestName());
    syncPageState();
    syncAboutVisibility();
}

function showRoom() {
    inRoom = true;
    helpExpandedInRoom = false;
    pageView = started ? 'GAME' : 'ROOM_WAITING';
    syncPageState();
    syncAboutVisibility();
}

// Initial URL invite parameter check (?room=XXXX)
const params = new URLSearchParams(location.search);
const rawRoomParam = (params.get('room') ?? '').trim();
const hasValidInviteRoom = /^[A-Za-z0-9]{1,4}$/.test(rawRoomParam);
if (hasValidInviteRoom && $('room-code')) {
    $('room-code').value = rawRoomParam.toUpperCase().slice(0, 4);
}
syncGuestProfileUI(readStoredGuestName());

if (hasValidInviteRoom) {
    showLobby();
} else {
    showHome();
}

// Navigation & Modal Event Listeners
if ($('enter-lobby-btn')) {
    $('enter-lobby-btn').addEventListener('click', () => {
        toastRaw('');
        showLobby();
    });
}

if ($('lobby-back-home-btn')) {
    $('lobby-back-home-btn').addEventListener('click', () => {
        if ($('name')) {
            saveGuestName($('name').value, { showToast: false });
        }
        toastRaw('');
        showHome();
    });
}

if ($('topbar-brand-home')) {
    const handleBrandClick = () => {
        if (!inRoom && pageView !== 'HOME') {
            if ($('name')) {
                saveGuestName($('name').value, { showToast: false });
            }
            toastRaw('');
            showHome();
        }
    };
    $('topbar-brand-home').addEventListener('click', handleBrandClick);
    $('topbar-brand-home').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleBrandClick();
        }
    });
}

// Guest Profile Controls
if ($('home-edit-name-btn')) {
    $('home-edit-name-btn').addEventListener('click', () => {
        const profileCard = $('home-profile-card');
        if (profileCard) profileCard.classList.add('is-editing');
        const input = $('home-name-input');
        if (input) {
            input.focus();
            input.select();
        }
    });
}

if ($('home-save-name-btn')) {
    $('home-save-name-btn').addEventListener('click', () => {
        const val = $('home-name-input') ? $('home-name-input').value : '';
        saveGuestName(val, { showToast: true });
    });
}

if ($('home-name-input')) {
    $('home-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveGuestName($('home-name-input').value, { showToast: true });
        }
    });
}

if ($('name')) {
    $('name').addEventListener('input', () => {
        saveGuestName($('name').value, { showToast: false, skipInputId: 'name' });
    });
}

if ($('topbar-guest-btn')) {
    $('topbar-guest-btn').addEventListener('click', () => {
        if (pageView === 'HOME') {
            const profileCard = $('home-profile-card');
            if (profileCard) profileCard.classList.add('is-editing');
            const input = $('home-name-input');
            if (input) {
                input.focus();
                input.select();
            }
        } else if (pageView === 'ROOM_ENTRY') {
            const input = $('name');
            if (input) {
                input.focus();
                input.select();
            }
        } else {
            const current = readStoredGuestName();
            if (current) {
                toastKey('home.toastNameSaved', { name: current });
            }
        }
    });
}

// Coming Soon Cards Feedback
for (const [key, modeKey] of Object.entries(COMING_SOON_MODE_KEY_MAP)) {
    const card = document.querySelector(`[data-coming-soon="${key}"]`);
    if (!card) continue;
    const triggerToast = () => {
        toastKey('home.toastComingSoon', { modeKey });
    };
    card.addEventListener('click', triggerToast);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            triggerToast();
        }
    });
}

// Game Guide (#about) Controls
if ($('help-toggle-btn')) {
    $('help-toggle-btn').addEventListener('click', () => {
        if (helpExpandedInRoom) {
            closeAboutModal();
        } else {
            openAboutModal($('help-toggle-btn'));
        }
    });
}

if ($('home-help-btn')) {
    $('home-help-btn').addEventListener('click', () => {
        openAboutModal($('home-help-btn'));
    });
}

if ($('about-close-btn')) {
    $('about-close-btn').addEventListener('click', () => {
        closeAboutModal();
    });
}

if ($('about-back-btn')) {
    $('about-back-btn').addEventListener('click', () => {
        closeAboutModal();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpExpandedInRoom) {
        e.preventDefault();
        closeAboutModal();
    }
});

document.addEventListener('click', (e) => {
    if (!helpExpandedInRoom) return;
    const aboutEl = $('about');
    const helpBtn = $('help-toggle-btn');
    const homeHelpBtn = $('home-help-btn');
    const target = e.target;
    if (
        aboutEl &&
        !aboutEl.contains(target) &&
        (!helpBtn || !helpBtn.contains(target)) &&
        (!homeHelpBtn || !homeHelpBtn.contains(target))
    ) {
        closeAboutModal();
    }
});

if ($('lang-select')) {
    $('lang-select').value = getLocale();
    $('lang-select').addEventListener('change', (e) => {
        setLocale(e.target.value);
    });
}

subscribeLocaleChange(() => {
    applyLobbyTranslations();
});

applyLobbyTranslations();

net.on('room_joined', (msg) => {
    me = msg.you;
    hostId = msg.hostId;
    players = msg.players;
    started = false;
    $('room-id').textContent = msg.roomId;
    toastRaw('');
    showRoom();
    renderRoom();
});

net.on('players', (msg) => {
    players = msg.players;
    hostId = msg.hostId;
    started = msg.started;
    renderRoom();
    for (const fn of playersHandlers) fn(players);
});

net.on('started', (msg) => {
    if (activeGame && typeof activeGame.stop === 'function') {
        activeGame.stop();
        activeGame = null;
    }
    started = true;
    players = msg.players;
    messageHandlers = [];
    playersHandlers = [];
    renderRoom();
    activeGame = startGame({
        area: $('game-area'),
        me,
        players,
        order: msg.order,
        seed: msg.seed,
        send: (payload) => net.send('send', { payload }),
        onMessage: (fn) => messageHandlers.push(fn),
        onPlayers: (fn) => playersHandlers.push(fn),
    });
});

net.on('message', (msg) => {
    for (const fn of messageHandlers) fn({ from: msg.from, payload: msg.payload });
});

net.on('lobby', () => {
    if (activeGame && typeof activeGame.stop === 'function') {
        activeGame.stop();
        activeGame = null;
    }
    started = false;
    $('game-area').hidden = true;
    $('game-area').replaceChildren();
    messageHandlers = [];
    playersHandlers = [];
    renderRoom();
});

net.on('error', (msg) => toastRaw(msg.message));

net.onClose(() => {
    if (inRoom) {
        showLobby();
    } else if (pageView === 'HOME') {
        showHome();
    } else {
        showLobby();
    }
    toastKey('lobby.toastDisconnected');
});

net.opened.catch(() => toastKey('lobby.toastConnectFailed'));

$('create-btn').addEventListener('click', () => net.send('create_room', { name: myName() }));
$('join-btn').addEventListener('click', () => {
    net.send('join_room', { roomId: $('room-code').value, name: myName() });
});
$('start-btn').addEventListener('click', () => net.send('start'));
$('back-btn').addEventListener('click', () => net.send('back_to_lobby'));
$('leave-btn').addEventListener('click', () => {
    net.send('leave_room');
    showLobby();
});
$('copy-btn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${$('room-id').textContent}`;
    try {
        await navigator.clipboard.writeText(url);
        toastKey('lobby.toastInviteCopied');
    } catch {
        toastRaw(url);
    }
});
