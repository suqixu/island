"""Bake original turbulent cloud volumes into compact, synchronous RGBA data.

Requires NumPy and Pillow only when rebuilding. The website decodes the baked
data without Python, image downloads or per-frame volumetric ray marching.
"""
from pathlib import Path
import argparse
import base64
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SPECS = [(1701, 'cumulus'), (4367, 'cumulus'), (9481, 'tower'), (2609, 'cumulus'),
         (7823, 'altocumulus'), (3811, 'cirrus'), (6289, 'cumulus'), (8513, 'altocumulus')]


def noise(rng, shape, frequency):
    values = rng.random((frequency, frequency, frequency), dtype=np.float32)
    for axis, length in enumerate(shape):
        position = np.linspace(0, frequency - 1.001, length, dtype=np.float32)
        index = position.astype(np.int32)
        fraction = position - index
        fraction = fraction * fraction * (3 - 2 * fraction)
        broadcast = [1, 1, 1]
        broadcast[axis] = length
        fraction = fraction.reshape(broadcast)
        values = np.take(values, index, axis=axis) * (1 - fraction) + np.take(values, index + 1, axis=axis) * fraction
    return values.astype(np.float32)


def shifted(values, dy, dx, dz):
    result = np.zeros_like(values)
    destination, source = [], []
    for length, offset in zip(values.shape, [dy, dx, dz]):
        if abs(offset) >= length:
            return result
        destination.append(slice(max(0, -offset), min(length, length - offset)))
        source.append(slice(max(0, offset), min(length, length + offset)))
    result[tuple(destination)] = values[tuple(source)]
    return result


def render(seed, kind, width):
    rng = np.random.default_rng(seed)
    height, slices = width * 3 // 4, 72
    shape = (height, width, slices)
    y = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    x = np.linspace(0, 1, width, dtype=np.float32)[None, :, None]
    z = np.linspace(-.36, .36, slices, dtype=np.float32)[None, None, :]
    field = np.zeros(shape, dtype=np.float32)
    lobes = []

    def add(cx, cy, cz, rx, ry, rz, weight=1):
        lobes.append((cx, cy, cz, rx, ry, rz, weight))

    def crown(cx, cy, rx, ry):
        cz = rng.uniform(-.04, .07)
        add(cx, cy, cz, rx, ry, rx * 1.05)
        for _ in range(11):
            angle = rng.uniform(np.pi, np.pi * 2)
            size = rng.uniform(.028, .065)
            add(cx + np.cos(angle) * rx * .7, cy + np.sin(angle) * ry * .7,
                cz + rng.uniform(-.03, .10), size * rng.uniform(.8, 1.3), size, size * .9, .65)

    if kind == 'altocumulus':
        for row in range(5):
            for column in range(9):
                if rng.random() < .2:
                    continue
                cx = .11 + column * .09 + rng.uniform(-.018, .018)
                cy = .18 + row * .13 + rng.uniform(-.04, .04)
                size = rng.uniform(.025, .044)
                add(cx, cy, rng.uniform(-.025, .025), size * 1.25, size, size * .85, 1.3)
    elif kind == 'cirrus':
        for row in range(5):
            for column in range(15):
                cx = .13 + column * .05
                cy = .39 + row * .045 + np.sin(cx * 6 + row) * .055
                add(cx, cy, rng.uniform(-.035, .035), .055, rng.uniform(.01, .022), .025, .45)
    elif kind == 'tower':
        add(.50, .64, 0, .31, .19, .16)
        crown(.32, .59, .15, .17)
        crown(.65, .56, .16, .19)
        crown(.48, .43, .18, .24)
        crown(.51, .23, .14, .15)
    else:
        # A continuous body fills the lower half; the crowns grow out of it.
        add(.5, .60, 0, .33, .18, .18)
        count = int(rng.integers(5, 8))
        for i in range(count):
            t = i / (count - 1)
            crown(.22 + t * .56, .59 - np.sin(t * np.pi) * rng.uniform(.10, .19),
                  rng.uniform(.10, .15), rng.uniform(.13, .19))

    for cx, cy, cz, rx, ry, rz, weight in lobes:
        q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2
        field += np.exp(-q * 2.1) * weight

    coarse = noise(rng, shape, 7)
    turbulent = coarse * .45 + noise(rng, shape, 19) * .33 + noise(rng, shape, 43) * .22
    density = np.clip((field - .21 - turbulent * .52) * 2.0, 0, 2.5)
    # Fine-scale wisps arise in the density, not from a grain overlay on a shell.
    density *= np.clip(.55 + noise(rng, shape, 61) * .9, 0, 1)
    if kind == 'cirrus':
        density *= .26
    else:
        # A gently irregular condensation base remains softer than a hard cut.
        base = np.clip((.805 + (coarse[:, :, slices // 2] - .5) * .025 - y[:, :, 0]) / .065, 0, 1)
        density *= base[:, :, None]
    del field, coarse, turbulent

    optical_to_sun = np.zeros(shape, dtype=np.float32)
    for step in np.linspace(.009, .48, 32):
        optical_to_sun += shifted(density, round(-.72 * step * height),
                                  round(-.45 * step * width), round(.53 * step / .72 * slices)) * (.48 / 32)
    direct = np.exp(-optical_to_sun * 19)
    overhead = np.cumsum(density, axis=0) / height
    ambient = .22 + .22 * np.exp(-overhead * 7)
    optical = density[:, :, ::-1] * (29 if kind != 'cirrus' else 19) * (.72 / slices)
    transmission = np.exp(-np.cumsum(optical, axis=2) + optical)
    weights = transmission * (1 - np.exp(-optical))
    alpha = 1 - np.exp(-np.sum(optical, axis=2))
    illumination = np.sum(weights * direct[:, :, ::-1], axis=2)
    sky_fill = np.sum(weights * ambient[:, :, ::-1], axis=2)
    rgb = np.stack([illumination * 1.10 + sky_fill * .62,
                    illumination * 1.08 + sky_fill * .78,
                    illumination * 1.04 + sky_fill], axis=2)
    rgb /= np.maximum(alpha[:, :, None], .0001)
    rgb = np.clip(rgb, 0, 1)
    rgb = np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055)
    rgba = np.concatenate([rgb, alpha[:, :, None]], axis=2)
    rgba = np.round(np.clip(rgba, 0, 1) * 255).astype(np.uint8)
    rgba[rgba[:, :, 3] < 2] = 0
    rgba[[0, -1], :, :] = 0
    rgba[:, [0, -1], :] = 0
    return rgba


def pack(data):
    """Byte RLE with literal runs: decode synchronously without dependencies."""
    data = data.tobytes()
    result = bytearray()
    index = 0
    while index < len(data):
        end = index + 1
        while end < min(index + 130, len(data)) and data[end] == data[index]:
            end += 1
        if end - index >= 3:
            result.extend([128 + end - index - 3, data[index]])
            index = end
        else:
            start = index
            index = end
            while index < min(start + 128, len(data)):
                if index + 2 < len(data) and data[index] == data[index + 1] == data[index + 2]:
                    break
                index += 1
            result.append(index - start - 1)
            result.extend(data[start:index])
    return base64.b64encode(result).decode('ascii')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    # This data is a small fallback for direct module users. The normal island
    # preloads the high-resolution photographic cloud atlas instead.
    parser.add_argument('--width', type=int, default=128)
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    folder = ROOT / 'tmp/artifacts/cloud-volumes'
    folder.mkdir(parents=True, exist_ok=True)
    textures = []
    for seed, kind in SPECS[:1] if args.preview else SPECS:
        rgba = render(seed, kind, args.width)
        Image.fromarray(rgba).save(folder / f'{seed}-{kind}.png')
        textures.append({'seed': seed, 'kind': kind, 'width': rgba.shape[1], 'height': rgba.shape[0], 'pixels': pack(rgba)})
        print(f'{seed} {kind}: {len(textures[-1]["pixels"])} bytes', flush=True)
    if not args.preview:
        path = ROOT / 'src/assets/data/cloud-volumes.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(textures, separators=(',', ':')) + '\n')
