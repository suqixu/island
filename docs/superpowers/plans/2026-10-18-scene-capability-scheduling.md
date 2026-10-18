# 小岛场景能力与影片调度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本侧会话禁止子代理，所有实施与检查均由当前会话直接执行。

**后续要求（优先于原时长）：** 用户已要求精简至180秒、去掉重复镜头，以血月结尾；月相八秒连续变化，加入完整月盘构图、分段运动速度与更多字幕。原410秒/33镜头的验收时间点相应替换。

**Goal:** 让影片脚本按时间调度已注册的场景功能和运行参数，并播放带星座连线与名称的180秒《夜的回声》。

**Architecture:** 能力注册表统一声明类型、范围和模块所有权，纯采样器把轨道与过程片段转换为当前时刻的控制状态。适配器调用模块公开接口，模块复用原几何、材质与运动计算；普通漫游状态与影片状态隔离，退出恢复。主循环仍只有一条。

**Tech Stack:** JavaScript ES模块、Three.js 0.180.0、Vite 7、Node原生测试和真实Chrome；不新增依赖。测试命令使用支持JSON导入属性的Node 22运行环境；当前系统默认Node 14不可用于本项目，不修改系统配置。

**Spec:** [已确认设计及星座增补](../specs/2026-10-18-scene-capability-scheduling-design.md)

## Global Constraints

- 保留 `schemaVersion: 1`，新增 `schemaVersion: 2`；旧影片继续播放。
- 本轮流星数量允许0至32，默认继续随机1至9并使用原画质上限；数量与并发上限分别声明。
- 过程片段为 `[start,end)`，日月食进度来自影片绝对时间；跨镜头不重启。
- 暂停冻结影片事件；倍速改变影片时间推进，音乐保持原速。生物仍自然活动，不承诺拖动后的逐帧复现。
- 每次进入观影生成独立运行种子，同一次观影暂停、拖动和重播复用，不固定写入配置。
- 影片不得写回普通漫游默认值、冻结配置或持久设置；退出、取消准备、报错和释放均恢复一次。
- 不模拟设置按钮点击，不使用任意JavaScript或任意Three.js对象路径调度。
- 当前原目录合法 `feat/` 分支继续工作；不创建worktree，不提交、不推送。保留其他会话已有改动。
- 临时日志：`tmp/reports/scene-scheduling/`；截图：`tmp/screenshots/scene-scheduling/`；构建：`tmp/build-scene-scheduling/`，不覆盖其他会话构建。
- 本侧会话不启动、联系或使用子代理，最终采用自查及实际验证，不声称做过独立代理复审。

## Review Focus

1. 数值0、布尔false和未设置的区别：明确关闭不能被默认值覆盖；任务1、3验证。
2. 拖动直接进入事件中部：无需先播放片头，也不能按当前镜头重新生成轨迹；任务4、5、8验证。
3. 片段相接和影片结束：旧片段退出、新片段进入不得叠加或遗留；任务2、3验证。
4. 单个适配器恢复出错或异步准备迟到：其他状态仍应恢复，旧准备结果不能污染新影片；任务3、8验证。
5. 画质改变与数量轨道同时生效：数量不被下一帧画质设置覆盖，也不超出实际池容量；任务6、7验证。

## 文件与共享接口

核心新增目录 `src/scene-capabilities/`：

| 文件 | 单一职责 |
| --- | --- |
| `registry.js` | 定义注册、所有者注册、类型校验、目录查询，独立于DOM与Three.js |
| `catalog.js` | 从JSON配置与模块容量组装默认定义，不包含场景状态 |
| `sampling.js` | 轨道插值、片段命中与局部时间，纯函数 |
| `scheduler.js` | 观影会话、基线、应用优先级、种子和幂等恢复 |
| `environment.js` | 时间、季节、月相、天气及环境覆盖绑定 |
| `sky.js` | 天空参数、天象片段和日月食环境合成绑定 |
| `presentation.js` | 灯光、画质、诗文与声音绑定 |
| `wildlife.js` | 生物和船只模块的统一运行参数绑定 |
| `index.js` | 组装实际场景能力，不在主入口堆叠参数分支 |

新增 `src/config/scene-capabilities.json` 保存目录中文说明、参数类型/范围和默认值；实际容量由模块声明覆盖。`src/config/film.json` 增加 `maxTracks: 256`、`maxClips: 512`，沿用1 MiB、1800秒、每组128关键帧等原限制。

共享类型与方法：

- `Definition = {id, owner, kind: 'property'|'clip', label, valueType?, default?, min?, max?, values?, period?, parameters?, allowOverlap?}`。
- `Owner = {capture(), begin?(context), restore(snapshot, context), composeEnvironment?(env, context)}`。一个所有者只捕获、恢复一次。
- `Binding = {read?(), apply?(value, context), sampleClip?(frame, context), releaseClip?(context)}`。
- `createCapabilityRegistry() -> {registerOwner(id, owner), register(definition, binding?), get(id), listCapabilities(), validateValue(id, value), validateParameters(id, parameters)}`。
- `sampleFilmSchedule(script, time, {registry, baseline}) -> {time, properties, clips}`；`properties` 为能力ID到值的映射；片段包含 `{id, capability, parameters, start, end, localTime, progress}`。
- `SceneContext = {filmTime, modelTime, seed, paused, seeking, frameAt(seconds)}`；`frameAt` 返回 `{position, target, fov, quaternion}`，不改变真实相机。
- `createSceneScheduler({registry, random}) -> {begin(context), apply(sample, context), composeEnvironment(env, context), end(context), dispose(context)}`。`begin` 取得基线和所有者快照；`end` 清理影片控制并恢复快照。
- `createSceneCapabilities(dependencies) -> registry`；依赖显式注入state、相机、现有模块、音频延迟获取函数和画质/诗文等宿主回调，不读按钮DOM作为真实状态来源。

## Task 1 能力定义与目录注册

**Files:** Create `src/scene-capabilities/registry.js`, `src/scene-capabilities/catalog.js`, `src/config/scene-capabilities.json`; Test `tests/scene-capabilities.test.js`。

**Interfaces:** 产生上述注册表接口；`createCapabilityCatalog({capacities, musicIds, cometStyleIds}) -> Definition[]`，供解析器与运行绑定共用。

- [ ] 写失败测试：`registry.register`拒绝重复ID和未知所有者；数值0、false、枚举、向量合法；流星33颗和NaN被拒绝；`listCapabilities()`返回可序列化、不带场景引用的说明。
- [ ] 运行 `node --test tests/scene-capabilities.test.js`，确认缺少实现时失败。
- [ ] 实现注册表与目录。属性使用稳定ID，例如 `scene.moonPhase`、`sky.constellation.mode`；过程使用 `sky.meteor`、`sky.comet`、`sky.aurora`、`sky.solarEclipse`、`sky.lunarEclipse`。所有者按环境、呈现、模型、天空分组。
- [ ] 加入扩展性测试：注册虚构的测试能力 `test.futureLevel`，通过同一个校验接口验证，无需修改解析器代码；运行本任务测试全部通过。

## Task 2 第二版脚本校验与纯时间采样

**Files:** Modify `src/film-script.js`, `src/film-library.js`, `src/film-player.js`, `src/config/film.json`; Create `src/scene-capabilities/sampling.js`; Test `tests/film-script.test.js`, `tests/film-library.test.js`, `tests/film-player.test.js`, `tests/film-schedule.test.js`。

**Interfaces:** `parseFilmScript(input, {maxBytes, capabilities})` 和 `createFilmLibrary(sources, {capabilities})` 接受可选注册表；`createFilmPlayer({capabilities,...existingOptions})`把同一注册表用于load。默认目录支持现有调用。采样器实现共享接口。

- [ ] 写失败测试：v1语义保持；v2解析tracks/clips；未知ID、未知参数、类型错误、超过256轨道/512片段、重复属性轨道、独占片段重叠均给出定位错误。
- [ ] 运行对应四组测试，确认新增用例先失败。
- [ ] 实现v2校验、规范化与采样。step切换，linear线性，smooth使用既有平滑曲线；枚举、布尔和数量只允许step。周期值按较短方向插值，恰好半周期时取正向；v1时间插值维持原行为。
- [ ] 验证0秒、关键点、相接片段边界、片尾、前后跳转和非有限输入；断言在结束秒旧片段已不活动。运行四组测试通过。

## Task 3 会话调度与恢复

**Files:** Create `src/scene-capabilities/scheduler.js`; Test `tests/scene-scheduler.test.js`。

**Interfaces:** 产生共享调度器接口；同一所有者的多个参数共用一次快照；上下文和采样格式来自任务1、2。

- [ ] 写失败测试：基线→镜头环境→轨道→片段参数的优先级；0/false不丢失；离开片段恢复轨道值；不变参数不重复apply；过程每帧sample而不重复start；end/dispose恢复一次。
- [ ] 运行 `node --test tests/scene-scheduler.test.js`，确认失败。
- [ ] 实现会话种子、应用缓存和所有者生命周期。环境/画质先恢复，模型参数随后恢复；一个所有者失败时继续恢复其余所有者，收集并报告错误，不隐藏失败。
- [ ] 用假适配器验证部分begin失败后的回滚、某个restore抛错、无基线值、相邻片段切换及同会话重播种子稳定；运行测试通过。

## Task 4 流星数量和可定位的流星过程

**Files:** Modify `src/meteor-shower.js`; Create `src/meteor-film-sampling.js`; Modify `src/config/defaults.json`相关流星参数；Test `tests/meteor-shower.test.js`, `tests/meteor-film-sampling.test.js`。

**Interfaces:** 在流星模块新增 `getRuntimeOptions()`, `setRuntimeOptions(patch)`, `getRuntimeCapabilities()`, `beginFilm(context)`, `sampleFilm(frame, context)`, `endFilm(context)`；采样数据复用现有尾迹/亮点的两个绘制批次，普通 `update` 保留。

- [ ] 写失败测试：每批1、9、18、32和0颗，检查真实发射记录和池中对象，不只读取参数；33颗加载失败；最大并发与每批数量分别生效。
- [ ] 运行流星两组测试，确认失败。
- [ ] 提取现有轨迹和生命周期采样，保持32槽位。开放 `mode`、`burstCount`、`maxActive`、`burstInterval`、`flightDuration`、`lingerDuration`、`brightness`、`bearing`；未覆盖值保留原默认行为。角度以度声明，适配器转换为弧度。
- [ ] 实现通过片段时间确定批次索引、出生时刻和有效个体，计算与当前时间相交的少量批次；不从片头补跑。方向使用片段起点镜头并固定世界朝向。
- [ ] 验证顺序播放与直接定位同一时刻的顶点/亮度一致；检查间隔、拖尾结束、视角改变不改旧轨迹、退出恢复普通活动及依然只有两个流星绘制批次；两组测试通过。

## Task 5 彗星 极光 日月食和星座

**Files:** Modify `src/night-sky.js`, `src/aurora.js`, `src/atmosphere.js`, `src/solar-eclipse.js`, `src/lunar-eclipse.js`, `src/constellation-guides.js`; Create `src/scene-capabilities/sky.js`, `src/celestial-film-sampling.js`; Test `tests/celestial-film-sampling.test.js`, `tests/night-sky.test.js`, `tests/aurora.test.js`, `tests/lunar-eclipse.test.js`, `tests/solar-eclipse.test.js`, `tests/constellation-guides.test.js`（沿用已有文件，有缺项则新增）。

**Interfaces:** 天空模块采用任务4相同影片接口，`atmosphere`只转发公开方法。`createSkyCapabilityBindings({atmosphere, solarEclipse, lunarEclipse})`注册天空所有者与能力。所有者的 `composeEnvironment`复用现有日月食纯函数和染色函数。

- [ ] 写失败测试：日月食直接采样指定进度；跨镜头不重启；彗星样式/时长、极光形态/强度实际进入渲染；`sky.constellation.mode='labels'`同时启用连线和名称，off同时关闭。
- [ ] 运行新增及相关已有测试，确认失败。
- [ ] 复用彗星轨迹、样式数组和极光着色器，增加可采样影片状态；普通自然调度状态不被影片重置。星空/银河开放显示与强度及实际星点数量范围，避免创建另一套天空。
- [ ] 日食/月食用片段相对时间计算进度；月食仍通过 `getLunarEclipseEnvironment`统一月面、天空、海面和世界光色。保留既有昼夜、天气和季节条件。
- [ ] 验证直接拖入、回拖、暂停重复采样、片尾清理、模式快照恢复；月食相对48秒为血月中段，96秒退出；相关测试通过。

## Task 6 环境 灯光 声音与画质适配

**Files:** Create `src/scene-capabilities/environment.js`, `src/scene-capabilities/presentation.js`; Modify `src/simulation.js`, `src/artificial-light-controls.js`, `src/models/lighthouse.js`, `src/models/path-lamps.js`, `src/models/rest-pavilion.js`, `src/models/island.js`, `src/deferred-poetry.js`, `src/audio.js`的必要窄接口；Test `tests/scene-environment-capabilities.test.js`, `tests/scene-presentation-capabilities.test.js`和原有对应测试。

**Interfaces:** `createEnvironmentCapabilityBindings({state})`和 `createPresentationCapabilityBindings({lights, getAudio, getQuality, applyQuality, poetry})`注册各自所有者；灯光模块提供 `getRuntimeOptions/setRuntimeOptions/getRuntimeCapabilities`。

- [ ] 写失败测试：月相设置与恢复；天气预设后风速/风向/雨/雪/雾/云量覆盖进入最终env；路灯/灯塔/亭灯0强度实际熄灭；音乐轨道不重复换曲；临时画质和诗文退出恢复。
- [ ] 运行两个新测试文件，确认失败。
- [ ] 环境覆盖通过所有者 `composeEnvironment`作用于派生环境，不修改WEATHER_CONFIG；风速与归一化风强度、温度相关字段保持一致。数值0不能按“未设置”处理。
- [ ] 灯光强度在各模块自身update中应用，模型、发光材质和实际光源保持一致。复用音频引擎的曲目、模式、暂停与音量接口；音频延迟初始化，音乐速率保持1。
- [ ] 画质在模型数量覆盖之前应用；验证同帧更改画质与数量、退出恢复、音频未加载/失败时静音继续；新旧相关测试通过。

## Task 7 生物和船只运行参数

**Files:** Create `src/runtime-options.js`, `src/scene-capabilities/wildlife.js`; Modify `src/flower-butterflies.js`, `src/meadow-insects.js`, `src/woodland-wildlife.js`, `src/night-wildlife.js`, `src/sunset-birds.js`, `src/models/marine.js`, `src/models/fish-wave.js`, `src/models/lagoon-life.js`, `src/models/sailboats.js`, `src/models/island.js`; Test `tests/wildlife-runtime-options.test.js`及原有对应模型/行为测试。

**Interfaces:** 各群落提供 `getRuntimeOptions()`, `setRuntimeOptions(patch)`, `getRuntimeCapabilities()`，由 `createWildlifeCapabilityBindings({providers})`注册。`island`只转发其持有的蝴蝶、蜜蜂、蜻蜓等子模块接口，不暴露材质或网格路径。

- [ ] 写失败测试：蝴蝶、蜂、蜻蜓、林鸟、松鼠、萤火虫、飞蛾、海鸟、鱼群、鲸豚、海龟、螃蟹、龙虾、鱼浪与帆船的启用及数量可调；超容量明确拒绝；身体、附肢与粒子数量保持一致。
- [ ] 运行 `node --test tests/wildlife-runtime-options.test.js`，确认失败。
- [ ] 共用运行参数容器只处理类型、覆盖和恢复；各模块负责有效数量、已有行为时长/速度/活动范围等参数的应用。公开项目已有运行配置中的相应参数，容量由实际构建结果声明。保留原随机源、栖息地和恶劣天气规则。
- [ ] 数量变化不按帧重建几何，不通过一次性 `mesh.visible=false`对抗后续update。画质与显式数量覆盖遵循统一优先级；退出恢复原参数，动物累计时间不倒退。
- [ ] 验证各群落数量0和容量上限、画质连续切换、资源对象保持同一引用；运行本任务与对应原有行为测试通过，包含松鼠自然退场回归。

## Task 8 接入现有影片与主循环

**Files:** Create `src/scene-capabilities/index.js`; Modify `src/film-camera.js`, `src/film-scene.js`, `src/main.js`, `src/film-clock.js`必要接入点；Test `tests/film-camera.test.js`, `tests/film-scene-capabilities.test.js`, `tests/film-player.test.js`, `tests/film-clock.test.js`。

**Interfaces:** `createSceneCapabilities(dependencies)`产生统一注册表。`createFilmCamera`新增 `getPoseAt(sample)`，只计算而不移动真实相机；`createFilmScene`接受 `capabilities`并提供 `composeEnvironment(baseEnv)`。

- [ ] 写失败集成测试：v2准备、播放、暂停、拖动、重播、退出与后台暂停均调用同一调度器；v1继续使用原语义；直接拖入天象中段使用片段起点姿态，真实相机不会被起点查询移动。
- [ ] 运行四组相关测试，确认失败。
- [ ] 在已有capture/restore中接会话生命周期，在onFrame中采样；先应用状态与画质，再应用模型参数和相机，最后采样依赖镜头的过程。宿主只注入模块和回调，业务规则留在能力目录与适配器。
- [ ] 主循环通过 `filmScene.composeEnvironment`合成影片环境；观影时普通天象调度暂停，退出后恢复；继续使用同一RAF和单调模型时钟。准备取消/失败时收回所有已取得的控制权，迟到音频不能更改新会话。
- [ ] 验证有进行中自然事件时进入/退出、恢复回调部分失败、准备中切后台、倍率与音乐原速、前后拖动、退出一次且状态面板同步；相关测试全部通过。

## Task 9 将夜的回声转换为可播放第二版影片

**Files:** Move并转换 `docs/film-scripts/isola-night-echoes.json` → `src/assets/data/films/isola-night-echoes.json`; Modify `docs/film-scripts.md`；Test `tests/night-echoes-film.test.js`。

**Interfaces:** 只消费任务1至8的公共能力，不新增影片专用命令或主入口分支。

- [ ] 写失败测试：片长180秒、13个镜头连续覆盖；星座84至98秒为labels、此前此后off；76至84秒连续月相；月食154至180秒进入血月后结束；所有能力和参数能由真实目录校验。
- [ ] 运行 `node --test tests/night-echoes-film.test.js`，确认当前草案缺少可执行调度时失败。
- [ ] 将production里的说明性表转换为实际tracks/clips，移除待接入标记。星座弱月光晴夜，连线与中文名称同时显示；其余天象分开展示。加入19条字幕并保留现有音乐，原稿移为唯一运行脚本，避免维护两份同片数据。
- [ ] 使用实际采样器每0.25秒采样全片721个时间点，检查字段、事件与镜头边界；检查曲目文件真实存在。运行影片测试和所有脚本/片库测试通过。

## Task 10 浏览器验收与开发说明

**Files:** Modify `docs/film-scripts.md`, `README.md`, `docs/superpowers/specs/2026-10-18-scene-capability-scheduling-design.md`状态与最终接口；Create `tests/scene-capabilities-browser.html`, `tests/scene-capabilities-browser.js`供真实渲染验收；临时自动化脚本放 `tmp/scripts/scene-scheduling/`。

**Interfaces:** 能力目录由 `listCapabilities()`生成和检查；说明给出可直接复制的参数轨道、18颗流星片段和96秒月食示例，不再手工维护另一套范围表。

- [ ] 在真实浏览器检查1/9/18/32颗流星实际发射与0颗关闭；比较顺序播放和直接定位同一时刻的画面/实例数据，确保没有额外流星绘制批次。
- [ ] 检查星座段：屏幕内实际存在连线和可读中文名称，84秒进入、98秒离开及前后拖动均正确，退出恢复原模式；不是只检查场景中有标签对象。
- [ ] 完整播放180秒，逐段保存截图；重点复核飞蛾、萤火虫、天气、极光、血月、洞口和路灯构图。根据实际遮挡修正机位，不更改主会话花朵与松鼠视觉设计。
- [ ] 检查390与320宽触屏默认精细、播放/暂停/倍率/拖动/退出；星座名称不被字幕和控制栏遮住；切后台暂停、音乐原速和退出完整恢复。
- [ ] 执行 `npm test`，并发保持2；执行 `npm run build -- --outDir tmp/build-scene-scheduling`、`npm run check:resources`、`git diff --check`。浏览器使用该独立构建的空闲端口，不重写其他会话正在验收的构建。
- [ ] 更新能力目录说明和使用示例，记录真实结果与未解决问题；保留代码改动供审阅，不提交、不推送。若与其他会话同时修改同一接入段，先读最新内容后做局部合并，不覆盖其更改。

## 自查与执行交接

覆盖关系：注册与扩展性为任务1；格式、插值与优先级为任务2、3；流星为任务4；其他天空与星座为任务5；环境、灯光、音频和画质为任务6；生物/船只为任务7；恢复、主循环与相机起点查询为任务8；影片迁移为任务9；实际构图和全量验收为任务10。五项Review Focus均已有对应失败用例步骤。

在执行前请用户审阅此计划并确认。按本侧会话约束，执行方式为当前会话直接实现，不使用子代理。实施按任务先失败验证再最小实现；进度与验证日志保存在 `tmp/reports/scene-scheduling/`。


## 实施结果（2026-10-18）

任务1至10已完成，用户后续要求优先于原分镜。最终脚本180秒、13镜头、19字幕，连续月相、星座、分段运动速度与血月结尾已接入。流星复用32槽位；灯光经临时环境字段作用于所属模型；共享时钟群落统一调速。原文件列表中的纯日月食函数直接复用，没有另建重复控制器。

验证：881项测试通过，独立构建、资源检查（417文件、12首音乐）与diff检查通过；浏览器全片721时间点和流星数量检查通过，13镜头均保存截图，并完成一次从片头到片尾的连续播放（4倍速验收）。检查了390/320像素窄屏、星座中文名称、完整月盘、字幕、进度、倍率与退出；退出时原时间/暂停/灯光/画质/音量一致。窄屏验收使用浏览器，没有进行实体手机硬件测试。

按侧会话约束完成作者自查，未使用子代理，不代表独立复审。无提交、推送或worktree操作；临时验证证据保留在项目tmp中。
