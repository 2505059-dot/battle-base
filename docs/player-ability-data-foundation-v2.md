# Player Ability Data Foundation v2

本目录为独立、版本化的 source-native 能力数据基础。它复用现有 PlayerSeason ID、canonical entity 和 TeamSeason membership；不接入游戏 runtime，也不重算六维、时代校准、阵型、角色或战术。

## 产物与分层

- `data/abilities/player-season-abilities-v2.json` 为 554 条 PlayerSeason 占位记录。每条保留历史 `membershipClub`，并独立记录 primary snapshot、所有关联来源观察、canonical 字段、位置上下文、未实现的 derived 层、legacy 六维和 override 层。
- `data/abilities/v2/schema.json` 与 `sources.json`、`field-mappings.json`、`position-mappings.json`、`snapshot-policy.json`、`overrides.json` 定义可审查的数据契约和版本。
- `data/reports/ability-v2/` 报告占位/身份/字段覆盖、来源 lineage、同版冲突、未解决项、PSV 2005 案例和 legacy 迁移基线。
- `legacy.dimensions` 仅从当前 `public/data/team-seasons.js` 复制 overall/attack/creation/defense/physical/goalkeeping；标记 `isTrainingTruth:false`。旧值来源历史和 fallback 状态未知，不能当作 v2 真值。
- `canonical.attributes` 仅映射配置中明确列出的 source field。每个值包含源 observation、字段名、映射版本和状态；缺失为 `null`。POT 单独保存。原始 CSV 字段值仍以字符串保存在 observation 中。
- `positionModel` 分开保存 source-listed natural positions、实际 roster position 与空的 formationSlots/tacticalRoles/tactics。位置评分只进入 `observedPositionRatings`；`derived.positionRatings` 保持空并标为未实现。
- `overrides` 是独立记录层；当前无 override。任何之后的人工修改都要有证据、原因、适用记录和修改前后值，不能覆盖 raw observation。

CSV 字段按 CSV 语义解码后保留原字符串；source 文件 SHA-256、文件路径/URL、row ordinal 和原始字段可追溯到固定输入。字段级 raw 字符串不等同于保留 CSV 引号/转义字节；原始文件 hash 用于核对整份输入。

## 来源与语义边界

构建只消费 `research/fifa-rating-audit/source-manifest.json` 中的固定路径、字节数和 SHA-256。`source-lineage.json` 同时报告 URL、revision、license 状态和目标行扫描数量。lbenz 上游地址可变且没有不可变 revision，当前 payload 以 manifest hash 锁定；该 CSV 没有 potential 字段。Mzafram 源代码 revision 固定到 manifest 所列 commit，但历史 roster update 时间未确定。Stefano archive 的版本标识未取得；FIFA18 demo listing 的列数与实际 CSV 结构有差异。Stefano member 实际使用 `player_id` 作为 SoFIFA 源 ID，并提供逐行 `fifa_update_date`；合法 ISO 日期原样保存，空值/非法值留在 rawFields 并报告原因。其他无逐行 update date 的来源保留 `null` 及原因。可用日期不会参与跨来源快照排序。

来源 listing 对 Stefano 声明 CC0、FIFA18 demo 声明 CC BY-NC-SA；底层 FIFA/SoFIFA 数据权利仍未知。manifest 锁定字节不等于解决分发许可。完整外部数据库只存于被忽略的 cache；是否分发由项目既有数据约束和后续许可审查决定。

字段语义保持保守：aggregate pace 不拆成 acceleration/sprint speed；creativity 不映射为 vision；旧式 slide/stand tackle 不复制为现代双字段；gk_rushing 不映射为 diving；demo 的 Marking 不冒充 Defensive Awareness。Mzafram aggregate dribbling 与 `dribbling_stat` 分开。Stefano legacy 的现代详细字段按 source-native 字段显式映射；`power_long_shots` 与 `defending_marking_awareness` 的两个字段名变体分别映射为 long shots 与 defensive awareness，原始字段仍保留，未进入 34 项词汇的 `goalkeeping_speed` 保持 raw-only。来源中明确给出的 `0` 保留为 0；空值、NA 等缺失标记成为 canonical `null`，不补 0 或 11。raw-only 字段仍留在 `rawFields`。

天然位置源字段、source roster position、observed position rating 分开记录。LWB/RWB 是独立 canonical positions；SW 为 `legacy-special` 且不折入 CB；侧向码保留 native code 与 side；SUB/RES 作为 roster status，不映射到球场位置；未知码保留并进入 unresolved 报告。来源未声明次序含义时，position order 不代表主次。position rating 保留原字符串、base integer 和 signed modifier；不默认相加。position formula audit 中的留出拟合不是 EA 官方公式，本阶段不训练或部署它。

## 快照与身份

TeamSeason 的年份 Y 表示在 Y 年结束的完整赛季；能力目标版本为 Y+1。选择顺序是 Y+1、Y 回退、再到以 Y+1 为中心且绝对偏移不超过 2 的 nearest。nearest 排除已尝试的 Y+1 和 Y；平局优先较晚 edition，再按来源优先级、source ID 和 source row ordinal。选择不看 OVR/POT/属性均值。只有唯一稳定外部 ID 命中可成为 primary；名称匹配只作为低置信度候选。跨队 sourceClub 不改变 TeamSeason membership。

无稳定来源时记录 `unavailable`。Y 回退、nearest、manual override、legacy runtime 和 unavailable 分别统计；旧 runtime fallback 来源无法在当前数据中逐条识别，因此 legacy origin 明确报告 unknown，不沿用旧审计的 fallback 数字。构建重算现有 554 条记录的覆盖，不把占位数量描述为完整真实能力覆盖。

PSV 2005 报告从现有研究案例名单复核九名球员，并对 Farfán 的稳定源 ID 158133 检查 FIFA05/FIFA06/FIFA07 raw OVR 为 48/69/73。Y+1 选择 FIFA06 的 69；报告不推断数值变化原因，membership 仍为 PSV。

## 采集、离线构建与验证

在源 cache 缺失时，可运行下列采集入口。它只请求 source manifest 中固定 URL，核对精确字节数/hash；ZIP member 只按配置提取。原始大文件与带采集时间的本地 acquisition manifest 均在 gitignored cache 中。

```powershell
node scripts/ability-v2/acquire-sources.mjs
```

仅检查现有 cache、拒绝下载时：

```powershell
node scripts/ability-v2/acquire-sources.mjs --verify-only
```

构建完全离线；它重新核对 manifest 输入、identity index、TeamSeason 与 season pool。任一必要文件缺失、大小/hash 不符、身份/阵容数量漂移或 ZIP member 不能验证时会非零失败，不自动换用另一个来源，也不写部分产物。

```powershell
node scripts/ability-v2/build.mjs
node scripts/ability-v2/validate.mjs
```

**validate.mjs** 首先核对固定 **source-manifest.json** 所列输入的字节数和 SHA-256，并核对本地 acquisition 记录、ZIP archive 与提取 member 的 hash 关系。这一层证明验证时使用的缓存文件与固定 manifest 字节一致；它不证明生成的 observation 字段确实取自对应 CSV 行。 随后，正式验证无条件从已通过 manifest/member 校验的磁盘 CSV 或提取 member 重新读取来源行。验证器按 **sourceId**、**sourcePath**、**member** 与 **rowNumber** 定位记录，并核对每条 observation，包括 primary、未选中的 stable-ID 观察及 name/ambiguous 候选。它逐项比较完整 **rawFields** 字段集合和 CSV 解码后的字符串值、来源球员 ID/姓名/球队、**rawOverall**、**rawPotential**、由配置行字段/文件名/固定版本推导的 **editionYear**、来源 update date，以及 source version、URL、payload/member/archive hash 等来源元数据。**rowNumber** 使用现有 CSV 记录序号口径：header 是记录 1，首条数据记录是 2；引号内换行不会增加记录序号，物理文本行号不用于定位。验证按物理 CSV 文件分组，每个被引用文件只扫描一次，保持离线且不换源。 **validateData()** 仍独立检查 schema、identity、selection、raw observation 与 canonical/position 结构之间的一致性。该内部层可证明 canonical 值与 observation 中的 raw 值、映射和 provenance 相符，但单独通过它不能证明 observation 的 **rawFields** 来自固定 CSV；上一层磁盘来源核对负责证明这一点。**validate.mjs** 每次完整运行都会执行这两层，未提供跳过来源核对的开关。 验证还运行 20 个内部拒绝案例、4 个 strict-JSON fixtures、6 个快照、7 个位置和 4 个 source-date fixtures。另有 14 个基于独立磁盘 CSV 的来源验证 fixtures，覆盖自洽的 raw/canonical 70 → 99 篡改拒绝、raw-only 字段、非 primary observation、另一条真实 CSV 记录序号、edition/path/来源元数据变更，以及合法引号、逗号、嵌入换行和空字段。相同 manifest 与配置产生的 JSON 不含采集时间、随机数或网络状态，应逐字节稳定。

新数据与脚本刻意独立于旧 importer/calibrator 和 runtime。后续接入前仍需审查 FIFA/SoFIFA 数据分发权利、历史字段跨版本语义、position model 的适用范围和校准方向/池化问题。

## 当前 manifest 覆盖基线

以下计数来自当前 23 项 manifest 输入和 62 个 TeamSeason：19 个 Mzafram edition CSV、lbenz CSV、Stefano ZIP、FIFA18 ZIP 与其 manifest 固定的 CSV member。采集记录把 22 个直接文件与两个提取 member 分开记录；提取出的 FIFA18 CSV 同时是 23 项 manifest 输入之一。能力输出包含 554 条 PlayerSeason、418 个 canonical entity 和 5,164 条来源观察，其中 4,762 条为 stable external-ID 匹配，402 条为 name/ambiguous 候选。

唯一稳定 ID 快照为 462/554（83.394%）：457 条选 Y+1、1 条回退到 Y、4 条采用受限 nearest，92 条 unavailable。主来源为 lbenz 290 条、Mzafram 171 条、Stefano 1 条。`available` 表示至少有一个 canonical detailed attribute 观察值，不表示 34 项属性全部齐全。字段覆盖报告区分 observed、missing 和 unmapped；例如 dribbling、sprint speed、stamina 各有 462 条观测，crossing 429 条，finishing 和 long shots 各 455 条，defensive awareness 172 条。历史来源没有经过确认的语义映射时保持 unmapped，不填补。

`source-conflicts.json` 的 1,806 条是同一 PlayerSeason、同一 edition 下至少两条 stable-ID 观察的分组：全部含 `multi_source_same_edition`，其中 1 条还含 `duplicate_source_rows`。它们是待审查的来源并列记录，不代表已计算综合评分，也不表示每组数值都不同。按非空 raw 字符串比较，855 组的 OVR 有多个值、742 组的 POT 有多个值；空值仍单独保存在 raw 值集合里。构建不平均、不覆盖，也不按数值挑选 primary。

未解决报告有 92 条无可选稳定快照、402 条 name/ambiguous 候选、837 条 unresolved/legacy-special/roster-status 位置记录、0 条无法解析的位置评分和 0 组重复 canonical external ID。837 条中包含有意保留的 SW、SUB/RES 状态及未识别代码；这不等同于 837 个未知球场位置。22 条 source-lineage scan 至少有一个 revision 或 license 状态未确定。

legacy migration 报告保留六个 runtime 维度，六个维度各有 554/554 个值；均标记 `isTrainingTruth:false`、`originStatus:unknown_source_lineage`。报告均值为 overall 84.560、attack 64.283、creation 72.439、defense 61.951、physical 75.798、goalkeeping 19.540。现有输入不能逐条证明这些 legacy 值由 source observation、估算还是 fallback 产生，因此不据此推断 legacy fallback 数量或把均值用于训练。

契约版本：数据 schema `player-season-abilities-v2.0.0`；sources、field mappings、position mappings、snapshot policy 与 overrides 均为 `1.0.0`。重新生成后以对应 JSON 报告为准；这些基线计数不替代每次构建的输入 hash 与 validator 检查。