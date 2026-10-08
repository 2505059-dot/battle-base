# FIFA 历史卡牌搜索研究结果

研究快照日期：2026-10-08。完整机器可读候选数据见 [`candidates.json`](candidates.json)，逐 PlayerSeason 覆盖见 [`coverage-report.json`](coverage-report.json)，采集检查点、输入及 worker 哈希和原始时间戳见 [`run-manifest.json`](run-manifest.json)。本报告使用独立研究线的 95 个搜索实体、99 条 PlayerSeason 输入；没有改动正式名单、PlayerSeason ID、能力 v2 或比赛引擎。

## 覆盖结果

四个数据源各尝试了 95 个输入实体任务，共 380 个任务。表中的 HTTP 成功表示该实体任务至少收到过一次成功 HTTP 响应，不代表所有子请求成功，也不代表搜索完备。`low` 是低置信度候选，`unverified` 是缺少独立身份交叉证据的候选；本次没有任何来源达到 high / 已确认身份。实体候选列按搜索任务汇总；覆盖旗标列按 99 条 PlayerSeason 记录计算，并去重到 95 个输入实体。年龄矛盾候选保留在原始候选中，但不计入 PlayerSeason 覆盖。

| 来源 | 有成功 HTTP 响应 | 名称过滤已验证 | 完整搜索 | 候选记录 | 搜索任务实体候选（low / unverified） | 95 实体去重旗标：卡牌 / OVR / 可用详细属性 / 完整详细属性 | 99 PlayerSeason：卡牌 / OVR / 可用详细属性 / 完整详细属性 |
|---|---:|---:|---:|---:|---:|---:|---:|
| WeFUT | 95/95 | 57/95 | 0/95 | 2,625 | 55/95（low，含年龄矛盾项） | 52 / 52 / 51 / 51 | 56 / 56 / 55 / 55 |
| FIFA Addict FO4 | 95/95 | 0/95 | 0/95 | 1,735 | 53/95（low，含年龄矛盾项） | 48 / 48 / 0 / 0 | 52 / 52 / 0 / 0 |
| FIFA Addict FO3 | 95/95 | 0/95 | 0/95 | 856 | 44/95（low，含年龄矛盾项） | 43 / 43 / 0 / 0 | 46 / 46 / 0 / 0 |
| Nexon FC Online（可选补充源） | 95/95 | 0/95；25 个静态同名组可完整展开 | 0/95 | 531 | 25/95（均 unverified） | 0 已确认；25 个 unverified 候选均有卡牌 / OVR / 完整属性 | 0 已确认；27 个 unverified 候选均有卡牌 / OVR / 完整属性 |

三个主站 99 行 coverage flags 去重到 95 个实体后分别为 WeFUT 52/52/51/51、FO4 48/48/0/0、FO3 43/43/0/0（卡牌 / OVR / 可用详细属性 / 完整详细属性）。候选搜索实体数 55/53/44 包括下述年龄矛盾名称候选，不应称名单覆盖；Nexon 的 25/25/25/25 则全部是 unverified 候选，不是已确认覆盖。

`siteSummary` 的搜索候选实体数（WeFUT 55、FO4 53、FO3 44）包括在对应 PlayerSeason 年份出现年龄矛盾、因此被行级身份规则排除的候选；它不是名单覆盖数。具体是 WeFUT 的 Fran（2000，DOB 推算 13 岁）、Mauro Silva（2000，10 岁）、Paulo Ferreira（2004，10 岁）；FO4 的 Costinha（2004，4 岁）、Emerson（2001，7 岁）、Kolo Toure（2004，10 岁）、Marcelo Salas（2000，3 岁）、Sinisa Mihajlovic（2000，6 岁）；FO3 的 Costinha（2004，12 岁）。这些来源候选与出生日期证据仍保留，但行级 `identity_confidence=none`，`card_found/overall_found=false`，历史关联不确认。因此 95 实体去重覆盖表采用逐 PlayerSeason 旗标口径 52/48/43，而非把年龄矛盾的名称候选算作名单覆盖。

Nexon 的 27 条 PlayerSeason 候选含 OVR 与完整详细属性，但因为没有可靠的跨站球员 ID / 出生日期交叉链接，它们不算已确认卡牌或属性覆盖。三家 FIFA 来源的严格卡牌覆盖并集为 63/99 PlayerSeason；Nexon 的 27 条候选中 26 条与该并集重叠，另有 Costinha 1 条输入行、7 张来源本地卡牌候选，均仍是 unverified，不能据此声称新增已确认球员卡。详细属性方面，三家 FIFA 来源完整属性并集为 51 个实体 /55 条 PlayerSeason；Nexon 的 25 个实体 /27 条完整属性候选与其重叠 20 个实体 /22 行，Nexon-only 为 5 个实体 /5 行候选。所有 531 条 Nexon 候选都有 34 项详细属性和 6 项摘要评级，但身份、基础加成状态仍未确认；verified same-card attribute fills 为 0。其“FO4 可能缺口候选”25 个实体 /27 行是与 FO4 属性空缺的输入层交集，不等同于三家 FIFA 来源并集之外的新增数。三个 FIFA 数据库及 Nexon 的完整搜索率都是 0/95：查询结果有分页上限、分页计数异常，或只验证到单页。空结果只表示本次没有观察到匹配项，不证明网站全库不存在该球员。

候选级详细属性状态必须与 roster 覆盖分开看：WeFUT 的 2,625 条候选中，2,032 条的来源字段集完整；其中 1,167 条因名称不匹配被标为 identity `none`，不计入球员覆盖。按可用字段阈值，867 条候选有可用详细数值；低置信、名称可接受的候选中有 865 条完整、2 条部分完整，这对应 55/99 条 PlayerSeason 的完整属性候选。这里没有确认任何历史俱乐部—赛季关联。

| 来源 | 候选级可用详细属性 | 候选级完整详细属性 | 解释 |
|---|---:|---:|---|
| WeFUT | 867/2,625 | 2,032/2,625 来源字段完整；其中 865 条低置信候选完整、2 条部分完整 | 20 项以上的可用数值与完整字段集是不同标志；identity `none` 的原始候选保留审计但不计 roster 覆盖 |
| FO4 | 0/1,735 | 0/1,735 | 835 条候选有 OVR 与六项概览评分；详情页 SSR 的 `0` 是占位符，不当作能力值 |
| FO3 | 0/856 | 0/856 | 225 条候选有 OVR；采样详情页统计字段为空，公开页面的属性 POST 返回 HTTP 200 但正文不是 JSON |
| Nexon FC Online | 531/531 | 531/531 | 每条缓存能力片段均有 40 个来源条目：6 项卡面概览 + 34 项详细属性；身份仍 unverified，能力状态是页面默认 `n1Strong=1, n1Grow=0`，基础状态未验证 |

FO4 hydrated detail API 的普通公开 GET 返回 HTTP 401；没有合成令牌或绕过。环境没有 Playwright / playwright-core，因此没有声称做过浏览器 DOM 属性采集。Nexon 的完整属性可作为另一游戏的补充候选，但无法证明是 FO4 同一张卡：本次已验证的 same-card 补齐数是 0，25 个实体、27 条 PlayerSeason 仅是可能的输入层候选重叠，不做数值换算。

## WeFUT 版本字段

字段映射只在公共页面可见表头与返回行列数相符时启用。缓存页头给出的状态如下：

- FIFA 14–17：74 列；唯一 `Nation`/`Nationality`、`Min`、`Max` 边界验证通过，34 个详细属性字段。
- FIFA 18：缓存页面 GET 返回 HTTP 500；没有再请求，155 条此前取得的候选行属性状态保留为 unknown。
- FIFA 19：75 列，旧边界验证通过；35 个详细字段，2 条候选只观察到 34 项，标为 partial。
- FIFA 20–21：各有 75 个带标签列，但没有 `Min`/`Max` 边界，且不适用 FIFA 22+ 的现代页头契约；不启用属性映射，候选属性状态为 unknown。
- FIFA 22–FC 27：75 列、同版本 server-side `/ajax/getPlayers/{edition}` 契约及身份元数据标签验证通过；固定需要 35 个详细字段（含 `Composure`）。`Potential` 单独保留为发展属性，未标注的 Work Rate 不推断。FC 27 页面已观察到有卡牌数据。

采集 worker 当时对 WeFUT 仍按 74 列发送 DataTables 请求；后来实现的适配器会根据可验证页头生成 74 或 75 列请求，页头不可信时跳过 POST。本次没有因此重跑搜索。

## 重点俱乐部

下表统计 roster 行中有低/高置信非冲突卡牌候选的行数；Nexon 一栏单列 unverified 候选，不计入已确认覆盖。俱乐部名称取自正式输入中的 `club` 字段原值。

| 俱乐部 | PlayerSeason / 搜索实体 | WeFUT | FO4 | FO3 | Nexon unverified 候选 |
|---|---:|---:|---:|---:|---:|
| Valencia | 9 / 9 | 1 | 2 | 2 | 1 |
| Deportivo La Coruna | 9 / 9 | 4 | 2 | 3 | 4 |
| Lazio | 9 / 9 | 3 | 3 | 3 | 2 |
| Porto | 9 / 9 | 5 | 3 | 3 | 4 |
| 合计 | 36 / 36 | — | — | — | — |

能力 v2 审计输入记有 92 条 baseline unavailable、89 条 name/ambiguity findings、41 条 position findings；这些类别有交叠，不构成互斥队列，无法据此精确定位用户提到的 42 条记录。四个重点俱乐部共 36 条，因此报告了全部 36 条，没有推断或重编号任何“42 人”名单。

## 搜索机制与复现

- [WeFUT](https://wefut.com/player-database/14/) 的公开数据库页使用 `/ajax/getPlayers/{edition}` DataTables POST，名称项为全局 `sSearch`；页面分页在 Ajax 参数中，不改 URL。保存的批量结果有 2,660 个查询子任务。错误/告警共 4,148 条：1,916 条 `search_filter_unverified`、2,056 条 `pagination_count_unverified`、57 条 `search_filter_partially_unverified`、119 条无 `kind` 的 HTTP 500。95 个实体任务都收到过至少一次成功 HTTP 响应，但只有 46 个 checkpoint job 完成，49 个保留为可恢复重试；所有 95 个搜索结果仍是 partial/unknown。公开总数曾出现不匹配或恒为 101 的表现，相关候选保留但不据此宣称搜索成功。
- [FO4](https://cn.fifaaddict.com/fo4db) 使用 `/fo4db?playername=…&sv=cn` 搜索及 `/fo4db/{opaque-id}` 详情；子任务 224 个。搜索页没有经验证的完整分页，所有实体覆盖均标 partial/possibly truncated。
- [FO3](https://en.fifaaddict.com/fo3db.php?q=p) 的 UI 搜索映射为 `/fo3db.php?q=player&name=…&limit=500`，不加赛季过滤；子任务 248 个。500 行上限和分页完备性未验证，详情属性接口的非 JSON 响应记录为解析失败。
- [Nexon FC Online](https://fconline.nexon.com/datacenter) 是单独报告的可选补充源，不并入 FIFA 结果。公开 `spid.json` / `seasonid.json` 索引和 PlayerList 第 1 页搜索发现名称组，随后读取公开 PlayerAbility 片段；子任务 173 个，搜索完备性仍未知。

每站的小样本先测了 8 个实体；FO4 159 条、FO3 25 条、Nexon 58 条样本候选保留全部观察到的卡种。所有候选均保留来源链接、来源卡牌 ID 命名空间、原始字段和身份证据；跨来源 numeric ID 不做猜测匹配，不挑最高 OVR，不换算游戏评分。历史相关性仅在证据可直接支持时确认，本批输入的历史俱乐部—赛季关联仍为 unverified。

按 `.cache` 中的 HTTP 方法与 URL 键缓存响应，按实体保存进度，支持从 checkpoint 恢复；瞬时失败每个进程最多重试一次，401/403/429 会停止该站后续请求。脚本默认每个来源至少间隔 900 ms，但采集进程的环境覆盖值未写入 checkpoint，因此 manifest 不宣称实际有效间隔。采集时间戳保留原始 UTC 字符串；本次 merge 的 `2026-10-08T11:37:11Z` 是后处理时钟锚点，不是重新采集时间。

复现完整采集时，从仓库根目录按 [`README.md`](../README.md) 中说明运行输入准备、小样本/回归验证、各来源搜索与 offline merge/report。最终快照文件：

- [`candidates.json`](candidates.json)：全部来源候选，压缩为无缩进 JSON（50,680,769 字节；压缩前 79,377,937 字节）。WeFUT 重复的完整页头 schema 与 `presentSourceColumns` 清单以带 SHA-256 的共享引用表示；每条候选的原始数字行、卡面 markup、ID、URL、归一化属性和属性完整性状态均保留。
- [`coverage-report.json`](coverage-report.json)：95 个实体、99 条 PlayerSeason、站点及重点俱乐部覆盖。
- [`wefut-edition-headers.json`](wefut-edition-headers.json)：只从已缓存公开页离线重建；18 版失败状态保留。
- [`run-manifest.json`](run-manifest.json)：输入与检查点哈希、worker / 后处理代码哈希、原始时间戳及输出元数据。
- `sample-*-candidates.json`：四个来源的 8 实体样本，使用当前身份及属性归一化规则离线刷新。

大体积 HTTP 原始页面缓存留在被 gitignore 的 `.cache/` 中，没有复制进提交结果。
