"""无损 WebP 编码；逐像素验证尺寸、RGBA 与透明度。不会缩放或改变图像内容。"""
from pathlib import Path
import argparse
from PIL import Image


def optimize(source, target):
    with Image.open(source) as image:
        rgba = image.convert('RGBA')
        target.parent.mkdir(parents=True, exist_ok=True)
        options = dict(format='WEBP', lossless=True, exact=True, method=6)
        for key in ('icc_profile', 'exif'):
            if image.info.get(key):
                options[key] = image.info[key]
        rgba.save(target, **options)
        with Image.open(target) as encoded:
            if encoded.size != rgba.size or encoded.convert('RGBA').tobytes() != rgba.tobytes():
                raise RuntimeError('无损校验失败，不能替换原资源')
    print(f'{source.stat().st_size:,} → {target.stat().st_size:,} bytes；RGBA逐像素一致：{target}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.target.resolve():
        parser.error('请输出到独立文件，验证后再替换运行资源')
    optimize(args.source, args.target)
