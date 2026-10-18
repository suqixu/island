import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {parseFilmScript,sampleFilmScript} from '../src/film-script.js';import {sampleFilmSchedule,integrateFilmMotion} from '../src/scene-capabilities/sampling.js';
const script=parseFilmScript(readFileSync(new URL('../src/assets/data/films/isola-night-echoes.json',import.meta.url),'utf8'));
test('夜的回声三分钟精简版：13个镜头、八秒连续月相、星座与血月结尾',()=>{
 assert.equal(script.schemaVersion,2);assert.equal(script.duration,180);assert.equal(script.shots.length,13);
 for(let t=0;t<=180;t+=.25){const sample=sampleFilmSchedule(script,t);assert.ok(sampleFilmScript(script,t).shot);assert.equal(sample.properties['sky.constellation.mode'],t>=84&&t<98?'labels':'off');}
 const phases=new Set();for(let t=76;t<84;t+=.25)phases.add(sampleFilmSchedule(script,t).properties['scene.moonPhase']);assert.equal(phases.size,32);assert.equal(script.shots.filter(s=>s.landmark==='pavilion-south').length,1);
 assert.equal(script.shots.at(-1).id,'21-blood-moon-finale');const eclipse=sampleFilmSchedule(script,179).clips[0];assert.equal(eclipse.capability,'sky.lunarEclipse');assert.ok(eclipse.progress>.5&&eclipse.progress<.6);assert.equal(sampleFilmSchedule(script,180).clips.length,0);assert.equal(sampleFilmScript(script,180).fade,1);
 assert.ok(script.captions.length>=16);assert.equal(script.captions.at(-1).end,180);assert.ok(integrateFilmMotion(script,180)>180);assert.equal(sampleFilmSchedule(script,50).properties['sky.moon.enabled'],false);assert.equal(sampleFilmSchedule(script,78).properties['sky.moon.framing'],'complete');
});
