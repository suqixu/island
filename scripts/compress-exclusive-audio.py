"""将用户专属录音转为较小的手机兼容MP3；原件留在未打包的artifacts目录。"""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'yueer-ming-fenger-jing', 'lubinghua', 'hualian', 'tuogao-song',
    'songbie', 'jiegenghua', 'bo-rulai', 'mengzhong-eji', 'dabei-zhou',
    'gongde-baoshan-zhou', 'xinjing', 'island-shange',
]
SOURCE = ROOT / 'src/assets/audio'
ORIGINALS = ROOT / 'artifacts/audio/exclusive-originals'
REPORT = ROOT / 'artifacts/audio/exclusive-compression.json'
FFMPEG, FFPROBE = shutil.which('ffmpeg'), shutil.which('ffprobe')
if not FFMPEG or not FFPROBE:
    raise SystemExit('制作压缩文件需要ffmpeg和ffprobe；网页运行不需要它们。')
ORIGINALS.mkdir(parents=True, exist_ok=True)


def probe(path):
    return json.loads(subprocess.check_output([
        FFPROBE, '-v', 'error', '-select_streams', 'a:0', '-show_entries',
        'stream=codec_name,sample_rate,channels,bit_rate:format=duration,size,bit_rate',
        '-of', 'json', str(path),
    ]))


def decoded_duration(path):
    result = subprocess.run([
        FFMPEG, '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
        '-i', str(path), '-map', '0:a:0', '-f', 'null', '-', '-progress', 'pipe:1',
    ], check=True, capture_output=True, text=True)
    times = re.findall(r'^out_time_us=(\d+)$', result.stdout, re.MULTILINE)
    if not times or 'progress=end' not in result.stdout:
        raise RuntimeError(f'{path.name}: 未完成音频解码')
    return int(times[-1]) / 1e6


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# Always re-encode from preserved originals, never from a previously compressed MP3.
for name in FILES:
    filename = name + '.mp3'
    original = ORIGINALS / filename
    if not original.exists():
        shutil.copy2(SOURCE / filename, original)

rows = []
with tempfile.TemporaryDirectory(prefix='island-exclusive-audio-') as temporary:
    pending = Path(temporary)
    for name in FILES:
        filename = name + '.mp3'
        original, output = ORIGINALS / filename, pending / filename
        before = probe(original)
        subprocess.run([
            FFMPEG, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', str(original), '-map', '0:a:0', '-c:a', 'libmp3lame',
            '-b:a', '64k', '-ar', '32000', '-ac', '2', '-threads', '1',
            '-map_metadata', '-1', '-write_xing', '1', str(output),
        ], check=True)
        after = probe(output)
        # Some uploaded MP3 duration tags are inaccurate; compare the actual decoded timeline.
        before_duration, after_duration = decoded_duration(original), decoded_duration(output)
        duration_difference = abs(before_duration - after_duration)
        stream = after['streams'][0]
        if (duration_difference > .1 or stream['codec_name'] != 'mp3'
                or stream['channels'] != 2 or int(stream['sample_rate']) != 32000
                or int(stream['bit_rate']) != 64000):
            raise RuntimeError(f'{filename}: 音频格式或时长验证失败')
        if output.stat().st_size >= original.stat().st_size:
            raise RuntimeError(f'{filename}: 压缩后未变小')
        rows.append({
            'file': filename, 'beforeBytes': original.stat().st_size,
            'afterBytes': output.stat().st_size, 'beforeDuration': before_duration,
            'afterDuration': after_duration, 'originalMetadataDuration': float(before['format']['duration']), 'durationDifference': duration_difference,
            'sampleRate': int(stream['sample_rate']), 'channels': stream['channels'],
            'bitrate': int(stream['bit_rate']), 'originalSha256': sha256(original),
            'compressedSha256': sha256(output), 'fullDecodePassed': True,
        })
        print(filename, flush=True)
    # Publish only after every recording has passed validation.
    for name in FILES:
        shutil.copy2(pending / (name + '.mp3'), SOURCE / (name + '.mp3'))

before = sum(row['beforeBytes'] for row in rows)
after = sum(row['afterBytes'] for row in rows)
REPORT.write_text(json.dumps({
    'codec': 'MP3', 'bitrate': 64000, 'sampleRate': 32000, 'channels': 2,
    'originalsDirectory': str(ORIGINALS), 'beforeBytes': before, 'afterBytes': after,
    'savedBytes': before - after, 'savedPercent': 100 * (1 - after / before),
    'recordings': rows, 'subjectiveListeningAssessment': False,
}, ensure_ascii=False, indent=2) + '\n')
print(f'专属录音合计 {before / 1e6:.2f} MB → {after / 1e6:.2f} MB')
