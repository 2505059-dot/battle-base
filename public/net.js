// 通信を担当するファイル。ふだんは書き換えなくてよい（通信で困ったときだけ見る）。
// サーバーとの間で { type: '...', ... } という形のメッセージをやり取りする。
export function createNet() {
    const handlers = new Map(); // type -> [関数, ...]
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 画面を開いたURLと同じ場所に接続する（Codespacesの公開URLでもそのまま動く）
    const ws = new WebSocket(`${protocol}//${location.host}`);

    const opened = new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error('サーバーに接続できません')), { once: true });
    });

    ws.addEventListener('message', (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }
        for (const fn of handlers.get(msg.type) ?? []) fn(msg);
    });

    return {
        opened,
        // type のメッセージを受け取ったら fn を呼ぶ
        on(type, fn) {
            if (!handlers.has(type)) handlers.set(type, []);
            handlers.get(type).push(fn);
        },
        // サーバーへメッセージを送る
        send(type, data = {}) {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
        },
        onClose(fn) {
            ws.addEventListener('close', fn);
        },
    };
}
