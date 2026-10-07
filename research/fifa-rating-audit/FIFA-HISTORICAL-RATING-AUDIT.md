# FIFA Historical Schema & Position Rating Audit v1

## 结论与证据等级

这份工作是隔离工作树里的独立研究交付；没有修改 Battle Base 运行时代码、数据或校准器。Tier A 表示本地源文件直接观察到的值、字段、版本及SHA256；Tier B 表示明确匹配后的跨源比较或固定玩家ID留出集统计；Tier C 表示派生映射、量化变换或尚待验证的方案。没有Tier声称掌握EA专有公式。

实际取得lbenz/FIFAIndex-attributed FIFA05–20共16版、Mzafram repo FIFA07–23与FC24/25共19个CSV（每版59列）、Leone legacy FIFA15–23共9版及FIFA18 demo。Mzafram当前仓库/抓取器指向SoFIFA，但各历史CSV的原始来源和更新vintage为UNRESOLVED；作为第三方观察值，manifest以commit及payload SHA固定本次文件。lbenz来源branch可变，数据版本UNRESOLVED但本地payload有SHA。Leone Kaggle API声明CC0，底层FIFA/SoFIFA权利另行UNRESOLVED。FIFA18 listing声称155列，实际17,981×75。FC26实时API/tree在仓库SHA `90c4a0dd4423803ec5d025a8a3611fae2fe7dbf0` 无文件、404；过期索引页被实时证据取代。各文件URL可变性、版本/校验和、许可与来源限制在`source-manifest.json`。

Stefano archive里 `male_players.csv` 解压后约5.64GB，本次未展开；拟合仅读 `male_players (legacy).csv`，该member原始90.9MB。位置标签覆盖FIFA15–23，27个native position codes。字符串中的base整数与`+/-modifier`拆分保存，并分别拟合；modifier不并入base。

Battle Base既有报告数据规模：418个实体、554个PlayerSeason、62个TeamSeason；当前报告含554条fallback记录。[player-season-coverage.csv](outputs/player-season-coverage.csv)逐行保留全部554个PlayerSeason，[entity-coverage-summary.csv](outputs/entity-coverage-summary.csv)逐行保留418实体；1999–2004会明确记录本次source corpus无版可匹配的缺口。[snapshot-alignment.csv](outputs/snapshot-alignment.csv)覆盖全部62个TeamSeason，六个指定案例用`highlight_case`标记。覆盖表按同年有文件的source×TeamSeason分别统计，合计 1,016/1,662 个可匹配机会；这是重复source机会数，不是554个不同球员的唯一覆盖率。优先用来源各自external ID，退回唯一标准化名字时保留较低置信度；多解和未匹配单列。完整跨源结果先在内存计算并放入gitignored derived cache；[source-conflict-summary.csv](outputs/source-conflict-summary.csv)汇总全部source pair/edition，[source-conflicts.csv](outputs/source-conflicts.csv)与[cross-source-verification.csv](outputs/cross-source-verification.csv)保留2010/2015/2020每年最多100个确定性去歧义spot-check身份样本。full-join universe共 320,580 条，跨年 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023，OVR不相等 136,370 条；差异是来源/快照观察，不自动判错。

### 执行摘要 A–J

**A. Schema断点。** FIFA15是本语料首次同时取得细项属性和27个位置评分label的版本，这是数据可用性边界，不能据此认定EA在FIFA15改变了游戏schema。64/59/110/75列还包含不同导出器差异，需看逐字段非空率；Mzafram历史版lineage未证实。

**B. 现代reference区间。** 暂保留2017–2024作为描述基线，不做通用线性映射。候选窗口统计（[reference-candidate-ranges.csv](outputs/reference-candidate-ranges.csv)）：FIFA15–23 legacy-label overlap：9个可用版，版均值SD 0.87，Top500均值SD 0.72，相邻同玩家样本 101,646；FIFA17–FC24 current-reference window：8个可用版，版均值SD 0.29，Top500均值SD 0.22，相邻同玩家样本 90,526；FIFA18–FC25 recent window：8个可用版，版均值SD 0.32，Top500均值SD 0.22，相邻同玩家样本 90,946；FIFA07–FC25 broad raw window：19个可用版，版均值SD 1.30，Top500均值SD 0.78，相邻同玩家样本 210,727。Mzafram历史edition lineage未能独立证实，所以更可靠的primary-reference最佳区间仍UNRESOLVED；后续应按目标人群和明确update snapshot选。

**C. TeamSeason快照。** TeamSeason Y代表Y年结束的完整赛季，因此建议优先使用赛季后的Y+1 ability snapshot；球队成员关系仍属于Y。Y+1缺失/身份不可靠时显式退回Y，记录edition和update date。[snapshot-alignment.csv](outputs/snapshot-alignment.csv)比较全部62个TeamSeason，六个案例有highlight标记。当前BB不是真值；同年MAE可为零是因为BB本身引用同一FIFAIndex数据，属于循环吻合，不能验证时点。

**D. Canonical attributes。** 保留源字段和值。v2可为现代细项建立版本化候选映射（crossing、finishing、heading_accuracy、short_passing、volleys、dribbling、curve、fk_accuracy、long_passing、ball_control、速度/反应/平衡、shot_power、jumping、stamina、strength、long_shots、aggression/interceptions/positioning/vision/penalties/composure、tackles/defensive_awareness及GK细项），但每项都要附source/version/semantic。不要把早期`creativity`等同`vision`、把aggregate `pace`当作加速/冲刺，也不要补造早期缺值。

**E. Canonical positions。** 原样保存source-native位置串和位置评分码；另做版本化的派生slot family映射（GK、CB、LB/RB、LWB/RWB、CDM、CM、CAM、LM/RM、LW/RW、CF/ST）。位置代码与球场几何不是同一概念；左右侧位置信息不能被family吞掉。见 [position-vocabulary.csv](outputs/position-vocabulary.csv) 和首位置分组 [position-cohort-distributions.csv](outputs/position-cohort-distributions.csv)。

**F. Position rating策略。** 同年legacy来源标签与BB位置映射必须分开解释：554条PlayerSeason中有268行取到同年source position target，其中30行是单一BB native code一对一映射，193行来自DF/FB/MF/FW粗粒度代理，45行有目标但BB映射仍有歧义。来源label被观察到不等于证明它对齐了BB球员的native位置；逐行字段区分source label存在性、派生mapping精度和alignment。研究回归只用于验证/候选，不可写回生产字段。243个base留出拟合的宏平均MAE 0.252、平均R² 0.9991；同position/version的base系数cosine中位数 1.000。FIFA18样本：ST MAE 0.252/R² 0.9990、CM MAE 0.253/R² 0.9989、CB MAE 0.257/R² 0.9994、GK MAE 0.260/R² 0.9986。这是对SoFIFA衍生目标的预测能力，不是EA公式证明。

**G. PSV 2005。** 九名指定球员×FIFA05/06/07逐行记录在 psv-2005-case.csv：本次稳定ID命中27/27行，九个ID各自跨edition保持一致；mapped detail与完整source-native detail均为27/27行。稳定ID锚点、Cocu的验证拼写alias和解析方法写在CSV；Cocu的source名Philip Cocu对应ID 5736，FIFA05–07均为唯一荷兰籍PSV source row。membership_club是BB的PSV 2005 TeamSeason成员关系；source_club单列每个ability edition的真实来源俱乐部，跨队不改变历史名单成员关系。Jan Vennegoor ID 27488的2007 source club为Celtic、OVR 81。PSV05当前报告raw OVR来自同一条lbenz FIFA05 source provenance；现有证据不支持说BB在PSV05对这些raw OVR做了新的校准改写。Farfán可观察序列：2005:48（stable ID match; source club recorded independently） → 2006:69（stable ID match; source club recorded independently） → 2007:73（stable ID match; source club recorded independently）。05→06匹配球员数9、平均变化 4.22。FIFAIndex的POT没有可靠数值，不能推断。其异常为何发生（早期rating哲学、源错、快照或calibration）仍属因果假设，不能只凭上涨定性。

**H. 保留现有校准的部分。** 保留来源、原始/校准值、reference era及分属性结果的provenance；这些信息支持回溯和迁移比较。

**I. 重审/重写部分。** `scripts/lib/calibrate.mjs`按版均值drift>+0.20约束个体delta≤0，drift<−0.20约束delta≥0，区间内对齐；这是单向启发式。基于来源相邻版同ID的方向比例中位数 66.3%与完整球员池相邻版OVR形状距离中位KS 0.034、Wasserstein近似 0.418（201个分位点网格），需要按source/vintage审查；guard proxy不是直接重放生产校准状态，也不控制名单构成变化。

**J. PlayerAbilityModel v2优先实现。** 建议分成观察层和派生层：观察层存不可变source/version/update date/IDs/raw value/字段非空率/许可和missing reason；派生层存canonical mapping version、quantile或position projection、calibration版本及输入来源。不要在本研究里实现或部署该建议。

### §48问题逐题回答（1–25）

1. **可靠sources：** Tier A是本地校验过的CSV及其edition/字段；position targets主要来自Leone FIFA15–23 legacy，FIFA18 demo作为第二来源。许可声明与底层游戏数据权利分开记。见`source-manifest.json`。
2. **可bulk download：** lbenz单CSV、Mzafram逐版CSV、Stefano Kaggle archive（只读legacy member）、FIFA18 demo archive；复跑校验和逐项见manifest。
3. **只宜spot verify：** SoFIFA/FIFAIndex页面、SoFIFA calculator/API适合核对个例和字段，不应未经许可抓站构造历史全集，也不是EA公式原始文档。GitHub FIFA18 calculator是第三方反向实现。
4. **FIFA05–FC26 schema如何演进：** FIFAIndex-attributed FIFA05–20共64列、早年多项稀疏；Mzafram repo FIFA07–FC25有19个59列文件，但逐版历史来源/update vintage UNRESOLVED；Leone FIFA15–23有110列与27个位置评分字符串；FIFA18 demo实测75列；FC26无实时源文件。逐版coverage在[schema-matrix.csv](outputs/schema-matrix.csv)。
5. **最大attribute-schema breakpoint：** 可观察目标标签首次覆盖边界为FIFA15。导出器列数也分出FIFAIndex/Mzafram/Leone/demo几族，但不能据此推断底层游戏机制改变。
6. **最早modern-compatible详细属性系统：** 最早取得的细项CSV是Mzafram FIFA07，但历史来源/vintage未独立证实，同名字段也不证明跨版同义。因此最早可靠canonical起点UNRESOLVED；FIFA15是本语料最早同时有细项与position target的版本。
7. **最早取得position-specific ratings：** FIFA15，来自Leone legacy可解析的27个原生code；是第三方SoFIFA衍生观察，不是EA公式证明，底层数据再分发权利仍未确认。
8. **跨版公式稳定性：** [position-formula-fit.csv](outputs/position-formula-fit.csv)给train/test数、有效属性数、遗漏/插补和heldout误差；[position-formula-stability.csv](outputs/position-formula-stability.csv)只比较相同位置、target kind和共同属性。标准化尺度来自稳定player ID训练fold，测试fold不参与选特征/插补/scale。数据源second-year-update vintage差异仍在。
9. **最佳modern-reference interval：** [reference-candidate-ranges.csv](outputs/reference-candidate-ranges.csv)比较四个候选窗口的版均值方差、Top500与相邻同玩家统计。2017–24的8版可暂作描述基线；Mzafram历史lineage未证实，因此primary reference最佳年份仍UNRESOLVED。
10. **保留还是改2017–2024：** 暂时保留为命名清楚的描述基线；按目标cohort做额外校准时保留该reference作兼容对照，不要用它对全历史数据做无条件线性缩放。
11. **早期OVR scale/variance：** [source-summary.csv](outputs/source-summary.csv) key为source/edition；FIFA05全池10993人、均值62.88。样本覆盖的是完整源名册，不等于历史TeamSeason明星名单，不能单凭均值差说scale错。Top500与matched IDs见[edition-distributions.csv](outputs/edition-distributions.csv)/连续性表。
12. **全局linear还是分布shape：** 同时检查均值、标准差、尾部分位、Top500、同玩家delta及KS/Wasserstein；相邻总体差异含名单组成效应，当前数据不支持一个统一线性修正作为解决方案。
13. **同玩家连续性何时稳定：** [same-player-continuity.csv](outputs/same-player-continuity.csv)源内按stable ID配对：Stefano legacy：101,120组相邻版同ID；|ΔOVR|中位数 1.00；变化≤1分占 55.5%；Mzafram SoFIFA：210,727组相邻版同ID；|ΔOVR|中位数 1.00；变化≤1分占 55.4%；lbenz FIFAIndex：115,908组相邻版同ID；|ΔOVR|中位数 1.00；变化≤1分占 52.6%。没有一个所有source/vintage通用的稳定起点；相邻版变化和转会分开记录。
14. **TeamSeason Y还是Y+1：** 已完成赛季语义下优先取Y+1 ability snapshot；稳定player ID可跨转会匹配。Y+1数据缺失或身份不可靠再fallback到Y，明确记录选择和update date。
15. **原因：** Y+1在赛季结束后发布，较符合完成态；但edition年份不表示具体抓取/数据库更新时间。球队成员期、ability edition与update date分开保存，不能靠与BB MAE接近来证明。
16. **转会处理：** Y赛季球员留在历史俱乐部名单；能力可从Y+1新俱乐部快照读取，前提是stable ID可靠。转会仅作为source metadata。
17. **PSV05异常原因：** source row、club/nationality、current BB raw/calibrated与source provenance逐人见[psv-2005-case.csv](outputs/psv-2005-case.csv)。同源raw OVR与BB记录一致，因此当前证据没有证明运行时新校准改写了该组raw OVR；历史评级哲学、具体快照和source error还需独立一手证据。
18. **Farfán具体发生什么：** FIFAIndex观测为2005:48（stable ID match; source club recorded independently） → 2006:69（stable ID match; source club recorded independently） → 2007:73（stable ID match; source club recorded independently）；05→06同组可匹配者的均值变化4.22。是source相邻edition变化，POT无实值；仅凭此不能判定其是真实发展或错录。
19. **Canonical attributes保留什么：** source-native OVR、potential（单独字段）、细项、foot/work-rate/reputation及raw names/IDs；modern同名细项可做版本化映射。缺值保持missing，早期`creativity`、后期`vision`等不强行合并。
20. **Canonical positions：** native roster-position字符串/score code原样保留；另存可版本化的coarse family/slot geometry。首位置分组只用于分布分析，字段见[position-cohort-distributions.csv](outputs/position-cohort-distributions.csv)，不是替换原native code。
21. **Position ratings来自哪：** 有来源label时储存observed value与source/vintage；缺源的版标记unavailable。模型输出只放derived/proposal层。
22. **能否高精度复现：** 能对本次FIFA15–23的SoFIFA-derived base目标做高精度heldout拟合，整体指标如本节F所列；不能把这种结果外推为EA内部评分公式。
23. **FIFA05–08：** 保留raw OVR、实际有值的早期属性、缺值说明和source版；不要补造位置rating/POT，也不要直接套现代attribute公式。PSV Farfán FIFA05的48是本地source行实见值。
24. **FIFA09–11：** 保留当年source的细项/OVR并与同玩家相邻版作敏感性分析；这次没找到该段可靠position-specific target，不把后来公式倒推为实测。
25. **FIFA12+：** FIFA12–14可有详细属性但本次未拿到position labels；FIFA15+才有Leone位置target；FC24/25有现代SoFIFA OVR/属性但无此处position targets；FC26本次实时源缺失。结论按观察到的source availability，不预设历史断点。

### Football Model v2提案（仅设计）

`PlayerSeason`建议分别保存来源观察和派生结果：

```json
{
  "teamSeasonId": "psv-2005",
  "sourceSnapshot": {"edition": "FIFA06", "updateDate": null, "datasetVersion": "...", "payloadSha256": "...", "sourcePlayerId": "..."},
  "rawAttributes": {"acceleration": 76, "finishing": 66},
  "sourceNativePositions": ["RM", "ST"],
  "naturalPositions": [{"code": "RM", "mappingVersion": "..."}],
  "observedPositionRatings": {"RM": {"base": 73, "modifier": 2, "source": "..."}},
  "positionRatings": {"CM": 71, "CAM": 77},
  "overall": 73,
  "potential": null,
  "provenance": {"sourceFieldMapVersion": "...", "missingReasons": {"potential": "not reported"}}
}
```

`sourceSnapshot`、source IDs、`rawAttributes`、native code、OVR/POT和observed position labels是来源观察；`naturalPositions`、canonical attributes和`positionRatings`是需版本化并附provenance/null reason的派生值。POT不混入当前ability。授权来源label可训练/验证派生position model；无label年代不伪装成source rating。该数据边界未来可支持4-3-3、4-2-3-1、4-4-2、3-5-2、5-3-2，本研究不添加formation/tactics代码。

### 当前 calibration 审计（只读代码证据）

`[calibrate.mjs](../../scripts/lib/calibrate.mjs)` 的`calibrateSingleStat`在hybrid模式用40% raw + 35% elite-cohort z-score + 25%粗位置percentile；`computeArchetypeTaper`使用62/68/75分数门槛，另有direction guard与OVR ±4、属性 ±5硬上限。保留raw与calibrated分开、reference metadata、独立属性通道、分布诊断；保护非专长属性可保留为待验证设计假设。固定权重、taper门槛和delta clamp都不是FIFA证据。

有一个需先修正的实现不一致：`mergeCohortDistributions`把年度histogram相加用于percentile，却把reference标准差设为各年标准差的简单平均，遗漏年份间方差；它还把各年均值无权平均。`[analyze-era-drift.mjs](../../scripts/analyze-era-drift.mjs)`将该结果用作2017–24 reference，所以hybrid中的z路径与percentile路径基于不同统计量。应先对池化数值计算一致的均值/方差，或明确按edition等权后令histogram也遵循同一规则。

`calibrateSingleStat`的2005–16 guard只看年度elite cohort mean drift，就强制该年每个球员同向变化或归零。报告里的`paired_share_following_proxy_guard`只是历史数据代理检查，不是生产model重放。应验证配对球员/角色与分布形状后再定方向规则，允许同年代球员有不同方向；2017–24分支大多归零，仅对2023–24的高OVR留有限正修正。±4/±5上限只能作为明示且验证过的安全边界，不能补救reference分布错误。

### 补充统计与限制

- [position-cohort-distributions.csv](outputs/position-cohort-distributions.csv)按source/edition的**首个**native roster位置划分GK、CB、LB/RB、LWB/RWB、CDM、CM、CAM、LM/RM、LW/RW、CF/ST及粗分类；每行保留native code。各玩家在版本内按首位分到一个互斥位置组，`all_players`单独标记；早版没有细位置码时不反推。
- [adjacent-distribution-distances.csv](outputs/adjacent-distribution-distances.csv)提供overall总体与首位位置组的两样本KS和Wasserstein-1近似。KS直接比较两经验CDF；Wasserstein使用201个分位点网格，是数值近似。两者都受各版名册构成影响，不能单独视为能力量尺变化。
- [breakpoint-score.csv](outputs/breakpoint-score.csv)列相邻同玩家变化、总体分布shape、行/列数变化与position-label availability边界。Direction guard的paired-share是proxy，不是调用production calibrator的检验。
- FIFAIndex POT列没有可用实值；1999–2004没有经验证的技能能力数据，本研究没有构造。
- Mzafram代码可见MIT声明不自动覆盖SoFIFA派生数据；lbenz未发现数据许可；Leone Kaggle接口声明CC0，但底层FIFA/SoFIFA数据权利需独立确认；FIFA18 demo listing为CC BY-NC-SA 4.0。完整原始表保留在gitignored cache，不纳入研究提交。

### 可重复产物

11个必交表与额外CSV在`outputs/`；报告、README、manifest和8个SVG在本目录。仓库根目录重建命令为`python research/fifa-rating-audit/src/audit.py`，只读检查为`python research/fifa-rating-audit/src/audit.py --check`。source payload、脚本和元数据SHA256，版本/lineage状态、许可声明、权利限制、URL可变性与图表清单均记录在`source-manifest.json`。

- `figures/attribute-drift-heatmap.svg`
- `figures/ovr-by-edition.svg`
- `figures/position-coefficient-similarity.svg`
- `figures/psv-2005-nine-players-fifa05-07.svg`
- `figures/same-player-adjacent-delta.svg`
- `figures/schema-field-count.svg`
- `figures/top500-mean-by-edition.svg`
- `figures/top500-std-by-edition.svg`
