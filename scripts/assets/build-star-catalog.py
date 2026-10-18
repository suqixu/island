"""Build the local, magnitude-limited J2000 sky from CDS V/50.

Usage: python3 scripts/assets/build-star-catalog.py /path/to/catalog.gz
Download: https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz
Field definitions: https://cdsarc.cds.unistra.fr/ftp/V/50/ReadMe
No runtime network access is needed by the island.
"""
import gzip
import json
from pathlib import Path
import sys

source = Path(sys.argv[1])
opener = gzip.open if source.suffix == '.gz' else open
stars = []
with opener(source, 'rt', encoding='ascii') as stream:
    for row in stream:
        if not row[75:77].strip() or not row[102:107].strip():
            continue
        magnitude = float(row[102:107])
        if magnitude > 5.8:
            continue
        ra = (int(row[75:77]) + int(row[77:79]) / 60 + float(row[79:83]) / 3600) * 15
        dec = (int(row[84:86]) + int(row[86:88]) / 60 + int(row[88:90]) / 3600)
        if row[83] == '-':
            dec = -dec
        bv = float(row[109:114]) if row[109:114].strip() else .45
        stars.append([int(row[:4]), round(ra, 5), round(dec, 5), magnitude, bv])
stars.sort(key=lambda star: (star[3], star[0]))
output = Path(__file__).resolve().parents[2] / 'src/assets/data/bright-stars.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(stars, separators=(',', ':')) + '\n')
print(f'{len(stars)} stars → {output}')
