import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createSimulation,getEnvironment} from '../src/simulation.js';import {createSceneCapabilities} from '../src/scene-capabilities/index.js';import {createFilmSceneScheduling} from '../src/film-scene-scheduling.js';import {createFilmPlayer} from '../src/film-player.js';
const film=JSON.parse(readFileSync(new URL('../src/assets/data/films/isola-night-echoes.json',import.meta.url)));
test('真实播放器暂停、拖动、重播使用同一调度会话；退出恢复原场景',async()=>{
 const state=createSimulation({hour:13}),saved=structuredClone(state);let frames,ended=0;
 const atmosphere={getRuntimeOptions:()=>({constellation:'off'}),setRuntimeOptions(){},beginFilm(){},sampleFilm:(f,ctx)=>{frames=f;if(f.meteor)assert.equal(ctx.frameAt(f.meteor.start).time,118)},endFilm(){ended++}};
 const registry=createSceneCapabilities({state,atmosphere}),session=createFilmSceneScheduling({registry,filmCamera:{getPoseAt:s=>({time:s.time})},random:()=>.25});
 const player=createFilmPlayer({capabilities:registry,capture(script){session.begin(script);return saved},restore(){session.end()},onFrame(sample){Object.assign(state,{hour:sample.environment.hour,seasonIndex:sample.environment.season,weather:sample.environment.weather});session.apply(sample)}});
 player.load(film);await player.play();const seed=session.seed;player.seek(178);const env=session.composeEnvironment(getEnvironment(state));assert.equal(env.lunarEclipse.totality,1);player.pause();player.update(10000);assert.equal(player.getState().time,178);player.seek(118.8);session.composeEnvironment(getEnvironment(state));assert.equal(frames.meteor.parameters.burstCount,9);await player.restart();assert.equal(session.seed,seed);player.exit();assert.deepEqual(state,saved);assert.equal(ended,1);
});
test('第一版脚本不接管普通天空调度',()=>{let entered=0;const session=createFilmSceneScheduling({registry:{owners:new Map(),listCapabilities:()=>[]},filmCamera:{}});session.begin({schemaVersion:1});assert.equal(session.active,false);const env={daylight:1};assert.equal(session.composeEnvironment(env),env);session.end();});
