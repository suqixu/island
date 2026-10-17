"""为场景合成音源导出手机兼容的 MP3；保留 Ogg 作为原始成品。"""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
encoder = shutil.which('ffmpeg')
if not encoder:
    raise SystemExit('需要安装 ffmpeg 才能导出音频；网页运行和构建不需要它。')
for source in sorted((root / 'src/assets/audio').glob('*.ogg')):
    target = source.with_suffix('.mp3')
    subprocess.run([encoder, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', str(source), '-codec:a', 'libmp3lame', '-q:a', '4', '-ar', '32000',
                    str(target)], check=True)
    print(target.name)
