// ロビー（部屋を作る／入る／参加者の一覧／ゲーム開始）を担当するファイル。
// ふだんは書き換えなくてよい。ゲームの中身は game.js に書く。
import { createNet } from './net.js';
import { startGame } from './game.js';
import { getLocale, setLocale, t, subscribeLocaleChange } from './i18n/i18n.js';

const $ = (id) => document.getElementById(id);
const net = createNet();

let me = null;
let hostId = null;
let started = false;
let inRoom = false;
let helpExpandedInRoom = false;
let players = [];
let messageHandlers = [];
let playersHandlers = [];
let lastToastSpec = null; // { key, rawText }

// Map known server.js Japanese error messages to i18n keys without modifying server.js
const SERVER_ERROR_KEY_MAP = {
    '部屋が多すぎます。しばらくしてからやり直してください。': 'errors.tooManyRooms',
    '部屋が見つかりません。': 'errors.roomNotFound',
    'この部屋はもうゲームが始まっています。': 'errors.alreadyStarted',
    'この部屋は満員です。': 'errors.roomFull',
    'ゲームを始めるには2人以上必要です。': 'errors.needMinPlayers',
    '長い間動きがなかったので、部屋を閉じました。': 'errors.roomIdleClosed',
};

const params = new URLSearchParams(location.search);
if (params.get('room')) $('room-code').value = params.get('room').toUpperCase().slice(0, 4);
$('name').value = localStorage.getItem('battle-base-name') ?? '';

function renderToast() {
    const toastEl = $('toast');
    if (!toastEl) return;
    if (!lastToastSpec) {
        toastEl.textContent = '';
        toastEl.hidden = true;
        return;
    }
    const text = lastToastSpec.key ? t(lastToastSpec.key) : (lastToastSpec.rawText ?? '');
    toastEl.textContent = text;
    toastEl.hidden = !text;
}

function toastKey(key) {
    lastToastSpec = key ? { key } : null;
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
    if (toggleBtn) {
        toggleBtn.hidden = false;
        toggleBtn.setAttribute('aria-expanded', String(helpExpandedInRoom));
        toggleBtn.textContent = helpExpandedInRoom
            ? t('lobby.hideHelpBtn')
            : t('lobby.showHelpBtn');
    }
}

function applyLobbyTranslations() {
    document.title = t('lobby.pageTitle');
    if ($('app-heading')) $('app-heading').textContent = t('lobby.heading');
    if ($('lang-label')) $('lang-label').textContent = t('common.language');
    if ($('lang-select')) $('lang-select').value = getLocale();

    if ($('about-title')) $('about-title').textContent = t('lobby.aboutTitle');
    if ($('about-intro')) $('about-intro').textContent = t('lobby.aboutIntro');
    if ($('about-builtin-label')) $('about-builtin-label').textContent = t('lobby.aboutBuiltInLabel');
    if ($('about-builtin-text')) $('about-builtin-text').textContent = t('lobby.aboutBuiltInText');
    if ($('about-custom-label')) $('about-custom-label').textContent = t('lobby.aboutCustomLabel');
    if ($('about-custom-text')) $('about-custom-text').textContent = t('lobby.aboutCustomText');
    if ($('about-footer')) $('about-footer').textContent = t('lobby.aboutFooter');

    if ($('name-label')) $('name-label').textContent = t('lobby.nameLabel');
    if ($('name')) $('name').placeholder = t('lobby.namePlaceholder');
    if ($('create-btn')) $('create-btn').textContent = t('lobby.createRoomBtn');
    if ($('room-code')) $('room-code').placeholder = t('lobby.roomCodePlaceholder');
    if ($('join-btn')) $('join-btn').textContent = t('lobby.joinRoomBtn');

    if ($('room-code-label')) $('room-code-label').textContent = t('lobby.roomCodeLabel');
    if ($('copy-btn')) $('copy-btn').textContent = t('lobby.copyInviteBtn');
    if ($('start-btn')) $('start-btn').textContent = t('lobby.startGameBtn');
    if ($('back-btn')) $('back-btn').textContent = t('lobby.backToLobbyBtn');
    if ($('leave-btn')) $('leave-btn').textContent = t('lobby.leaveRoomBtn');

    syncAboutVisibility();
    renderRoom();
    renderToast();
}

function myName() {
    const name = $('name').value.trim();
    localStorage.setItem('battle-base-name', name);
    return name;
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
    // ゲーム中は、参加者の一覧をゲーム画面（game.js）にまかせて隠す
    list.hidden = started;
    const isHost = me === hostId;
    $('start-btn').hidden = started || !isHost;
    $('start-btn').disabled = players.length < 2;
    $('back-btn').hidden = !started || !isHost;
    const waitText = started
        ? ''
        : isHost
            ? (players.length < 2 ? t('lobby.waitNeedMorePlayers') : '')
            : t('lobby.waitForHost');
    $('wait-note').textContent = waitText;
    $('wait-note').hidden = !waitText;

    const roomSection = $('room');
    if (roomSection) {
        roomSection.classList.toggle('room--in-game', started);
    }
    document.body.classList.toggle('in-room', inRoom);
    document.body.classList.toggle('in-game', inRoom && started);
    if (!inRoom || !started) {
        document.body.classList.remove('in-draft', 'in-reveal', 'in-match', 'in-result');
    }
}

let activeGame = null;

function showRoom() {
    inRoom = true;
    helpExpandedInRoom = false;
    $('lobby').hidden = true;
    $('room').hidden = false;
    syncAboutVisibility();
}

function showLobby() {
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
    $('room').hidden = true;
    $('game-area').hidden = true;
    $('game-area').replaceChildren();
    $('lobby').hidden = false;
    document.body.classList.remove('in-room', 'in-game', 'in-draft', 'in-reveal', 'in-match', 'in-result');
    syncAboutVisibility();
}

if ($('help-toggle-btn')) {
    $('help-toggle-btn').addEventListener('click', () => {
        helpExpandedInRoom = !helpExpandedInRoom;
        syncAboutVisibility();
    });
}

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
    showLobby();
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
