# 浮屿 ISOLA

基于 HTML、Three.js 和 Vite 的交互海岛。可以漫游海岸、码头、泻湖、山洞、山顶亭与灯塔，观看昼夜、四季、天气和天象，聆听海浪与器乐。

## 当前版本：v1.2.0

本版本的重要更新：

- **暴风雪天气**：雪天按钮循环飘雪、暴风雪与关闭。近、中、远三层纹理雪花随风飘舞，暴风雪联动强风、大浪、低云和间歇雪幕。
- **厚实雪景**：山体、树枝、洞口外岩、亭顶、灯塔、码头与道路共用颗粒及风纹雪面；亭顶和码头增加厚雪层，积雪覆盖自然斑驳，保留亭子与灯塔暖光。
- **积雪记忆**：下雪逐渐堆积，暴风雪积得更快，到达上限后保持。停雪后先保留再缓慢融化，低温融得较慢；雪后转雨会加快消融，雨越大融得越快，再次降雪从残雪继续累积。
- **冬季植被**：雪景中的树叶和洞口植物褪绿，阔叶减少，鲜花隐藏，树枝保留覆雪。
- **渲染修复**：改善岩石与石阶支撑面的三角拼片感，修圆亭旁尖锐坡面，修复灯塔雪天黑面和暴风雪下泻湖交界。

各版本人工聚合的重要更新保存在 [release-notes.json](src/config/release-notes.json)，按最新版本在前排列，并由设置面板直接读取。

## 启动

需要 Node.js 20.19+ 或 22.12+。

```sh
npm install
npm run dev
```

打开终端显示的本地地址。项目使用 ES 模块，需要通过服务器访问；运行时不访问第三方素材服务器。素材生成工具仅在重新制作素材时使用。

## 目录

```text
src/
  models/              海岛、山洞、建筑、帆船和动物的程序化模型
  config/              文案、版本、曲库与运行配置
  assets/
    textures/
      terrain/         沙地、洞壁、山岩、石阶
      vegetation/      树叶
      sky/             月面、云和银河
      water/           海浪、泡沫、水花
      structures/      灯塔墙面、亭子瓦面
      boats/           船身与帆布图集
    music/             MP3 运行音源、Ogg 制作成品和音源说明
    fonts/             书法字体
    ui/                界面图片与印章
    data/              亮星表和烘焙云体数据
  *.js                 场景控制、运动、材质、加载和共享算法
scripts/
  assets/              星表处理和云体烘焙
  music/               音乐合成、转码；scores/ 存放谱面
  maintenance/         配置与资源引用检查
prompts/textures/      素材生成提示词及输出记录
public/licenses/      素材来源、署名和许可证
tests/               自动测试与浏览器验收页
docs/                长期文档与实施计划
tmp/                 临时文件，不提交
  build/              生产构建
  artifacts/          生成过程与性能报告
  screenshots/        验收截图
  reports/            验证日志
  deploy/             临时部署包
```

海岛和建筑等模型由代码生成，目前没有外部 GLB、GLTF 或 OBJ 文件。模型职责见 [models/README.md](src/models/README.md)。纹理的原始图片和运行成品保留版本文件名，实际引用的资源由 Vite 打包。

## 修改配置

| 文件 | 维护内容 |
| --- | --- |
| [defaults.json](src/config/defaults.json) | 初始时间、速度、季节、自动轮换、诗与漫游开关、天象默认模式和随机等待、资源超时与重试 |
| [weather.json](src/config/weather.json) | 天气预设、雨与台风循环、云量档位及图标、季节候选、温度及自动天气轮换 |
| [camera.json](src/config/camera.json) | 初始视角、各观景位置、视野与控制距离 |
| [rendering.json](src/config/rendering.json) | 默认画质、像素比例、帧率、曝光和星点数量 |
| [music.json](src/config/music.json) | 曲目、标题、文件名、播放列表、播放方式、切换时间、音量及声音预设 |
| [loading.json](src/config/loading.json) | 启动随机提示、真实构建阶段、轮播时间与失败文案 |
| [release-notes.json](src/config/release-notes.json) | 当前版本及按版本归纳的更新说明 |

配置通过静态导入随应用打包，不增加额外的配置下载请求。修改 JSON 后开发服务器会更新页面；部署前需要重新构建。运行时随机种子仍现场生成，每个新场景使用独立状态；几何和着色器公式保留在对应实现中。

默认进入夏日晴天，时间 14:30，速度 0.5×，精细画质，自动轮换天气、季节和月相；诗和声音默认关闭，背景乐音量 80%、环境音 30%。声音始终遵守浏览器的用户手势限制。

### 添加或替换音乐

1. 将 MP3 放入 `src/assets/music/`。
2. 在 `music.json` 的 `tracks` 中加入唯一的 `id`、显示用 `title` 和 `file` 文件名。
3. 普通曲目会自动进入随景播放列表；日落曲目由 `playlists.sunset.trackId` 指定。
4. 执行资源检查、测试和构建。无需再修改播放器中的导入列表。

曲谱、合成方式与素材说明见 [音乐说明](src/assets/music/README.md) 和 [脚本说明](scripts/README.md)。普通音乐与日落音乐复用流式播放器，最多使用两个媒体节点；下一首未准备好时保留当前曲目，不叠加底乐。

## 操作

- 拖动旋转，滚轮缩放；触屏单指旋转、双指缩放。底部切换全岛、海岸、码头、浅海、泻湖、山洞、两座观景亭、灯塔与赏月视角。
- 设置中切换季节、天气、时间、速度、月相和画质；雨按钮循环普通雨、台风、关闭，云按钮循环默认（仅v1）、全部云形·少、中、多。日食、月食位于月相之后。相关天象按钮可切换随机出现、立即出现和关闭。
- 星座支持隐藏、连线与名称、仅连线；极光在冬夜可见。人工灯光可自动变化、关闭灯塔或关闭全部。
- 首次点击声音或播放按钮启用音频；支持暂停、下一首及播放方式切换。诗句在符合满月与可见性条件时显示。
- 相机保存无界面风景 PNG；全屏与禅模式用于沉浸观看。禅模式中点击省略号恢复界面。
- 手机默认收起设置。性能不足时选择均衡或流畅画质。

## 验证与构建

```sh
npm run check:resources
npm test
npm run build
npm run preview
```

自动测试采用受限并发，避免大量模型同时构建。生产结果写入 `tmp/build/`；不要把临时截图、日志或构建产物提交到源码目录。

重新制作素材时可能需要 NumPy、Pillow 或 ffmpeg。音乐时值回归使用与合成脚本相同的 Python 环境：

```sh
PYTHONPYCACHEPREFIX=tmp/python-cache python3 tests/test_scenic_score_timing.py
```

启动开发服务器后，可通过以下页面进行真实 GPU 验收：

- `/tests/materials-browser.html`：材质、海床和石阶。
- `/tests/lunar-eclipse-browser.html`：偏食、红色日冕、血月和复圆。
- `/tests/solar-eclipse-browser.html`：日食和日冕。
- `/tests/performance-audit-browser.html`：场景性能采样。
- `/tests/bloom-gpu.html`：辉光异常值回归。

资源体积、长期缓存优化与测量边界详见 [性能与资源检查](docs/performance-and-resources.md)。

## 开发与发布

本项目以 `main` 为基线。开始新任务时先同步 `origin/main`，再创建不跟踪主分支的 `feat/` 分支；当前未提交工作需先保护。未经明确授权不提交或推送，完整规则见 [AGENTS.md](AGENTS.md)。

GitHub Pages 工作流 `.github/workflows/deploy.yml` 在 `main` 执行安装、测试与构建，成功后发布 `tmp/build/`。手动运行其他分支仅验证、不发布。部署使用相对路径，支持多层网站子目录；不要传入旧的固定 `--base`。

手动部署时，复制 `tmp/build/` **里面的全部内容**，包括 `index.html` 与完整 `assets/`，到目标静态目录。不要上传项目根目录的源码 HTML，也不要只替换构建后的 HTML。

## 素材与实现

海岛、植被、动物、风浪和环境音由程序生成；多种表面纹理由 Imagegen 生成，提示词保存在 `prompts/textures/`。月面使用 NASA CGI Moon Kit 的 LRO 数据，书法字体使用 Ma Shan Zheng 子集。来源与署名见 [public/licenses](public/licenses/)；字体及音乐制作细节随对应目录保留。

无损纹理编码工具：`python3 scripts/assets/optimize-texture.py 原图.png 输出.webp`。工具保留尺寸和透明度，并校验全部 RGBA 字节；没有为缩减体积降低现有 MP3 码率。

这是用于观赏与放松的实时场景，天象的时间、尺寸和染色采用艺术化呈现，不是精密天文模拟。建议使用支持 WebGL 2、开启硬件加速的浏览器。
