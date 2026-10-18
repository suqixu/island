import config from '../config/scene-capabilities.json' with {type:'json'};
import weather from '../config/weather.json' with {type:'json'};
import stars from '../assets/data/bright-stars.json' with {type:'json'};
import music from '../config/music.json' with {type:'json'};
import {COMET_STYLES} from '../comet-styles.js';
import {createCapabilityRegistry} from './registry.js';
export const WILDLIFE_CAPACITIES={butterfly:16,bee:9,dragonfly:6,woodlandBird:10,squirrel:5,firefly:54,moth:3,seaBird:36,sunsetBird:2,marineFish:60,whale:1,dolphin:4,lagoonFish:42,turtle:3,crab:8,lobster:5,fishWave:1200,sailboat:4};
export function createCapabilityCatalog({capacities=WILDLIFE_CAPACITIES,speedGroups=['butterfly','bee','dragonfly','woodlandBird','squirrel','seaBird','sunsetBird','fishWave','sailboat','night','marine','lagoon'],musicIds=music.tracks.map(t=>t.id),cometStyleIds=COMET_STYLES.map(s=>s.id)}={}){
 const definitions=[];
 const property=(id,owner,type,value,extra={})=>definitions.push({id,owner,kind:'property',label:id,valueType:type,default:value,...extra});
 const number=(id,owner,value,min,max)=>property(id,owner,'number',value,{min,max});
 const enumeration=(id,owner,value,values)=>property(id,owner,'enum',value,{values});
 number('scene.motionRate','environment',1,.25,16);
 number('scene.hour','environment',22,0,24);definitions.at(-1).period=24;
 property('scene.season','environment','integer',1,{min:0,max:3});enumeration('scene.weather','environment','sunny',Object.keys(weather.presets));
 number('scene.moonPhase','environment',.5,0,1);definitions.at(-1).period=1;
 enumeration('scene.cloudMode','environment','default',weather.cloudModes.map(m=>m.value));number('scene.snowCover','environment',0,0,1);
 for(const [name,value,max] of [['windSpeed',8,60],['wind',.3,1],['gust',.12,1],['rain',0,1],['snow',0,1],['fog',0,1],['cloudiness',.12,1],['skyCloudCover',0,1],['storm',0,1],['typhoon',0,1],['roughSea',0,1],['temperature',24,60]])number(`environment.${name}`,'environment',value,name==='temperature'?-60:0,max);
 property('environment.windDirection','environment','vector2',[.83,.55]);
 for(const name of ['meteor','comet','aurora','solarEclipse','lunarEclipse'])enumeration(`sky.${name}.mode`,'sky','off',['off','default','instant']);
 property('sky.moon.enabled','sky','boolean',true);number('sky.moon.size','sky',0,0,200);enumeration('sky.moon.framing','sky','natural',['natural','complete']);
 number('sky.sun.size','sky',0,0,200);
 number('sky.rainbow.strength','sky',0,0,1);
 enumeration('sky.constellation.mode','sky','off',['off','lines','labels']);
 for(const name of ['stars','milkyWay']){property(`sky.${name}.enabled`,'sky','boolean',true);number(`sky.${name}.brightness`,'sky',1,0,4);}
 property('sky.stars.count','sky','integer',stars.length,{min:0,max:stars.length});
 for(const [key,p]of Object.entries(config.meteor.parameters))if(key!=='mode')property(`sky.meteor.${key}`,'sky',p.type,p.default,p);
 enumeration('sky.comet.style','sky',cometStyleIds[0],cometStyleIds);number('sky.comet.duration','sky',16,.1,600);number('sky.comet.brightness','sky',1,0,4);
 enumeration('sky.aurora.shape','sky','curtain',['curtain','arc','pillars','crown']);number('sky.aurora.brightness','sky',1,0,4);
 enumeration('lights.mode','presentation','auto',['auto','lighthouse-off','all-off']);
 for(const name of ['lighthouse','path','pavilion','dock']){property(`lights.${name}.enabled`,'presentation','boolean',true);number(`lights.${name}.intensity`,'presentation',1,0,4);}
 enumeration('render.quality','presentation','high',['low','medium','high']);property('presentation.poetry','presentation','boolean',false);
 property('audio.enabled','presentation','boolean',true);property('audio.paused','presentation','boolean',false);number('audio.musicVolume','presentation',.48,0,1);number('audio.ambientVolume','presentation',.38,0,1);enumeration('audio.track','presentation',musicIds[0],musicIds);enumeration('audio.mode','presentation','single',music.playback.modes.map(mode=>mode.id));
 for(const [name,max]of Object.entries(capacities)){property(`wildlife.${name}.enabled`,'wildlife','boolean',true);property(`wildlife.${name}.count`,'wildlife','integer',max,{min:0,max});}
 for(const name of speedGroups)number(`wildlife.${name}.speed`,'wildlife',1,.1,4);
 const clip=(id,parameters)=>definitions.push({id:`sky.${id}`,owner:'sky',kind:'clip',label:id,parameters,allowOverlap:false});
 clip('meteor',config.meteor.parameters);
 clip('comet',{style:{type:'enum',values:cometStyleIds,default:cometStyleIds[0]},duration:{type:'number',min:.1,max:600,default:16},brightness:{type:'number',min:0,max:4,default:1}});
 clip('aurora',{shape:{type:'enum',values:['curtain','arc','pillars','crown'],default:'curtain'},brightness:{type:'number',min:0,max:4,default:1}});
 for(const [name,duration]of [['solarEclipse',48],['lunarEclipse',96]])clip(name,{duration:{type:'number',min:.1,max:1800,default:duration}});
 for(const name of ['fishWave','sunsetBird','sailboat'])definitions.push({id:`wildlife.${name}`,owner:'wildlife',kind:'clip',label:name,parameters:name==='sunsetBird'?{
  count:{type:'integer',min:1,max:2,default:2},
  flight:{type:'enum',values:['sunset','crosswind'],default:'sunset'},
 }:{},allowOverlap:false});
 return definitions;
}
export function createDefaultCapabilityRegistry(options){const r=createCapabilityRegistry();for(const id of ['environment','presentation','wildlife','sky'])r.registerOwner(id,{capture(){},restore(){}});for(const d of createCapabilityCatalog(options))r.register(d);return r;}
export const defaultCapabilities=createDefaultCapabilityRegistry();
