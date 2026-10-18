# 场景音乐音源

场景曲目使用记谱音高和时值合成，移调并自编稀疏伴奏，不含原演奏录音。连同日落曲，共12首器乐音乐；《茉莉花》《月儿明风儿静》按完整简谱演奏，其他曲目为主题节选。

| 曲目 | 场景 | 文件 | 时长 | 合成音色 |
| --- | --- | --- | --- | --- |
| 春江花月夜 | 明月夜 | chunjiang-synth.mp3 | 96秒 | 箫与筝弦 |
| 彩云追月 | 晴日、月夜轮换 | caiyun-synth.mp3 | 115秒 | 轻柔吹管与筝弦 |
| 平沙落雁 | 雨雾、秋景、暗夜 | pingsha-synth.mp3 | 203秒 | 古琴式拨弦与泛音 |
| 孟姜女哭长城 | 雨雾、秋景、暗夜 | mengjiang-synth.mp3 | 69秒 | 箫与筝弦 |
| 山歌好比春江水 | 晴日轮换 | shange-synth.mp3 | 67秒 | 笛与筝弦 |
| 我的祖国 | 晴日轮换 | zuguo-synth.mp3 | 111秒 | 柔和弦乐与筝弦 |
| 梁祝 | 月夜、雨雾秋景 | liangzhu-synth.mp3 | 77秒 | 柔和弦乐与筝弦 |
| 女儿情 | 明月夜 | nuerqing-synth.mp3 | 92秒 | 筝弦 |
| 枉凝眉 | 月夜、雨雾秋景 | wangningmei-synth.mp3 | 75秒 | 箫与古琴式拨弦 |
| 茉莉花（完整版） | 晴日轮换 | molihua-synth.mp3 | 120.8秒 | 笛与筝弦 |
| 月儿明风儿静（完整版） | 月夜、雨雾秋景 | yueer-synth.mp3 | 153.4秒 | 箫与筝弦 |

旋律主题参考：[春江花月夜中阮谱](https://www.hkco.org/uploads/docs/5a8b86d5034b11.pdf)、[彩云追月简谱](https://www.everyonepiano.cn/Number-2313-2.html)、[平沙落雁记谱](https://www.qupu123.com/qiyue/guzhengguqin/p187672.html)。参考图片和PDF不随产品分发，伴奏、音色、混响独立制作，无第三方录音或音色采样。

新增八首的参考来源见 `public/licenses/Scenic-music.txt`。曲目原作归各自作者，本项目独立合成伴奏和音色，不分发参考乐谱或演奏录音。《茉莉花》完整覆盖两页24个谱面小节，第1至13小节按反复记号演奏两遍，展开为37小节；保留后半段八度加倍、第22小节起减速与终止和弦。《月儿明风儿静》完整覆盖三页61小节，含5小节前奏、三段各17小节旋律及5小节尾奏。两首不额外插入段落或停顿，末尾保留7秒合成余音空间，均无人声。后者以独立曲目 `yueer` 加入普通歌单，与灯塔点击触发的同名演唱录音 `lighthouse` 分开。

两首的分段文字简谱、逐小节时值、谱面页链接、曲式说明和反复次数保存在 `scripts/music/scores/full-scores.json`；运行 `python3 scripts/music/create-extra-scores.py` 会按曲式展开并生成 `scripts/music/scores/scenic-scores.json`，其中 `form` 记录段落起止拍，`tempoChanges` 记录速度变化。参考谱的钢琴左手伴奏由本项目独立稀疏伴奏替代。完整曲式与减速分别由 `tests/full-scenic-scores.test.js`、`tests/test_scenic_score_timing.py` 验证；后者使用合成时同一 NumPy 环境运行。

可编辑 `scripts/music/scores/scenic-scores.json` 的声部音高和拍数，通过 `python3 scripts/music/render-scenic-music.py` 重新合成；制作需要 NumPy 和 ffmpeg，网页只播放成品。可在命令末尾传入曲目ID，只重生成指定曲目，例如 `python3 scripts/music/render-scenic-music.py molihua yueer`。八首新增曲目的输入与稀疏伴奏生成脚本为 `scripts/music/create-extra-scores.py`，运行后更新对应JSON条目。合成脚本输出32kHz、双声道Ogg Vorbis，再执行 `python3 scripts/music/export-mp3-audio.py molihua yueer` 仅导出这两首MP3供网页使用；省略曲目ID会导出全部Ogg。旧Ogg保留为生成源，部署仅引用MP3。数值和时长报告在 `tmp/artifacts/audio/`。

12首音乐共用一个流式播放器，只在开启声音后请求曲目，最多复用两个媒体节点。普通场景稳定4秒后更新后续曲目，当前曲目保持播放到自然结束；日落优先交接需要当前曲目已播放至少20秒，旧曲先用1.5秒淡至零，再用1.5秒淡入新曲，两条音量包络不重叠。下一曲尚未就绪时保留当前曲目，不临时叠加振荡器底乐。页面隐藏、静音和系统音频中断会暂停，恢复时继续原曲进度。

默认背景音乐80%、环境音30%。两个音量滑块仍独立控制；海浪、风铃、鸟声等内部动态与场景切换保持原样。

## 日落音乐

当前使用《渔舟唱晚》的电子琴合成版。用户已选择天气预报旋律并授权直接合成；主旋律参考公开乐谱，音色、伴奏与混响为本项目生成，听感与天气预报原录音有所区别。

已打包文件为 `yuzhou-changwan-weather.ogg`，约73秒、双声道，所有电子琴声部由数学波形合成，无第三方录音或音色采样。生成源码为 `scripts/music/render-sunset-music.py`，制作时依赖 NumPy 和 ffmpeg，网页运行时无需这些工具。

替换音源时，将 MP3 放入本目录，修改 `src/config/music.json` 对应曲目的 `file` 字段；日落曲目由 `playlists.sunset.trackId` 指定。播放器按照配置建立 MP3 曲库，Ogg 保留为生成源，不参与网页播放。修改后重新构建即可；无需改 JavaScript 导入清单。

## 加载与地标视角

音乐引擎及12首器乐曲目地址在首次点击播放/声音时加载，不阻塞海岛首屏初始化。地标按钮只切换观看视角；已移除全部连点彩蛋、专属录音、音乐触发的熄灯和诗句隐藏。彩蛋录音已从运行资源目录和发布包移除。
