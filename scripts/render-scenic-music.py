"""Offline scenic arrangements; outputs local stereo Ogg Vorbis tracks.

The score JSON contains the transcribed traditional melody in beat units.
Writes src/assets/audio and synthesis reports in artifacts/audio.
"""
from pathlib import Path
import json
import math
import subprocess
import sys
import tempfile
import wave
import numpy as np

RATE = 32000
ROOT = Path(__file__).resolve().parents[1]
PITCHES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
           'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

def frequency(name):
    note = (int(name[-1]) + 1) * 12 + PITCHES[name[:-1]]
    return 440 * 2 ** ((note - 69) / 12)

def score_time(score, position):
    """Map score beats to seconds, retaining written changes of tempo."""
    previous, bpm, seconds = 0, score['bpm'], 0
    assert bpm > 0 and 0 <= position <= score['beats']
    for change in score.get('tempoChanges', []):
        assert previous <= change['beat'] <= score['beats'] and change['bpm'] > 0
        if position <= change['beat']:
            break
        seconds += (change['beat'] - previous) * 60 / bpm
        previous, bpm = change['beat'], change['bpm']
    return seconds + (position - previous) * 60 / bpm

def render(score):
    duration = score_time(score, score['beats']) + 7
    mix = np.zeros((round(duration * RATE), 2), dtype=np.float32)
    random = np.random.default_rng(20261005)

    def voice(name, start, length, level, kind='guzheng', pan=0):
        if name == 'R':
            return
        f = frequency(name)
        tail = 4.3 if kind == 'guqin' else 3.7 if kind == 'guzheng' else 1.6 if kind == 'pipa' else .52
        count = min(round((length + tail) * RATE), len(mix) - round(start * RATE))
        if count <= 0:
            return
        t = np.arange(count, dtype=np.float64) / RATE
        tone = np.zeros(count)
        if kind in ('guzheng', 'pipa', 'guqin'):
            # Independently decaying string modes retain the soft body after
            # the bright initial pluck. Small stiffness gives string colour.
            bend = random.uniform(-.004, .004) * (1 - np.exp(-t / .08)) * np.exp(-t / .7)
            phase = 2 * np.pi * f * t + bend * 2 * np.pi * f * np.minimum(t, .12)
            attack = 1 - np.exp(-t / (.0017 if kind == 'pipa' else .0032))
            for harmonic in range(1, 18 if kind == 'guqin' else 22 if kind == 'guzheng' else 16):
                stiffness = .000024 if kind == 'guzheng' else .00004
                ratio = harmonic * math.sqrt(1 + stiffness * harmonic ** 2)
                if ratio * f >= RATE * .46:
                    break
                amplitude = math.sin(np.pi * harmonic * (.31 if kind == 'guqin' else .23)) / harmonic ** (1.4 if kind == 'guqin' else 1.15)
                decay = (.40 + harmonic ** .78 * .21) * (1.55 if kind == 'pipa' else .72 if kind == 'guqin' else 1)
                tone += amplitude * np.sin(ratio * phase) * np.exp(-t * decay)
            tone += .055 * np.sin(2 * np.pi * f * 1.0011 * t) * np.exp(-t * .64)
            # Very brief, band-limited pick excitation, followed by resonance.
            pick = np.convolve(random.normal(0, 1, count), np.ones(7) / 7, 'same')
            tone += pick * .065 * np.exp(-t * 170)
            tone *= attack
        elif kind == 'strings':
            # Soft bowed-string modes with slow attack and restrained vibrato.
            phase = 2 * np.pi * f * t + .27 * np.sin(2 * np.pi * 5.2 * t) * (1 - np.exp(-t / .6))
            for harmonic in range(1, 11):
                if harmonic * f >= RATE * .46:
                    break
                tone += np.sin(harmonic * phase) / harmonic ** 1.65
            tone *= (1 - np.exp(-t / .18)) * np.exp(-np.maximum(t-length*.92,0)/.23)
        else:
            vibrato = .19 * np.sin(2 * np.pi * 4.7 * t) * (1 - np.exp(-t / .5))
            phase = 2 * np.pi * f * t + vibrato
            tone = .80 * np.sin(phase) + .11 * np.sin(2 * phase) + .032 * np.sin(3 * phase)
            breath = np.convolve(random.normal(0, 1, count), np.ones(13) / 13, 'same')
            tone += breath * .042
            attack = 1 - np.exp(-t / .14)
            release = np.exp(-np.maximum(t - length * .88, 0) / .13)
            tone *= attack * release * (.91 + .09 * np.sin(2 * np.pi * .8 * t))
        # Every note ends at zero, including the tails of string modes.
        n = min(256, count)
        tone[-n:] *= np.linspace(1, 0, n)
        signal = (tone * level).astype(np.float32)
        begin = round(start * RATE)
        mix[begin:begin + count, 0] += signal * math.sqrt((1 - pan) / 2)
        mix[begin:begin + count, 1] += signal * math.sqrt((1 + pan) / 2)

    for part in score['parts']:
        position = part.get('start', 0)
        for name, beats in part['notes']:
            start, end = score_time(score, position), score_time(score, position + beats)
            voice(name, start, end - start, part['level'], part['instrument'], part.get('pan', 0))
            position += beats

    # Quiet early room reflections and a diffuse, non-rhythmic stereo tail.
    dry = mix.copy()
    for index, (delay, gain) in enumerate([(.071, .095), (.127, .075), (.191, .055),
            (.283, .040), (.397, .028), (.541, .018), (.719, .011)]):
        offset = round(delay * RATE)
        mix[offset:] += dry[:-offset, ::-1] * gain
    mix -= mix.mean(axis=0)
    peak = float(np.max(np.abs(mix)))
    mix *= .72 / max(peak, .01)
    fade = round(.4 * RATE)
    mix[:fade] *= np.linspace(0, 1, fade)[:, None]
    fade = round(4.5 * RATE)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    assert np.isfinite(mix).all()
    assert 0.005 < float(np.sqrt(np.mean(mix ** 2))) < .4
    assert np.max(np.abs(mix)) <= .721
    output = ROOT / 'src/assets/audio' / (score['id'] + '-synth.ogg')
    with tempfile.TemporaryDirectory(prefix='chunjiang-render-') as folder:
        wav = Path(folder) / 'mix.wav'
        with wave.open(str(wav), 'wb') as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(RATE)
            handle.writeframes((mix * 32767).astype('<i2').tobytes())
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-y', '-i', str(wav), '-af', 'loudnorm=I=-19:TP=-2:LRA=10', '-ar', str(RATE),
            '-c:a', 'libvorbis', '-q:a', '4', '-metadata', 'title=' + score['title'] + ('·完整简谱合成版' if score.get('coverage') == 'full' else '·主题合成版'),
            '-metadata', 'comment=' + ('Complete score; original synthetic arrangement' if score.get('coverage') == 'full' else 'Melody excerpt; original synthetic arrangement'),
            str(output)], check=True)
    result = {'file': str(output), 'seconds': round(duration, 3), 'sampleRate': RATE,
        'channels': 2, 'bytes': output.stat().st_size, 'melodySource': score['source'],
        'description': score['description']}
    if score.get('coverage') == 'full':
        result.update(coverage='full', form=score['form'], sourcePages=score['sourcePages'], tempoChanges=score['tempoChanges'])
    (ROOT / 'artifacts/audio' / (score['id'] + '-report.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    for score in json.loads((ROOT / 'scripts/scenic-scores.json').read_text()):
        if len(sys.argv) == 1 or score['id'] in sys.argv[1:]:
            render(score)
