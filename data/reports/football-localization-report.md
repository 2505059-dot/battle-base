# Football Localization v1 — Audit & Coverage Report

## 1. Entity Localization Coverage Summary

| Entity Type | Total Entities | `en` Coverage | `zh-CN` Coverage | `ja` Coverage | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Players** | 418 | 418 / 418 (100%) | 418 / 418 (100%) | 418 / 418 (100%) | PASS |
| **Clubs** | 28 | 28 / 28 (100%) | 28 / 28 (100%) | 28 / 28 (100%) | PASS |
| **Leagues** | 7 | 7 / 7 (100%) | 7 / 7 (100%) | 7 / 7 (100%) | PASS |

## 2. Duplicate Primary Name & Alias Collision Audit

- **Duplicate `zh-CN` Primary Player Names**: 0
- **Duplicate `ja` Primary Player Names**: 0
- **Duplicate `zh-CN` Primary Club Names**: 0
- **Duplicate `ja` Primary Club Names**: 0
- **Cross-Entity Alias Collisions**: 0
- **Suspicious Names Detected**: 0

## 3. League Localizations (7 / 7)

| Entity ID | Canonical Name (`en`) | `zh-CN` | `ja` |
| :--- | :--- | :--- | :--- |
| `bundesliga` | Bundesliga | 德甲 | ブンデスリーガ |
| `eredivisie` | Eredivisie | 荷甲 | エールディヴィジ |
| `la-liga` | La Liga | 西甲 | ラ・リーガ |
| `ligue-1` | Ligue 1 | 法甲 | リーグ・アン |
| `premier-league` | Premier League | 英超 | プレミアリーグ |
| `primeira-liga` | Primeira Liga | 葡超 | プリメイラ・リーガ |
| `serie-a` | Serie A | 意甲 | セリエA |

## 4. Club Localizations (28 / 28)

| Entity ID | Canonical Name (`en`) | `zh-CN` | `ja` | `zh-CN` Aliases | `ja` Aliases |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ac-milan` | AC Milan | AC米兰 | ACミラン | 米兰 | ミラン |
| `ajax` | Ajax | 阿贾克斯 | アヤックス | 阿姆斯特丹阿贾克斯 | AFCアヤックス |
| `arsenal` | Arsenal | 阿森纳 | アーセナル | 枪手, 兵工厂 | アーセナルFC |
| `atalanta` | Atalanta | 亚特兰大 | アタランタ | 贝加莫亚特兰大 | アタランタBC |
| `atletico-madrid` | Atletico Madrid | 马德里竞技 | アトレティコ・マドリード | 马竞 | アトレティコ |
| `barcelona` | Barcelona | 巴塞罗那 | バルセロナ | 巴萨 | FCバルセロナ, バルサ |
| `bayer-leverkusen` | Bayer Leverkusen | 勒沃库森 | バイエル・レバークーゼン | 拜耳勒沃库森, 药厂 | レバークーゼン |
| `bayern-munich` | Bayern Munich | 拜仁慕尼黑 | バイエルン・ミュンヘン | 拜仁 | バイエルン |
| `benfica` | Benfica | 本菲卡 | ベンフィカ | 里斯本本菲卡 | SLベンフィカ |
| `borussia-dortmund` | Borussia Dortmund | 多特蒙德 | ボルシア・ドルトムント | 多特 | ドルトムント |
| `chelsea` | Chelsea | 切尔西 | チェルシー | 蓝军 | チェルシーFC |
| `deportivo-la-coruna` | Deportivo La Coruna | 拉科鲁尼亚 | デポルティーボ・ラ・コルーニャ | 拉科 | デポルティーボ |
| `inter-milan` | Inter Milan | 国际米兰 | インテル | 国米 | インテル・ミラノ |
| `juventus` | Juventus | 尤文图斯 | ユヴェントス | 尤文 | ユベントス, ユーヴェ |
| `lazio` | Lazio | 拉齐奥 | ラツィオ | 蓝鹰 | SSラツィオ |
| `leicester-city` | Leicester City | 莱斯特城 | レスター・シティ | 莱斯特, 蓝狐 | レスター |
| `lille` | Lille | 里尔 | リール | 里尔OSC | LOSCリール |
| `liverpool` | Liverpool | 利物浦 | リヴァプール | 红军 | リバプール |
| `manchester-city` | Manchester City | 曼城 | マンチェスター・シティ | 曼彻斯特城, 蓝月亮 | マンC, シティ |
| `manchester-united` | Manchester United | 曼联 | マンチェスター・ユナイテッド | 曼彻斯特联, 红魔 | マンU, ユナイテッド |
| `monaco` | Monaco | 摩纳哥 | モナコ | AS摩纳哥 | ASモナコ |
| `napoli` | Napoli | 那不勒斯 | ナポリ | SSC那不勒斯 | SSCナポリ |
| `parma` | Parma | 帕尔马 | パルマ | 帕尔马AC | パルマAC |
| `porto` | Porto | 波尔图 | ポルト | FC波尔图 | FCポルト |
| `psv` | PSV | 埃因霍温 | PSV | PSV埃因霍温 | PSVアイントホーフェン |
| `real-madrid` | Real Madrid | 皇家马德里 | レアル・マドリード | 皇马 | レアル |
| `roma` | Roma | 罗马 | ローマ | AS罗马, 红狼 | ASローマ |
| `valencia` | Valencia | 瓦伦西亚 | バレンシア | 巴伦西亚, 蝙蝠军团 | バレンシアCF |

## 5. Manual Review Names Queue

The following historical or multi-variant player names use conservative standard transliterations (with canonical English preserved as secondary display) and are recorded for optional future editorial review:

| `entityId` | `canonicalName` | `zh-CN` | `ja` | `reason` |
| :--- | :--- | :--- | :--- | :--- |
| `amedeo-carboni` | Amedeo Carboni | 卡博尼 | アメデオ・カルボーニ | Historical Valencia defender (2004); multiple Chinese transliterations exist (卡博尼 / 阿梅代奥·卡博尼). |
| `berat-djimsiti` | Berat Djimsiti | 吉姆西蒂 | ベラト・ジムシティ | Albanian/Swiss surname Djimsiti has multiple Chinese/Japanese media spellings (吉姆西蒂 / 迪짐시티 / ジムシティ). |
| `damiano-tommasi` | Damiano Tommasi | 托马西 | ダミアーノ・トンマージ | Historical Roma midfielder (2001); transliterated as 托马西 / 达米亚诺·托马西. |
| `diego-fuser` | Diego Fuser | 富塞尔 | ディエゴ・フゼール | Historical Parma midfielder (1999); less common in modern FIFA databases (富塞尔 / 迭戈·富塞尔). |
| `francesco-antonioli` | Francesco Antonioli | 安东尼奥利 | フランチェスコ・アントニオーリ | Historical Roma goalkeeper (2001); transliterated as 安东尼奥利. |
| `giuseppe-pancaro` | Giuseppe Pancaro | 潘卡罗 | ジュゼッペ・パンカロ | Historical Lazio defender (2000); transliterated as 潘卡罗. |
| `jacques-songo-o` | Jacques Songo'o | 松戈奥 | ジャック・ソンゴォ | Historical Deportivo goalkeeper (2000); apostrophe surname Songo'o has variants (松戈奥 / 宋戈奥). |
| `jan-vennegoor-of-hesselink` | Jan Vennegoor of Hesselink | 海塞林克 | ヤン・フェネホール・オフ・ヘッセリンク | Compound Dutch surname Vennegoor of Hesselink has long and abbreviated forms in zh-CN/ja. |
| `luca-marchegiani` | Luca Marchegiani | 马切吉亚尼 | ルカ・マルケジャーニ | Historical Lazio goalkeeper (2000); transliterated as 马尔凯贾尼. |
| `reinildo-mandava` | Reinildo Mandava | 雷尼尔多 | ヘイニウド・マンダヴァ | Mozambican defender Reinildo Mandava; commonly referred to as 雷尼尔多 or 雷尼尔多·曼达瓦. |
| `roberto-sensini` | Roberto Sensini | 森西尼 | ロベルト・センシーニ | Historical Parma defender/midfielder (1999); transliterated as 森西尼 / 罗伯托·森西尼. |
| `wilfred-bouma` | Wilfred Bouma | 鲍马 | ヴィルフレート・ボウマ | Historical PSV defender (2005); transliterated as 鲍马 / 博马. |
