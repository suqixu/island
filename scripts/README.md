# 离线脚本

从项目根目录运行；脚本也根据自身位置定位项目根目录，不依赖当前工作目录。

| 目录 | 内容 |
| --- | --- |
| `assets/` | 亮星表转换、云体积烘焙 |
| `music/` | 曲式展开、器乐与日落音乐合成、MP3 导出 |
| `music/scores/` | 原始完整谱面与展开后的合成谱面 |
| `maintenance/` | 项目结构、配置和资源引用检查 |

生成资源写入 `src/assets/` 的对应类别，数值报告和中间文件写入 `tmp/artifacts/`。生成工具可能需要 NumPy、Pillow 和 ffmpeg；网站启动与构建仅需要 Node.js。

示例：

```sh
python3 scripts/assets/render-cloud-volumes.py --help
python3 scripts/music/create-extra-scores.py
python3 scripts/music/render-scenic-music.py molihua yueer
python3 scripts/music/export-mp3-audio.py molihua yueer
```
