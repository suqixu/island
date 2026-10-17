# 泻湖常驻生态与风动实施计划

> **For agentic workers:** 使用 subagent-driven-development 分工实现，主代理统一接线、回归和生产验证。

**Goal:** 泻湖始终有鱼、海龟、螃蟹和龙虾；远海鲸豚更频繁且数量位置自然变化；草与整株树的风动清楚可见。

**Architecture:** 新增独立泻湖居民模块，复用真实地形采样和海水透射。远海活动调度与植被风动分别在原模块内扩展，主循环共享真实累计时间、天气与画质。

**Tech Stack:** HTML、JavaScript、Three.js 0.180.0、Vite 7.1.7、node:test。

**Spec:** 用户本轮追加要求；既有场景与约束见 `docs/design.md`。

## 全局约束

- 全部中文；保留原始工作目录，不创建 worktree，不提交、推送或部署。
- 保留原海雾、日月、诗句、洞穴、三峰石阶、海床、岸线和季节材质。
- 所有动作使用真实累计秒，暂停昼夜后仍继续；不逐帧随机位置或分配材质。
- 不修改背景音乐，不增加环境控制面板。

## 审查重点

- 泻湖浅滩：完整动物轮廓不能穿床、落陆或越过沙洲。
- 暂停和黑夜：常驻居民仍存在，运动连续；低画质保留四类动物。
- 鲸豚一轮活动：群成员共享远海区域，声音与动作同源，不能半途重选位置。
- 固定植物根部：树干与树冠协调，路旁草花摆动，阴影不脱离模型。
- 手机和生产子路径：真实 GPU 编译、动物可见性、低画质与资源加载正常。

### 任务一：泻湖居民

**Files:** 新增 `src/lagoon-life.js`、`src/lagoon-life-motion.js`、`tests/lagoon-life-motion.test.js`、`tests/lagoon-life.test.js`。

**Interfaces:** 消费 `heightAt(x,z)` 和 `LAGOON_LAYOUT`；导出 `createLagoonLife(scene,{heightAt,seed})`，返回 `{group,update(time,env,camera),setQuality(value),dispose(),onEvent}`。

- [x] 先编写并运行失败测试：真实海床安全、连续运动、固定人口、昼夜/画质、资源释放。
- [x] 实现可复现栖息地、游动及腿鳍动作，复用实例几何与材质。
- [x] 运行针对性测试，并抽查实际几何的海床间隙与近景构图。

### 任务二：远海随机活动

**Files:** 修改 `src/marine-motion.js`、`src/marine.js`、`tests/marine-motion.test.js`、`tests/marine.test.js`。

**Interfaces:** 保留 `createMarine(scene,{heightAt,fishSeed})` 与 `update/setQuality/dispose/onEvent`，让纯运动、实例和声效共享同一活动序列。

- [x] 先验证固定时间、位置和数量的旧行为，并写新的随机/错峰失败测试。
- [x] 加入有种子的短间隔活动序列、每次随机海豚数量及候选位置。
- [x] 多种子、画幅和时间抽查；整次活动锚点固定、深水路径完整、后台不积压事件。

### 任务三：整株风动

**Files:** 修改 `src/vegetation-motion.js`、`src/island.js`、`src/island-paths.js`；新增针对性风动测试。

**Interfaces:** 保留 `island.update(time,env)`，共享风速、阵风、方向 uniform；可见和阴影使用同一位移。

- [x] 真实 Scene 失败用例确认树干漏风、路旁草无柔性属性、晴天草尖摆幅不足。
- [x] 加入固定根部的树干/树冠/椰果协调弯曲，路旁草花风动和更明显叶梢摆幅。
- [x] 验证根部不动、连续性、强风增幅、阴影一致及画质/材质/道路回归。

### 任务四：集成与交付

**Files:** 修改 `src/main.js`、README、设计与实施记录；重建 `dist/`、`island-deploy/` 和 `island-deploy.zip`。

- [x] 接入居民初始化、真实时间更新和画质切换，拉近泻湖预设并允许继续缩放。
- [x] 执行 `npm test` 与 `npm run build`；通过后检查生产子路径的昼/夜、低画质、风动、鲸豚和声音。
- [x] 实际截图记录桌面与手机；备份旧生成物、同步部署包、逐文件及 ZIP 完整性校验。

用户已授权本轮开发，代码和验证结果保留供审阅；不执行 Git 提交或线上发布。

### 追加任务五：普通月相比例

**Files:** 修改 `src/moon-framing.js`、`src/atmosphere.js` 的月盘尺寸接线及 `tests/moon-framing.test.js`，新增 `tests/moon-scale-atmosphere.test.js`。

**Interfaces:** `getMoonBackdropSize(width,height,phase)` 和 `getMoonBackdropScale(camera,width,height,phase,moonDirection)`；满月保留旧尺寸，其他七个预设与日盘接近的22至36像素，自动相位在亮面99%至99.95%窄窗口平滑放大。

- [x] 先红后绿的纯比例与实际大气模型测试；位置、材质、纹理、透明暗部、海雾保持。
- [x] 生产浏览器切换月牙、弦月、凸月与满月，检查桌面和手机比例。
