# 浮屿宣传片脚本播放器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有小岛内播放、暂停、重播约180秒的慢游宣传片，脚本在项目维护，通过网页播放列表选择，并可继续添加新影片。

**Architecture:** 纯脚本校验/时间线与场景适配分离；播放器提供独立真实秒时钟，由既有帧循环调用。镜头解析实际地标，UI和音频通过适配器连接；退出恢复观影前的设置与镜头。

**Tech Stack:** JavaScript ES模块、Three.js 0.180.0、Vite、现有Web Audio/音乐播放器、Node原生测试与真实Chrome验收，不新增依赖。

**Spec:** [已确认设计](../specs/2026-10-18-island-film-design.md)

## 最新范围修订

用户已确认改为项目脚本目录＋网页播放列表，不做导入/导出；采用 `src/assets/data/films/*.json` 自动发现。下文早期涉及文件选择和下载的步骤不再执行，改为新增第二份项目脚本/坏脚本隔离验收。宣传片运镜沿用现有场景与声音；用户随后要求花朵与松鼠使用Imagegen，增加共享花瓣与毛皮纹理，花叶复用阔叶纹理；花瓣保留多彩、花蕊以白粉红黄为主。播放控件按最新要求仅保留播放/暂停、倍速、退出，拖动回开头可重看；倍率循环1.0→0.5→1.5→2→3→4，音乐原速。返回键固定在电影图标前，共用设置弹窗并记住当前页面。录制和配套导入导出明确留到下次。执行记录与具体替代步骤见 `tmp/reports/film/progress.md`。

## Global Constraints

- 中文交互、文案和长期文档。
- 沿用当前合法 `feat/flower-butterflies` 分支和项目原目录，保留未提交改动；不创建worktree，不提交或推送。
- 首屏保持默认静音、按用户播放操作加载音频；手机继续默认精细。
- 脚本是纯JSON，`format: "isola-film"`、`schemaVersion: 1`；仅引用现有地标、天气与音乐ID。
- 播放、暂停、重播、退出、可拖动进度；用户最新要求支持1.0/0.5/1.5/2/3/4倍速，音乐同步；无视频编码导出。
- 只保留既有一条帧循环，复用剔除和相机安全机制。
- 临时截图、报告、构建均写 `tmp/`；所有完成声明必须有实际验证。

## Review Focus

- 准备音频时退出、重复播放或卸载，迟到的Promise不能重新开始播放；任务3/5覆盖。
- 非法脚本、未知版本、超大文件不能替换当前可播放脚本或改变场景；任务1/4覆盖。
- 暂停与后台期间声音和场景必须一起暂停，返回不能追赶积压时间/声效；任务3/5覆盖。
- 随机林缘、地表高差、亭顶与手机窄屏可能使镜头穿模或丢主体；任务2/6覆盖。
- 退出恢复原设置、手动音乐状态、镜头与控件，不让电影模式污染普通漫游；任务3/5/6覆盖。

## Task 1：脚本格式、时间线与内置180秒分镜

**Files:** 新建 `src/film-script.js`、`src/config/film.json`、`src/config/film-introduction.json`、`tests/film-script.test.js`。

**Interfaces:**
- `parseFilmScript(input, {maxBytes}?)` 接受JSON文本或普通对象，返回归一化的独立数据，失败抛含中文说明的Error。
- `sampleFilmScript(script, seconds)` 返回 `{time, shot, progress, environment, captions, music, fade, ended}`，时间夹在0和duration之间。
- `serializeFilmScript(script)` 返回可再次解析的JSON文本。
- 结构：标题/总时长；`shots[]` 各含 `id,start,end,landmark,camera[{at,position:[x,y,z],target:[x,y,z],fov}],environment[{at,hour,season,weather,snowCover}],caption`；可选独立 `captions[]`；`music:{trackId,musicVolume,ambientVolume,fadeIn,fadeOut}`。
- 地标白名单：`island,dock,reef,lagoon,cave,flowers,woodland,lighthouse,pavilion-south,pavilion-east,moon`。镜头向量相对地标；`at` 为镜头内秒数。
- 配置限制：脚本1MiB、时长1至1800秒、最多128镜头/512字幕/每镜头128关键点；向量和时间必须有限，FOV 25–90°，音量0–1，镜头完整覆盖时间线、无重叠或空档；字幕用纯文本。

- [ ] 先写失败测试：有效脚本导出导入等价；未知版本、非有限向量、重叠/空档、无效地标/天气/曲目、超限输入拒绝；负时间/片尾、字幕边界、环境跨午夜和镜头关键点连续。
- [ ] 运行 `node --test tests/film-script.test.js` 确认针对缺失实现失败。
- [ ] 实现纯解析/校验/采样与中文配置；内置镜头按设计的0/25/55/85/115/145/165/180秒分段，四季段允许细分镜头，字幕用简短中文。
- [ ] 运行专项测试；内置JSON使用同一解析器校验。更新计划勾选状态，保留改动。

## Task 2：地标镜头解析与路径安全

**Files:** 新建 `src/film-camera.js`、`tests/film-camera.test.js`。

**Interfaces:**
- `createFilmCamera({camera,controls,landmarks,heightAt})` 返回 `{apply(sample),reset(),dispose()}`；`landmarks` 为ID到世界位置/视线基准的映射，`heightAt(x,z)` 使用真实渲染地表。
- `apply` 使用时间线样本，插值相对关键点的position/target/FOV。相邻关键点平滑衔接，章节切换以短暂淡出遮蔽不能安全连贯移动的跨度；不逐帧重建路径或扫描整岛。
- 洞前与林径地标由集成层采样真实花心/当轮栖息地；亭子按实际地台和入口方向，避免镜头路径穿屋顶。

- [ ] 先写失败测试：不同世界地标偏移、关键点端点与中间连续、地表最小净空0.65米、FOV插值；随机林径/移动地标不读取固定旧位置。
- [ ] 跑专项确认失败，再实现路径采样与净空；相机安全组件继续做最终保护，建筑路径按实际入口布置。
- [ ] 运行 `node --test tests/film-camera.test.js`；在真实地形/亭子上批量检查路径采样，截图留到任务6。

## Task 3：播放状态机和退出恢复

**Files:** 新建 `src/film-player.js`、`tests/film-player.test.js`。

**Interfaces:**
- `createFilmPlayer({capture,restore,prepare,onFrame,onStatus})` 返回 `{load(script),play(),pause(),resume(),restart(),exit(),update(nowMs),getState(),dispose()}`。
- `capture()` 返回场景快照；`restore(snapshot)` 恢复；`prepare(script)` 异步准备资源/音频；`onFrame(sample)` 接任务1采样；`onStatus` 通知UI和声音适配器。
- 状态为 `idle/preparing/playing/paused/ended`；用户播放时才capture与prepare；只在外部 `update(nowMs)` 推进，不自行建立RAF。
- 初次播放时间0；暂停不累计；片尾停在duration；重播从0开始但保留原快照；退出与dispose幂等，取消未完成准备；后台调用pause，回来等待用户resume。

- [ ] 先写失败测试：模拟可控时间下播放、暂停、继续、片尾与重播；观察真实快照数据恢复；准备中退出/重播/卸载后迟到结果无效；无二次恢复与积压提示。
- [ ] 运行专项确认失败，再实现状态机与生命周期标记。
- [ ] 运行 `node --test tests/film-player.test.js`，并与脚本、镜头测试一起验证。

## Task 4：宣传片入口、字幕与脚本文件

**Files:** 新建 `src/film-ui.js`；修改 `index.html`、`src/style.css`，必要时新建 `tests/film-ui-browser.html/js`。

**Interfaces:**
- `createFilmUI({player,defaultScript,onError})` 返回 `{update(sample,status),dispose()}`；通过播放器接口触发操作，不直接改场景。
- 新入口“宣传片”，面板含默认片名/时长、播放、导入脚本、导出脚本；观影浮层含暂停/继续、重播、退出、时间进度和字幕。
- 文件输入先检查大小，解析成功才load；导出用Blob且下载后释放URL；关闭/卸载移除监听与临时节点。

- [ ] 用浏览器验收页先复现缺少UI/导入导出行为；任务1测试作为所有导入数据的校验边界，不为纯文案写镜像测试。
- [ ] 实现中文入口、无障碍标签、文本字幕、触屏布局；输入事件不穿透到OrbitControls；Escape退出，恢复之前普通UI状态。
- [ ] 浏览器检查非法文件保持原脚本、有效脚本导入后标题/时长正确、导出可再次解析、字幕不用innerHTML、手机按钮可点。

## Task 5：主场景与声音接入

**Files:** 新建 `src/film-scene.js`；修改 `src/main.js`；必要修改 `src/audio.js`、`src/scenic-music.js` 并在现有音频测试中补实际播放控制回归；更新README/设计文档。

**Interfaces:**
- `createFilmScene({...})` 组合相机、播放器和UI；接收state/scene/camera/controls/island/restPavilions/lighthouse及音频回调，返回 `{update(nowMs),active,paused,dispose()}`。
- main提供 `ensureAudio()` 从现有toggleSound初始化提取，仍需用户手势；电影声音用现有 `setMusicPlayback({mode:'single',trackId,paused})`、音量和 `setEnabled`，仅在必要时给音乐引擎补重播从曲首开始的 `restartTrack()`。
- capture/restore覆盖时间、速度、天气/季节及自动开关、雪、镜头/target/FOV/控件限制、漫游与人工灯光、普通UI开关、声音/曲目/音量/暂停状态；画质不切换。
- frame在普通simulation之前调用电影update。播放时由电影秒数驱动场景elapsed，关闭自动时间/天气/季节轮换和镜头竞争；暂停或片尾仅重绘、不推进动画/环境。现有剔除照常执行。
- 电影播放中使用现有active帧率上限，不改默认idle上限；页面后台暂停画面和音频，退出恢复普通逻辑。

- [ ] 先写失败回归：曲目重播从头、暂停/恢复不换曲、准备中退出不会恢复音频；普通声音默认与按需加载保持。
- [ ] 实现接入，保持一条RAF、既有相机安全/剔除/资源清理顺序；字幕和声音淡入淡出取同一时间线。
- [ ] 运行相关film/audio/frame-loop/runtime测试，再跑 `npm test`、`npm run build`、`npm run check:resources`。

## Task 6：完整播放与回归验收

**Files:** 临时脚本/报告/截图写入 `tmp/scripts/`、`tmp/reports/film/`、`tmp/screenshots/`；长期说明更新 `README.md`、`docs/design.md`。

- [ ] 桌面真实Chrome从用户点击开始完整播放180秒，记录各章节截图、时序、控制台/资源/WebGL错误；实际检查至少一段音乐和环境音已启动。
- [ ] 在准备中退出、片中暂停5秒后继续、后台切换、片尾重播、退出恢复；记录时钟/字幕/声音一致性。
- [ ] 导出当前脚本后重新导入再播放；超大/非法/未知版本文件不破坏现有场景。
- [ ] 390×844触屏环境检查默认精细、字幕/控件、地标构图与退出操作；沿路径密集采样确认净空和亭内可见性。
- [ ] 运行最终全量测试/构建/资源检查和 `git diff --check`；逐项复核设计目标。报告实际结果及限制，不提交或推送。
