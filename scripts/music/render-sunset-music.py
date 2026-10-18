"""Render the island's electronic keyboard arrangement; no sampled recording.

Melody reference: EveryonePiano, score 159, public Weather Forecast previews.
https://www.everyonepiano.cn/Stave-159-1.html
https://www.everyonepiano.cn/Stave-159-2.html
Grace notes, voicing, accompaniment and tempo are adapted for this scene.
Requires numpy and ffmpeg only when regenerating the asset, not in the browser.
"""
from pathlib import Path
import json
import subprocess
import tempfile
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RATE, BPM = 32000, 86
BEAT = 60 / BPM
NAMES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'E#': 5,
         'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

def midi(name):
    return (int(name[-1]) + 1) * 12 + NAMES[name[:-1]]

BARS = [
    [('A#5', 1.5), ('C#6', .5), ('D#6', .75), ('F#6', .25), ('D#6', .5), ('C#6', .5)],
    [('A#5', .5), ('A#5', .5), ('G#5', .5), ('F#5', .5), ('D#5', .5), ('C#5', .5), ('A#4', .5), ('G#5', .5)],
    [('F#5', 1.5), ('A#5', .5), ('G#5', .75), ('A#5', .25), ('G#5', .5), ('F#5', .5)],
    [('G#5', .5), ('G#5', .5), ('E#5', .5), ('D#5', .5), ('C#5', .5), ('G#4', .5), ('A#4', .5), ('G#4', .5)],
    [('A#5', 1.5), ('C#6', .5), ('G#5', 1), ('F#5', 1)],
    [('D#6', .75), ('F#6', .25), ('D#6', .5), ('C#6', .5), ('D#6', 2)],
    [('C#5', 1.5), ('D#5', .5), ('F#5', .75), ('A#5', .25), ('G#5', .5), ('F#5', .5)],
    [('C#5', .5), ('C#5', .5), ('A#4', .5), ('G#4', .5), ('E#4', .5), ('D#4', .5), ('C#4', .5), ('G#3', .5)],
    # Second section of the theme; tiny ornaments are simplified for a clear lead.
    [('A#5', 1.5), ('C#6', .5), ('D#6', .75), ('F#6', .25), ('D#6', .5), ('C#6', .5)],
    [('A#5', .5), ('A#5', .5), ('G#5', .5), ('F#5', .5), ('D#5', .5), ('C#5', .5), ('C#6', .5), ('D#6', .5)],
    [('F#6', 1.5), ('D#6', .5), ('C#6', .75), ('D#6', .25), ('C#6', .5), ('A#5', .5)],
    [('G#5', 1), ('G#6', .5), ('E#6', .5), ('D#6', .75), ('C#6', .75), ('B5', .5)],
    [('A#5', 1.5), ('C#6', .5), ('G#5', 1), ('F#5', 1)],
    [('D#6', .75), ('F#6', .25), ('D#6', .5), ('C#6', .5), ('D#6', 2)],
    [('F#5', 1.5), ('G#5', .5), ('A#5', .75), ('C#6', .25), ('G#5', 1)],
    [('F#5', .5), ('F#6', .5), ('D#6', .5), ('C#6', .5), ('A#5', .5), ('G#5', .5), ('F#5', .5), ('D#5', .5)],
    [('F#5', 4)],
]
CHORDS = [
    ('F#2', 'A#3', 'C#4'), ('F#2', 'A#3', 'C#4'), ('D#2', 'F#3', 'A#3'),
    ('C#2', 'E#3', 'G#3'), ('F#2', 'A#3', 'C#4'), ('D#2', 'F#3', 'A#3'),
    ('B2', 'D#3', 'F#3'), ('C#2', 'E#3', 'G#3'), ('F#2', 'A#3', 'C#4'),
    ('F#2', 'A#3', 'C#4'), ('D#2', 'F#3', 'A#3'), ('G#2', 'B3', 'D#4'),
    ('F#2', 'A#3', 'C#4'), ('D#2', 'F#3', 'A#3'), ('C#2', 'E#3', 'G#3'),
    ('F#2', 'A#3', 'C#4'), ('F#2', 'A#3', 'C#4'),
]
ORDER = list(range(8)) + list(range(8)) + list(range(8, 17))
assert all(abs(sum(length for _, length in bar) - 4) < 1e-9 for bar in BARS)
duration = len(ORDER) * 4 * BEAT + 3.6
mix = np.zeros((int(duration * RATE), 2), dtype=np.float64)

def voice(name, start, duration, level, kind='lead', pan=0):
    sustain = max(.07, duration * .92)
    release = .32 if kind == 'lead' else .8 if kind == 'pad' else .19
    count = min(int((sustain + release) * RATE), len(mix) - int(start * RATE))
    t = np.arange(count, dtype=np.float64) / RATE
    frequency = 440 * 2 ** ((midi(name) - 69) / 12)
    attack = .045 if kind == 'lead' else .38 if kind == 'pad' else .009
    env = (1 - np.exp(-t / attack)) * np.exp(-np.maximum(0, t - sustain) / (release / 5))
    if kind == 'arp':
        env *= .35 + .65 * np.exp(-t * 7)
    if kind == 'lead':
        # A rounded reed/organ registration with slow vibrato and a detuned choir.
        phase = 2 * np.pi * frequency * t + .085 * np.sin(2 * np.pi * 5.2 * t)
        tone = sum(weight * np.sin(harmonic * phase) for harmonic, weight in [(1, .78), (2, .15), (3, .065), (4, .025)])
        tone += .1 * np.sin(2 * np.pi * frequency * 1.0018 * t)
    elif kind == 'pad':
        tone = .7 * np.sin(2 * np.pi * frequency * t) + .2 * np.sin(2 * np.pi * frequency * 1.0014 * t)
    else:
        tone = np.sin(2 * np.pi * frequency * t) + .15 * np.sin(4 * np.pi * frequency * t)
    signal = tone * env * level
    left, right = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    begin = int(start * RATE)
    mix[begin:begin + count, 0] += signal * left
    mix[begin:begin + count, 1] += signal * right

for bar_index, source in enumerate(ORDER):
    start = bar_index * 4 * BEAT
    cursor = start
    for note, beats in BARS[source]:
        voice(note, cursor, beats * BEAT, .3, 'lead', -.05)
        cursor += beats * BEAT
    root, third, fifth = CHORDS[source]
    for note, pan in [(third, -.42), (fifth, .42)]:
        voice(note, start, 4 * BEAT, .036, 'pad', pan)
    for beat in [0, 2]:
        voice(root, start + beat * BEAT, 1.7 * BEAT, .095, 'bass')
    pattern = [root, third, fifth, third, root, fifth, third, fifth]
    for step, note in enumerate(pattern):
        voice(note, start + step * .5 * BEAT, .45 * BEAT, .056, 'arp', -.28 if step % 2 == 0 else .28)

# Sparse stereo reflections retain the lead's articulation and give it depth.
dry = mix.copy()
for delay, attenuation in [(.113, .13), (.179, .1), (.271, .075), (.389, .045)]:
    n = int(delay * RATE)
    mix[n:] += dry[:-n, ::-1] * attenuation
mix -= np.mean(mix, axis=0)
mix = np.tanh(mix * 1.2)
mix *= .81 / max(.81, float(np.max(np.abs(mix))))
fade = int(.025 * RATE)
mix[:fade] *= np.linspace(0, 1, fade)[:, None]
tail = int(2.2 * RATE)
mix[-tail:] *= np.linspace(1, 0, tail)[:, None]
peak = float(np.max(np.abs(mix)))
rms = float(np.sqrt(np.mean(mix ** 2)))
assert np.isfinite(mix).all() and peak < .99 and .03 < rms < .3
out = ROOT / 'src/assets/music/yuzhou-changwan-weather.ogg'
out.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='island-sunset-synthesis-') as temporary:
    wav = Path(temporary) / 'electronic-keyboard.wav'
    with wave.open(str(wav), 'wb') as file:
        file.setnchannels(2); file.setsampwidth(2); file.setframerate(RATE)
        file.writeframes((mix * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                    '-af', 'loudnorm=I=-17:TP=-1.5:LRA=10', '-ar', str(RATE),
                    '-c:a', 'libvorbis', '-q:a', '4', str(out)], check=True)
print(json.dumps({'asset': str(out), 'durationSeconds': round(duration, 3), 'bpm': BPM,
                  'sampleRate': RATE, 'channels': 2, 'bars': len(ORDER),
                  'preMasterPeak': round(peak, 4), 'preMasterRms': round(rms, 4),
                  'bytes': out.stat().st_size}, ensure_ascii=False))
