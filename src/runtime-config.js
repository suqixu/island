import defaults from './config/defaults.json' with {type:'json'};
import weather from './config/weather.json' with {type:'json'};
import camera from './config/camera.json' with {type:'json'};
import rendering from './config/rendering.json' with {type:'json'};

// JSON imports are shared modules. Keep presets immutable and create mutable
// simulation state separately, so one scene cannot change the next scene.
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const DEFAULTS = deepFreeze(defaults);
export const WEATHER_CONFIG = deepFreeze(weather);
export const CAMERA_CONFIG = deepFreeze(camera);
export const RENDERING_CONFIG = deepFreeze(rendering);

export function initializeSettingInputs(document, state, quality = RENDERING_CONFIG.defaultQuality) {
  document.getElementById('time-range').value = state.hour;
  document.getElementById('auto-season').checked = state.autoSeason;
  document.getElementById('auto-weather').checked = state.autoWeather;
  const option = RENDERING_CONFIG.qualityOptions.find(option => option.value === quality);
  const button = document.getElementById('quality');
  button.textContent = option.label;
  button.setAttribute('aria-label', `渲染画质：${option.label}，点击切换`);
}
