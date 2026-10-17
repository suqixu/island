"""Curated melody excerpts and complete scores with independent sparse accompaniment.
Run before render-scenic-music.py; existing score IDs are preserved.
"""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCALE=[0,2,4,5,7,9,11]
NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def parse(notation,tonic):
 result=[]
 for token in notation.replace('|',' ').split():
  name,length=token.split(':');m=re.fullmatch(r'([0-7])([\',]*)',name);assert m,token
  degree=int(m[1]);octave=m[2].count("'")-m[2].count(',')
  midi=tonic+SCALE[degree-1]+12*octave if degree else None
  result.append(['R' if midi is None else NAMES[midi%12]+str(midi//12-1),float(length)])
 return result
SPECS=[
 ('mengjiang','孟姜女哭长城',65,64,'xiao',
 "1:.25 6,:.25 1:.5 1:.5 2:.5 | 3:.25 5:.25 3:.25 2:.25 3:.5 2:.25 3:.25 | 5:.5 6:.25 1':.25 6:.25 5:.25 3:.25 2:.25 | 3:.25 5:.25 2:1.5 | 5:.5 6:.25 1':.25 6:.25 5:.25 3:.25 2:.25 | 1:.25 6,:.25 1:.25 2:.25 3:.5 5:.25 6:.25 | 5:.375 3:.125 2:.25 1:.25 2:.25 5,:.25 6,:.25 1:.25 | 6,:.25 1:.25 5,:1.5 | 6,:.25 1:.25 5,:.25 6,:.25 1:.75 2:.25 | 3:.25 5:.25 3:.25 2:.25 3:.5 5:.25 6:.25 | 5:.25 3:.25 2:.25 3:.25 7,:.25 6,:.25 5,:.25 5,:.25 | 6,:.25 7,:.25 6,:.25 5,:.25 6,:1 | 7,:.5 3:.25 5:.25 3:.25 2:.25 7,:.25 6,:.25 | 5,:.25 3,:.25 5,:.25 6,:.25 1:.75 2:.25 | 5:.25 3:.25 2:.25 1:.25 2:.25 5,:.25 6,:.25 1:.25 | 6,:.25 1:.25 5,:1.5",
 'https://music.hgnu.edu.cn/_upload/article/files/09/d4/faf43ffb4e08b61cf64ee0adaf16/f952a486-61db-445b-83af-ada858d65ad0.pdf'),
 ('shange','山歌好比春江水',65,76,'flute',
 "3:.75 2:.25 1:.5 2:.5 5:.75 3:.25 | 2:1.5 1:.25 6,:.25 | 5,:.75 6,:.25 1:1 | 3:.5 2:.25 3:.25 2:.5 1:.5 | 6,:.5 5,:.5 6,:.5 1:.5 | 2:.5 6,:.5 7,:.5 6,:.5 | 5,:1 5,:.25 6,:.25 1:.25 2:.25 | 3:.5 3:.5 3:.5 3:.5 | 3:.25 5:.25 3:.25 2:.25 1:.5 2:.5 5:.75 3:.25 | 2:1.5 1:.25 6,:.25 | 5,:.75 6,:.25 1:1 | 3:.5 2:.25 3:.25 2:.5 1:.5 | 6,:.5 5,:.5 6,:.5 1:.5 | 2:.5 6,:.5 7,:.5 6,:.5 | 5,:1 6,:.5 1:.5 | 3:.5 2:.25 3:.25 6,:.25 5,:.25 6,:.5 | 5,:1 1:2",
 'https://www.everyonepiano.cn/Stave-587-1.html'),
 ('zuguo','我的祖国',67,76,'strings',
 "3:.5 3:.5 5:.5 3:.5 2:1 3:1 | 6:.5 3:.5 6:.5 1':.5 5:1.5 5:.25 6:.25 7:.25 1':.25 | 5:.5 5:.5 5:.5 1':.5 6:1 5:.5 6:.5 | 4:.5 1':.5 5:.5 6:.5 5:1.5 5:.5 | 3:.5 2:.25 2:.25 3:.5 5:.5 3:.5 7,:.25 6,:.25 5,:1 | 1:.5 6,:.5 1:.5 2:.5 6,:1.5 1:.5 | 7,:.75 6,:.25 3:.5 2:.5 3:2 | 1:.5 2:.5 6,:.5 5,:.5 1:1.5 6,:.5 | 3:.5 5:.5 1':.5 7:.25 6:.25 5:2 | 5:1 6:.5 5:.5 3:.5 2:.5 3:1 | 5:.5 3:.5 6,:.5 1:.5 5,:1.5 5,:.25 6,:.25 7,:.25 7,:.25 | 5,:.5 5,:.5 3:.5 1:.5 6,:1 5,:.5 6,:.5 | 4,:.5 1:.5 5,:.5 6,:.5 3:1.5 2:.5 | 1:.5 2:.25 2:.25 3:.5 5:.5 3:.5 7,:.25 6,:.25 5,:1 | 1:.5 6,:.5 1:.5 2:.5 6,:1.5 1:.5 | 7,:.75 1:.25 3:.5 2:.5 1:2",
 'https://www.everyonepiano.cn/Number-10436-2.html'),
 ('liangzhu','梁祝',55,63,'strings',
 "3:1 5:.75 6:.25 1':.75 2':.25 6:.25 1':.25 5:.5 | 5':.75 1':.25 6':.25 5':.25 3':.25 5':.25 2':2 | 2':.5 2':.25 3':.25 7:.5 6:.5 5:.75 6:.25 1':.5 2':.5 | 3:.5 1':.5 6:.25 5:.25 6:.25 1':.25 5:2 | 3':.75 5':.25 7:.5 2':.5 6:.25 1':.25 5:.5 5:1 | 3:.375 5:.125 3:.5 5:.25 6:.25 7:.25 2':.25 6:2 | 1':.75 2':.25 5':.5 3':.5 2':.5 3':.25 2':.25 1':.5 6:.25 5:.25 | 3:1 1':1 6:.375 1':.125 6:.25 5:.25 3:.25 5:.25 6:.25 1':.25 | 5:4",
 'https://www.everyonepiano.cn/Number-439-1.html'),
 ('nuerqing','女儿情',48,88,'guzheng',
 "5:.5 6:.5 | 1':3 2':1 | 3':1 7:1 6:.5 7:.5 5:1 | 6:2 6:.5 7:.5 5:1 | 6:2 1':1 2':1 | 3':3 5':1 | 6':1 1'':1 2'':.5 3'':.5 4'':1 | 3'':3 2'':1 | 3'':2 3':1 5':1 | 6':3 5':1 | 6':2 6':1 3':1 | 2':3 1':1 | 2':2 3':2 | 5:3 6:1 | 7:1 3':2 6:1 | 1':4",
 'https://www.everyonepiano.cn/Number-14828-2.html'),
 ('wangningmei','枉凝眉',50,65,'xiao',
 "1':.5 7:.5 6:.5 3':.5 3':.5 5':.5 6':1 | 3':.5 3':.5 3'':.2 2'':.2 1'':.2 6':.2 5':.2 3':2 | 2':.5 3':.25 2':.25 2':.5 2':.5 6':1 1'':.5 2'':.5 | 2'':.5 6':.5 6':.2 5':.2 3':.2 2':.2 1':.2 6':2 | 1':1 2':1 3'':.5 3'':.25 6':.25 3'':1 | 2':.5 5':.25 7':.25 2'':.25 5'':.25 5'':.5 7':1 2'':.5 2'':.5 | 3'':1 5'':1 1'':1 6':1 | 6':1 7':1 6':.5 7':.25 3':.25 3':1 | 1':2 6:2",
 'https://www.everyonepiano.cn/Number-2094-1.html')]
full_specs=json.loads((ROOT/'scripts/full-scores.json').read_text())
path=ROOT/'scripts/scenic-scores.json';scores=json.loads(path.read_text());ids={s[0] for s in SPECS}|{s['id'] for s in full_specs};scores=[s for s in scores if s['id'] not in ids]
for id,title,tonic,bpm,lead,notation,source in SPECS:
 melody=parse(notation,tonic);seq=melody+[['R',2]]+melody;beats=sum(n[1] for n in seq)
 # Independent open-fifth accompaniment; reference piano parts are not copied.
 back=[];time=0
 while time<beats:
  length=min(4,beats-time);midi=tonic-12+(7 if int(time//4)%2 else 0)
  back.append([NAMES[midi%12]+str(midi//12-1),length]);time+=length
 scores.append({'id':id,'title':title,'bpm':bpm,'beats':beats,'source':source,'numberedMelody':notation,'tonicMidi':tonic,'description':'主旋律主题节选、移调与简化装饰音，伴奏和音色由本项目制作；非原演奏录音或完整全曲复刻。','parts':[{'instrument':lead,'level':.17 if lead!='guzheng' else .23,'pan':-.12,'notes':seq},{'instrument':'guqin' if id=='wangningmei' else 'guzheng','level':.037,'pan':.3,'notes':back}]})
for spec in full_specs:
    seq, form, tempos, doubles, written = [], [], [], [], []
    position = 0
    for section in spec['sections']:
        bars = section['bars']
        for bar in bars:
            assert sum(length for _, length in parse(bar, spec['tonicMidi'])) == spec['meter'], bar
        notation = ' | '.join(bars)
        notes = parse(notation, spec['tonicMidi'])
        repeat = section.get('repeat', 1)
        assert isinstance(repeat, int) and repeat > 0
        if 'bpm' in section:
            tempos.append({'beat': position, 'bpm': section['bpm']})
        start = position
        for _ in range(repeat):
            if section.get('octaveDoubleBeats'):
                doubled, remaining = [], section['octaveDoubleBeats']
                for name, length in notes:
                    if remaining <= 0:
                        break
                    doubled.append(['R' if name == 'R' else name[:-1] + str(int(name[-1]) + 1), min(length, remaining)])
                    remaining -= length
                assert remaining == 0
                doubles.append({'instrument': spec['instrument'], 'level': .06, 'pan': .12, 'start': position, 'notes': doubled})
            seq.extend(notes)
            written.extend(bars)
            position += sum(length for _, length in notes)
        form.append({'label': section['label'], 'bars': len(bars), 'repeat': repeat, 'startBeat': start, 'endBeat': position})
    backing = []
    for time in range(0, int(position), 4):
        midi = spec['tonicMidi'] - 12 + (7 if time // 4 % 2 else 0)
        backing.append([NAMES[midi % 12] + str(midi // 12 - 1), min(4, position - time)])
    parts = [{'instrument': spec['instrument'], 'level': .17, 'pan': -.12, 'notes': seq},
             {'instrument': 'guzheng', 'level': .037, 'pan': .3, 'notes': backing}] + doubles
    chord = spec.get('closingChord')
    if chord:
        for index, name in enumerate(chord['notes']):
            delay = index * .08
            parts.append({'instrument': 'guzheng', 'level': .04, 'pan': .15,
                          'start': chord['beat'] + delay, 'notes': parse(f"{name}:{chord['beats'] - delay}", spec['tonicMidi'])})
    scores.append({'id': spec['id'], 'title': spec['title'], 'bpm': spec['bpm'], 'beats': position,
                   'coverage': 'full', 'source': spec['source'], 'sourcePages': spec['sourcePages'],
                   'numberedMelody': ' | '.join(written), 'tonicMidi': spec['tonicMidi'],
                   'form': form, 'tempoChanges': tempos, 'scoreNotes': spec['scoreNotes'],
                   'description': '按完整简谱曲式合成，含全部段落、规定反复及前后奏；伴奏与音色独立制作，无人声及第三方录音。',
                   'parts': parts})
path.write_text(json.dumps(scores,ensure_ascii=False,indent=2)+'\n')
print([{'id': s['id'], 'beats': s['beats'], 'coverage': s.get('coverage', 'excerpt')} for s in scores if s['id'] in ids])
