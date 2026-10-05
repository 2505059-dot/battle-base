// ★ ここが「ゲームの中身」。自分たちのゲームを作るときは、このファイルを書き換える。
//
// startGame(ctx) は、ホストが「ゲームを始める」を押したときに全員の画面で呼ばれる。
// ctx に入っているもの:
//   ctx.area        ゲームを描く場所（<section>）
//   ctx.me          自分のID（例: 'p1'）
//   ctx.players     参加者の一覧 [{ id, name }, ...]
//   ctx.order       プレイヤーの順番（IDの配列。全員で同じ並び）
//   ctx.seed        全員で共通の乱数のタネ（同じ展開のゲームにしたいときに使う）
//   ctx.send(data)  自分以外の全員にデータを送る（数字・文字・配列・オブジェクトならOK）
//   ctx.onMessage(fn)  誰かが送ったデータを受け取る。fn({ from, payload })
//   ctx.onPlayers(fn)  参加者が増減したとき。fn(players)
//
// 注意: 名前など、他の人から届いた文字は textContent で表示する（innerHTML に入れない）。
//
// ---- サンプル: ターン制のすごろく（ゴールは20マス）----
// 順番に自分の番でさいころを振る。振った結果は全員に送り、全員の画面で同じ計算をする。

const GOAL = 20;

export function startGame(ctx) {
    const pos = Object.fromEntries(ctx.order.map((id) => [id, 0]));
    let players = ctx.players;
    let turn = 0;
    let winner = null;

    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    const title = el('h2', 'すごろく（ゴール: ' + GOAL + 'マス）');
    const turnText = el('p', '');
    turnText.className = 'turn';
    const rollBtn = el('button', 'さいころを振る');
    const track = el('div', '');
    track.className = 'track';
    const log = el('div', '');
    log.id = 'game-log';
    ctx.area.append(title, turnText, rollBtn, track, log);

    const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '（退出）';
    // 今いる人だけで順番を回す
    const currentId = () => {
        const active = ctx.order.filter((id) => players.some((p) => p.id === id));
        return active[turn % active.length];
    };

    function draw() {
        track.replaceChildren();
        for (const id of ctx.order) {
            if (!players.some((p) => p.id === id)) continue;
            const lane = el('div', '');
            lane.className = 'lane';
            const label = el('div', `${nameOf(id)}${id === ctx.me ? '（あなた）' : ''}: ${pos[id]} / ${GOAL}`);
            const bar = el('div', '');
            bar.className = 'bar';
            bar.style.width = Math.min(100, (pos[id] / GOAL) * 100) + '%';
            lane.append(label, bar);
            track.append(lane);
        }
        if (winner) {
            turnText.textContent = `${nameOf(winner)} の勝ち！`;
        } else {
            turnText.textContent = currentId() === ctx.me ? 'あなたの番です' : `${nameOf(currentId())} の番です`;
        }
        rollBtn.disabled = !!winner || currentId() !== ctx.me;
    }

    // さいころの結果を反映する（自分が振ったときも、誰かから届いたときも、同じ関数を使う）
    function applyRoll(id, value) {
        if (winner || id !== currentId()) return;
        pos[id] += value;
        log.prepend(el('div', `${nameOf(id)} が ${value} を出した`));
        if (pos[id] >= GOAL) winner = id;
        else turn++;
        draw();
    }

    rollBtn.addEventListener('click', () => {
        if (currentId() !== ctx.me) return;
        const value = 1 + Math.floor(Math.random() * 6);
        ctx.send({ kind: 'roll', value });
        applyRoll(ctx.me, value);
    });

    ctx.onMessage(({ from, payload }) => {
        // 届いたデータは、形と値をたしかめてから使う
        if (payload?.kind === 'roll' && Number.isInteger(payload.value) && payload.value >= 1 && payload.value <= 6) {
            applyRoll(from, payload.value);
        }
    });
    ctx.onPlayers((list) => {
        players = list;
        draw();
    });

    draw();
}

function el(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
}
