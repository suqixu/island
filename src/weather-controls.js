import {DEFAULTS,WEATHER_CONFIG} from './runtime-config.js';

export function getCloudMode(value) {
  return WEATHER_CONFIG.cloudModes.find(mode=>mode.value===value)??WEATHER_CONFIG.cloudModes[0];
}

export function selectWeather(state,button) {
  if(!Object.hasOwn(WEATHER_CONFIG.presets,button))return state;
  if(button==='rain') {
    const cycle=WEATHER_CONFIG.rainCycle,index=cycle.indexOf(state.weather);
    state.weather=cycle[(index+1)%cycle.length];
    state.cloudMode=DEFAULTS.simulation.cloudMode;
  } else if(button==='cloudy') {
    const modes=WEATHER_CONFIG.cloudModes;
    const index=state.weather==='cloudy'?modes.indexOf(getCloudMode(state.cloudMode)):-1;
    state.cloudMode=modes[(index+1)%modes.length].value;
    state.weather='cloudy';
  } else {
    state.weather=button;state.cloudMode=DEFAULTS.simulation.cloudMode;
  }
  state.weatherProgress=0;state.weatherDuration=undefined;state.weatherSeasonIndex=state.seasonIndex;
  return state;
}

export function getWeatherButtonState(state,button) {
  if(button==='rain') {
    const selected=state.weather==='rain'||state.weather==='typhoon';
    const mode=selected?state.weather:'sunny';
    const cycle=WEATHER_CONFIG.rainCycle,next=cycle[(cycle.indexOf(mode)+1)%cycle.length];
    return {selected,icon:mode==='typhoon'?'typhoon':'rain',
      label:`下雨：${selected?WEATHER_CONFIG.rainModeNames[mode]:'未选择'}，点击切换${WEATHER_CONFIG.rainModeNames[next]}`};
  }
  if(button==='cloudy') {
    const selected=state.weather==='cloudy',modes=WEATHER_CONFIG.cloudModes;
    const mode=getCloudMode(selected?state.cloudMode:DEFAULTS.simulation.cloudMode);
    const next=selected?modes[(modes.indexOf(mode)+1)%modes.length]:modes[0];
    return {selected,icon:mode.icon,
      label:`云：${selected?mode.label:'未选择'}，点击切换${next.label}`};
  }
  return {selected:state.weather===button,icon:button==='sunny'?'sun':button,label:WEATHER_CONFIG.names[button]};
}
