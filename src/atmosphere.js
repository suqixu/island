import { createMoonViewVisibility } from './moon-view-visibility.js';
import * as THREE from 'three';
import { getAnimationDelta } from './animation-time.js';
import { getSunVisibility } from './sun-framing.js';
import { getMoonNightVisibility } from './moon.js';
import { getMoonBackdropScale } from './moon-framing.js';
import { createAfterRainState, advanceAfterRain } from './after-rain.js';
import { getRainbowFraming, createRainbowAppearance, RAINBOW_GLSL } from './rainbow.js';
import { getSunsetState } from './sunset.js';
import { createCloudMotionState, advanceCloudMotion, getCloudLayerSpeed } from './cloud-motion.js';
import { createCloudTextureData } from './cloud-texture.js';
import { getSeaHorizonState, SEA_HORIZON_GLSL } from './sea-horizon.js';
import { createNightSky } from './night-sky.js';

const clamp = THREE.MathUtils.clamp;
const weatherCloudiness = { sunny: 0.16, cloudy: 0.75, rain: 0.87, fog: 0.5, storm: 1, snow: 0.82 };

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Bake volume, turbulent edges and self-shadow once; sprites reuse the result.
function cloudTexture(seed, kind = 'cumulus') {
  const { data, width, height } = createCloudTextureData(seed, { kind });
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function addCloudSunset(material) {
  const uniforms = {
    uCloudSunsetStrength: { value: 0 },
    uCloudSunsetGold: { value: new THREE.Color() },
    uCloudSunsetRose: { value: new THREE.Color() },
    uCloudSunsetShadow: { value: new THREE.Color() },
    uCloudSunsetFacing: { value: 0 },
    uCloudSunsetVariation: { value: 0 },
    uCloudSunsetSide: { value: 0 },
  };
  material.userData.sunsetUniforms = uniforms;
  material.customProgramCacheKey = () => 'photographic-volume-cloud-v2';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCloudUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCloudUv = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec2 vCloudUv;
      uniform float uCloudSunsetStrength;
      uniform vec3 uCloudSunsetGold;
      uniform vec3 uCloudSunsetRose;
      uniform vec3 uCloudSunsetShadow;
      uniform float uCloudSunsetFacing;
      uniform float uCloudSunsetVariation;
      uniform float uCloudSunsetSide;
    `).replace('#include <map_fragment>', `
      #include <map_fragment>
      #ifdef USE_MAP
        // Fade the atlas cell's outermost wisps before another cell can bleed
        // through; the cloud itself retains its photographic alpha detail.
        vec2 cloudBorder = smoothstep(vec2(0.0), vec2(0.045), vCloudUv)
          * (1.0 - smoothstep(vec2(0.955), vec2(1.0), vCloudUv));
        diffuseColor.a *= cloudBorder.x * cloudBorder.y;
        // The original density texture carries the cloud's volume: tint its
        // lit ridges separately from its blue-violet underside.
        float relief = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float cloudLight = smoothstep(0.25, 0.86, relief);
        float cloudTop = smoothstep(0.28, 0.82, vCloudUv.y);
        float cloudSide = clamp(0.5 + (vCloudUv.x - 0.5) * uCloudSunsetSide, 0.0, 1.0);
        float cloudRim = (1.0 - smoothstep(0.42, 0.92, sampledDiffuseColor.a))
          * cloudTop * (0.35 + cloudSide * 0.65);
        vec3 sunsetBody = mix(uCloudSunsetShadow, uCloudSunsetRose,
          cloudLight * (0.50 + uCloudSunsetVariation * 0.28));
        float goldenRidge = smoothstep(0.64, 0.96, relief)
          * (0.26 + uCloudSunsetFacing * 0.48) + cloudRim * 0.60;
        vec3 sunsetCloud = mix(sunsetBody, uCloudSunsetGold, clamp(goldenRidge, 0.0, 1.0));
        sunsetCloud *= 0.60 + sqrt(max(relief, 0.0)) * 0.58;
        diffuseColor.rgb = mix(diffuseColor.rgb, sunsetCloud,
          uCloudSunsetStrength * (0.70 + uCloudSunsetFacing * 0.30));
      #endif
    `);
  };
}

function precipitationTexture(snow) {
  return canvasTexture(64, 64, (ctx) => {
    if (snow) {
      const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 29);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.22, 'rgba(255,255,255,.88)');
      gradient.addColorStop(0.62, 'rgba(255,255,255,.25)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    } else {
      const gradient = ctx.createLinearGradient(0, 2, 0, 62);
      gradient.addColorStop(0, 'rgba(220,239,255,0)');
      gradient.addColorStop(0.28, 'rgba(220,239,255,.25)');
      gradient.addColorStop(0.83, 'rgba(240,249,255,.85)');
      gradient.addColorStop(1, 'rgba(240,249,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(31, 2);
      ctx.lineTo(35, 57);
      ctx.quadraticCurveTo(32, 66, 29, 57);
      ctx.closePath();
      ctx.fill();
    }
  });
}

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunVisibility;
  uniform float uSunAngularRadius;
  uniform float uSunDiscIntensity;
  uniform float uSunDiscVisibility;
  uniform float uSunRedness;
  uniform float uSunsetStrength;
  uniform float uSunsetHorizonMix;
  uniform float uSunsetZenithMix;
  uniform vec3 uSunsetHorizon;
  uniform vec3 uSunsetZenith;
  uniform vec3 uSunsetGold;
  uniform vec3 uSunsetRose;
  uniform vec3 uMoonDirection;
  uniform float uMoonStrength;
  uniform float uEclipseActive;
  uniform float uEclipseOffset;
  uniform float uEclipseCoverage;
  uniform float uEclipseTotality;
  uniform float uDaylight;
  uniform float uTwilight;
  uniform float uCloudiness;
  uniform float uStorm;
  uniform float uLightning;
  uniform float uRainbowStrength;
  uniform float uRainbowSecondary;
  uniform float uRainbowRadius;
  uniform float uRainbowWidth;
  uniform vec3 uRainbowCenter;
  uniform vec3 uRainbowRight;
  uniform vec3 uRainbowUp;
  ${SEA_HORIZON_GLSL}
  ${RAINBOW_GLSL}
  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    vec3 solarDirection = normalize(uSunDirection);
    vec2 horizontalRay = direction.xz / max(length(direction.xz), 0.0001);
    vec2 horizontalSun = solarDirection.xz / max(length(solarDirection.xz), 0.0001);
    float sunsetFacing = pow(max(dot(horizontalRay, horizontalSun), 0.0), 3.0);
    float horizonFacing = 0.18 + 0.82 * sunsetFacing;
    float zenithFacing = 0.35 + 0.65 * sqrt(sunsetFacing);
    vec3 horizon = mix(uHorizon, uSunsetHorizon, uSunsetHorizonMix * horizonFacing);
    vec3 zenith = mix(uZenith, uSunsetZenith, uSunsetZenithMix * zenithFacing);
    vec3 color = mix(horizon, zenith, pow(height, 0.44));
    vec3 below = mix(uBelow, horizon, uSunsetStrength);
    color = mix(below, color, smoothstep(-0.045, 0.04, direction.y));
    float sunsetAboveHorizon = smoothstep(-0.01, 0.025, direction.y);
    // Gaussian offsets cross zero; GLSL pow has no defined negative-base
    // result even for exponent 2. Multiplication preserves the same bands.
    float goldOffset = (direction.y - 0.065) / 0.11;
    float roseOffset = (direction.y - 0.20) / 0.13;
    float goldBand = exp(-goldOffset * goldOffset);
    float roseBand = exp(-roseOffset * roseOffset);
    color = mix(color, uSunsetGold, goldBand * uSunsetStrength * horizonFacing * 0.22 * sunsetAboveHorizon);
    color = mix(color, uSunsetRose, roseBand * uSunsetStrength
      * (0.30 + 0.70 * sqrt(sunsetFacing)) * 0.26 * sunsetAboveHorizon);
    float alignment = clamp(dot(direction, solarDirection), 0.0, 1.0);
    float forwardGlow = pow(alignment, 7.0) * exp(-height * 2.2);
    color += vec3(0.32, 0.15, 0.065) * forwardGlow * uTwilight * uSunVisibility;
    // Angular size follows the screen framing; derivatives soften only the
    // disc's final pixel. A narrow halo leaves the rest of the sky intact.
    float solarDistance = sqrt(max(0.0, 2.0 * (1.0 - alignment)));
    float solarRadius = uSunAngularRadius;
    float solarEdge = max(fwidth(solarDistance), solarRadius * 0.025);
    float horizonEdge = max(fwidth(direction.y), 0.0001);
    float solarAboveHorizon = smoothstep(-horizonEdge * 0.5, horizonEdge * 0.5, direction.y);
    float sunDisk = 1.0 - smoothstep(solarRadius - solarEdge, solarRadius + solarEdge, solarDistance);
    float sunHalo = exp(-pow(solarDistance / (solarRadius * 2.5), 2.0));
    vec3 eclipseAxis = abs(solarDirection.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 eclipseRight = normalize(cross(eclipseAxis, solarDirection));
    vec3 eclipseUp = cross(solarDirection, eclipseRight);
    vec2 eclipsePoint = vec2(dot(direction,eclipseRight),dot(direction,eclipseUp)) / solarRadius;
    vec2 eclipseCenter = vec2(uEclipseOffset,uEclipseOffset*0.08);
    float eclipseDistance = length(eclipsePoint-eclipseCenter);
    float eclipseEdge = max(fwidth(eclipseDistance),0.02);
    float eclipseMask = (1.0-smoothstep(1.05-eclipseEdge,1.05+eclipseEdge,eclipseDistance))*uEclipseActive;
    float sunRays = 0.0;
    if (solarDistance < solarRadius * 3.5) {
      vec3 axis = abs(solarDirection.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
      vec3 solarRight = normalize(cross(axis, solarDirection));
      vec3 solarUp = cross(solarDirection, solarRight);
      float angle = atan(dot(direction, solarUp) + 0.0000001, dot(direction, solarRight));
      sunRays = pow(abs(cos(angle * 2.0)), 18.0)
        * smoothstep(solarRadius * 0.8, solarRadius * 1.15, solarDistance)
        * (1.0 - smoothstep(solarRadius * 2.0, solarRadius * 3.5, solarDistance))
        * exp(-solarDistance / solarRadius);
    }
    // Clip individual rays at the world horizon, leaving a half disc visible
    // while its centre rises or sinks through the sea line.
    float discCoverage = sunDisk * uSunDiscVisibility * solarAboveHorizon;
    // At the horizon the red disc replaces its backdrop instead of adding
    // a bright sky to it. Noon retains the existing additive warm-white disc.
    color *= 1.0 - discCoverage * uSunRedness;
    color += uSunColor * (discCoverage * uSunDiscIntensity * (1.0-eclipseMask)
      + (sunHalo * 0.22 + sunRays * 0.1) * uSunVisibility * solarAboveHorizon * (1.0-uEclipseCoverage));
    float coronaRadius=solarDistance/solarRadius;
    float coronaAngle=atan(eclipsePoint.y+0.0000001,eclipsePoint.x);
    float corona=exp(-max(0.0,coronaRadius-1.0)*2.8)
      *(0.65+0.35*pow(abs(cos(coronaAngle*3.0)),3.0))
      *smoothstep(1.0,1.07,coronaRadius)*(1.0-smoothstep(2.6,4.2,coronaRadius));
    color += vec3(0.8,0.84,0.76)*corona*uEclipseTotality*uSunDiscVisibility*solarAboveHorizon;
    color=mix(color,vec3(0.0005,0.0008,0.0012),eclipseMask*uEclipseTotality);
    float moonAlignment = max(dot(direction, uMoonDirection), 0.0);
    color += vec3(0.08, 0.13, 0.2) * pow(moonAlignment, 210.0) * uMoonStrength;
    if (uRainbowStrength > 0.001) {
      color = seaRainbow(color, direction, uRainbowCenter, uRainbowRight, uRainbowUp,
        uRainbowRadius, uRainbowWidth, uRainbowStrength, uRainbowSecondary, uSeaHorizonTime);
    }
    color *= 1.0 - uStorm * 0.42;
    // 共享目标已含雷暴暗化，低空雾仅在深夜融合，并保留其后的闪电照亮。
    if (uSeaHorizonNight > 0.0) {
      color = mix(color, seaHorizonRadiance(direction), seaHorizonSkyWeight(direction));
    }
    color += vec3(0.22, 0.29, 0.39) * uLightning;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createPrecipitation(count, snow, random) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (random() - 0.5) * 240;
    positions[i * 3 + 1] = (random() - 0.5) * 180;
    positions[i * 3 + 2] = (random() - 0.5) * 240;
    phases[i] = random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() },
      uStrength: { value: 0 },
      uSnow: { value: snow ? 1 : 0 },
      uSize: { value: snow ? 4.2 : 11 },
      uColor: { value: new THREE.Color(snow ? '#edf6ff' : '#c1d8e6') },
      uTexture: { value: precipitationTexture(snow) },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform vec2 uWind;
      uniform float uSnow;
      uniform float uSize;
      varying float vOpacity;
      void main() {
        vec3 p = position;
        float speed = mix(78.0, 10.0 + aPhase, uSnow);
        p.y = mod(p.y - uTime * speed + 90.0, 180.0) - 90.0;
        p.x = mod(p.x + uTime * uWind.x + 120.0, 240.0) - 120.0;
        p.z = mod(p.z + uTime * uWind.y + 120.0, 240.0) - 120.0;
        p.x += sin(uTime * 1.15 + aPhase + p.y * 0.025) * uSnow * 2.3;
        p.z += cos(uTime * 0.75 + aPhase) * uSnow * 1.6;
        vec4 viewPosition = viewMatrix * vec4(p + uCenter, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(uSize * 100.0 / max(-viewPosition.z, 1.0), 1.0, 30.0);
        vOpacity = smoothstep(1.5, 9.0, -viewPosition.z)
          * (1.0 - smoothstep(85.0, 145.0, length(p.xz)));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTexture;
      uniform float uStrength;
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        float alpha = texture2D(uTexture, gl_PointCoord).a * uStrength * vOpacity;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 20;
  points.visible = false;
  return points;
}

/**
 * Sky, clouds, precipitation, atmospheric fog and the scene's main lighting.
 * Time is elapsed seconds. The environment's sunDirection points toward the sun.
 */
export function createAtmosphere(scene, { moonMap, terrainHeightAt, cloudMaps: suppliedCloudMaps } = {}) {
  const random = randomSource(601907);
  const rainbowAppearance = createRainbowAppearance();
  const group = new THREE.Group();
  group.name = 'atmosphere';
  scene.add(group);

  const colors = {
    zenithDay: new THREE.Color('#5e9dcc'),
    zenithNight: new THREE.Color('#04070d'),
    zenithMoon: new THREE.Color('#0b121d'),
    zenithDusk: new THREE.Color('#334972'),
    horizonDay: new THREE.Color('#bddeeb'),
    horizonNight: new THREE.Color('#142b43'),
    horizonMoon: new THREE.Color('#344c62'),
    horizonDusk: new THREE.Color('#ef9a70'),
    overcastTop: new THREE.Color('#6c8190'),
    overcastHorizon: new THREE.Color('#b5c0c3'),
    fogDay: new THREE.Color('#c5d9df'),
    fogNight: new THREE.Color('#142338'),
    fogMoon: new THREE.Color('#2c4255'),
    fogDusk: new THREE.Color('#cc9f88'),
    cloudDay: new THREE.Color('#f5fafb'),
    cloudNight: new THREE.Color('#444e60'),
    cloudStorm: new THREE.Color('#697d91'),
    cloudDusk: new THREE.Color('#ffbd90'),
    sunlight: new THREE.Color('#fff4df'),
    sunset: new THREE.Color('#ff9f52'),
    moonlight: new THREE.Color('#a9c2ec'),
    brightMoonlight: new THREE.Color('#eee1c3'),
    moonrise: new THREE.Color('#ffe4b8'),
    moonTint: new THREE.Color('#ffd47c'),
    hemiDay: new THREE.Color('#c8e4f1'),
    hemiNight: new THREE.Color('#647ba2'),
    hemiMoon: new THREE.Color('#b0c5d5'),
    groundDay: new THREE.Color('#6a7660'),
    groundNight: new THREE.Color('#1d3044'),
    groundMoon: new THREE.Color('#737b6c'),
    flash: new THREE.Color('#e4f3ff'),
  };

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: colors.zenithDay.clone() },
      uHorizon: { value: colors.horizonDay.clone() },
      uBelow: { value: colors.fogDay.clone() },
      uSunDirection: { value: new THREE.Vector3(0.6, 0.7, 0.5).normalize() },
      uSunColor: { value: colors.sunlight.clone() },
      uSunVisibility: { value: 0 },
      uSunAngularRadius: { value: 0.01 },
      uSunDiscIntensity: { value: 3.6 },
      uSunDiscVisibility: { value: 0 },
      uSunRedness: { value: 0 },
      uSunsetStrength: { value: 0 },
      uSunsetHorizonMix: { value: 0 },
      uSunsetZenithMix: { value: 0 },
      uSunsetHorizon: { value: new THREE.Color() },
      uSunsetZenith: { value: new THREE.Color() },
      uSunsetGold: { value: new THREE.Color() },
      uSunsetRose: { value: new THREE.Color() },
      uMoonDirection: { value: new THREE.Vector3(-0.6, 0.5, -0.7).normalize() },
      uMoonStrength: { value: 0 },
      uEclipseActive: { value: 0 },
      uEclipseOffset: { value: -2.1 },
      uEclipseCoverage: { value: 0 },
      uEclipseTotality: { value: 0 },
      uDaylight: { value: 1 },
      uTwilight: { value: 0 },
      uCloudiness: { value: 0.2 },
      uStorm: { value: 0 },
      uLightning: { value: 0 },
      uSeaHorizonNight: { value: 0 },
      uSeaHorizonColor: { value: new THREE.Color() },
      uSeaHorizonTime: { value: 0 },
      uSeaHorizonWeather: { value: 0 },
      uSeaHorizonCloudCover: { value: 0 },
      uRainbowStrength: { value: 0 },
      uRainbowSecondary: { value: 0 },
      uRainbowRadius: { value: 0.15 },
      uRainbowWidth: { value: 0.012 },
      uRainbowCenter: { value: new THREE.Vector3(0, 0, -1) },
      uRainbowRight: { value: new THREE.Vector3(1, 0, 0) },
      uRainbowUp: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2450, 36, 20), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  group.add(sky);

  const nightSky = createNightSky();
  group.add(nightSky.group);

  const moonMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: moonMap },
      uLightDirection: { value: new THREE.Vector3(0, 0, 1) },
      uOpacity: { value: 0 },
      uTint: { value: new THREE.Color('#ffd47c') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec3 uLightDirection;
      uniform vec3 uTint;
      uniform float uOpacity;
      void main() {
        vec2 disc = (vUv - 0.5) * 2.0;
        float radius2 = dot(disc, disc);
        float edgeWidth = max(fwidth(radius2), 0.0001);
        vec3 normal = vec3(disc, sqrt(max(0.0, 1.0 - radius2)));
        float incidence = dot(normal, uLightDirection);
        float terminatorWidth = max(fwidth(incidence), 0.0001);
        // Only the illuminated side covers the sky. Smooth its final pixel
        // inward so the unlit hemisphere stays completely transparent.
        if (radius2 > 1.0 || incidence <= 0.0) discard;
        float lit = smoothstep(0.0, terminatorWidth, incidence);
        // The lunar regolith scatters light back toward the viewer. Unlike a
        // Lambert sphere, a full moon keeps its maria clear all the way to the limb.
        float mu0 = max(incidence, 0.0);
        float scattering = 2.0 * mu0 / max(mu0 + normal.z, 0.001);
        float brightness = min(mix(scattering, sqrt(mu0), 0.08), 1.15);
        // Lift only the illuminated terminator, retaining lunar albedo detail.
        float terminatorLift = 0.18 * (1.0 - smoothstep(0.0, 0.18, mu0));
        brightness = max(brightness, terminatorLift);
        // Reconstruct the front hemisphere before sampling the global map:
        // north remains up; eastern longitudes appear on the right of the disc.
        vec2 lunarUv = vec2(
          0.5 + atan(normal.x, normal.z) / 6.28318530718,
          0.5 + asin(clamp(normal.y, -1.0, 1.0)) / 3.14159265359
        );
        vec3 surface = texture2D(uTexture, lunarUv).rgb;
        vec3 albedo = pow(surface, vec3(1.05));
        vec3 color = albedo * uTint * brightness * 1.55;
        float rim = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, radius2);
        gl_FragColor = vec4(color, rim * lit * uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMaterial);
  moon.name = 'phase-moon';
  moon.scale.set(340, 340, 1);
  moon.frustumCulled = false;
  moon.renderOrder = -800;
  group.add(moon);

  const cloudKinds = ['cumulus', 'cumulus', 'tower', 'cumulus', 'altocumulus', 'cirrus', 'cumulus', 'altocumulus'];
  const cloudSeeds = [1701, 4367, 9481, 2609, 7823, 3811, 6289, 8513];
  const cloudMaps = suppliedCloudMaps ?? cloudSeeds.map((seed, index) => cloudTexture(seed, cloudKinds[index]));
  const clouds = [];
  for (let i = 0; i < 78; i++) {
    const kind = cloudKinds[i % cloudKinds.length];
    const thin = kind === 'cirrus', patches = kind === 'altocumulus', tower = kind === 'tower';
    const azimuth = random() * Math.PI * 2;
    const radius = 700 + random() * 1150;
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudMaps[i % cloudMaps.length], transparent: true,
      depthWrite: false, fog: false, opacity: 0.5,
    }));
    addCloudSunset(cloud.material);
    const width = patches ? 530 + random() * 310 : thin ? 380 + random() * 260 : 230 + random() * 220;
    const aspect = tower ? 1.06 : thin ? .30 : patches ? .60 : .69 + random() * .18;
    cloud.scale.set(width, width * aspect, 1);
    cloud.position.set(Math.cos(azimuth) * radius,
      175 + random() * 230 + (patches ? 180 : thin ? 250 : tower ? 40 : 0), Math.sin(azimuth) * radius);
    cloud.renderOrder = -500;
    cloud.userData.origin = cloud.position.clone();
    cloud.userData.threshold = random() * 0.88;
    cloud.userData.clearCoverage = i % 3 === 0 ? 0.64 : 0.32 + random() * 0.15;
    cloud.userData.opacity = thin ? .55 + random() * .22 : .94 + random() * .05;
    cloud.userData.speed = 0.45 + random() * 0.5;
    cloud.userData.drift = new THREE.Vector2();
    cloud.userData.width = width;
    cloud.userData.height = cloud.scale.y;
    cloud.userData.kind = kind;
    cloud.userData.thin = thin || patches;
    cloud.userData.motionLayer = { height: cloud.userData.origin.y,
      thin: cloud.userData.thin, variation: (cloud.userData.speed - 0.45) / 0.5 };
    cloud.userData.sunsetVariation = cloud.userData.threshold / 0.88;
    group.add(cloud);
    clouds.push(cloud);
  }

  const rain = createPrecipitation(2600, false, random);
  const snow = createPrecipitation(1800, true, random);
  const precipitationLayers = [rain, snow];
  const precipitationColors = [new THREE.Color('#c1d8e6'), new THREE.Color('#edf6ff')];
  group.add(rain, snow);

  const hemisphereLight = new THREE.HemisphereLight('#c8e4f1', '#6a7660', 1.15);
  hemisphereLight.name = 'atmosphere-fill';
  const sunLight = new THREE.DirectionalLight('#fff4df', 3.0);
  sunLight.name = 'atmosphere-sun';
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, {
    left: -145, right: 145, top: 145, bottom: -145, near: 10, far: 900,
  });
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.shadow.bias = -0.00015;
  sunLight.shadow.normalBias = 0.4;
  sunLight.shadow.radius = 3;
  sunLight.target.position.set(0, 14, 0);
  sunLight.position.set(230, 300, 190);
  scene.add(hemisphereLight, sunLight, sunLight.target);

  // Soft reflected light reveals the island's near side without a shadow map.
  // Preserve the night colour while adding warm daytime bounce into backlit foliage.
  const moonFill = new THREE.DirectionalLight('#d3d9cf', 0);
  const moonFillNightColor = moonFill.color.clone();
  const dayBounceColor = new THREE.Color('#f3ecd7');
  moonFill.name = 'moon-bounce-fill';
  moonFill.target = sunLight.target;
  scene.add(moonFill);

  const lightningLight = new THREE.PointLight('#d5eaff', 0, 1300, 2);
  lightningLight.name = 'lightning-flash';
  group.add(lightningLight);
  const boltPositions = new Float32Array(240 * 3);
  const haloPositions = new Float32Array(240 * 3);
  function ribbonGeometry(positions) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return geometry;
  }
  const boltMaterial = new THREE.MeshBasicMaterial({
    color: '#f1fbff', transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: '#79aaff', transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const bolt = new THREE.Mesh(ribbonGeometry(boltPositions), boltMaterial);
  const boltHalo = new THREE.Mesh(ribbonGeometry(haloPositions), haloMaterial);
  bolt.frustumCulled = boltHalo.frustumCulled = false;
  bolt.visible = boltHalo.visible = false;
  bolt.renderOrder = 3;
  boltHalo.renderOrder = 2;
  group.add(boltHalo, bolt);

  const fog = new THREE.FogExp2(colors.fogDay, 0.00065);
  const originalFog = scene.fog;
  scene.fog = fog;
  const sunDirection = new THREE.Vector3();
  const sunBackdropDirection = new THREE.Vector3();
  const moonDirection = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const start = new THREE.Vector3();
  const cloudColor = new THREE.Color();
  const fogColor = new THREE.Color();
  const center = new THREE.Vector3();
  const fillDirection = new THREE.Vector3();
  const cloudDirection = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cloudMotion = createCloudMotionState();
  const cloudFrame = { delta: 0, speed: 5, direction: [0, 0], offset: [0, 0] };
  const cloudFlowDirection = new THREE.Vector2();
  const afterRain = createAfterRainState();
  let nextStrike = Infinity;
  let strikeTime = -Infinity;
  let previousStorm = 0;
  let lastTime = 0;
  let weatherInitialized = false;
  const moonViewVisibility = createMoonViewVisibility(terrainHeightAt);
  let moonInFrame = false;
  const weatherState = { cloudiness: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0 };
  let disposed = false;

  const api = {
    update,
    dispose,
    setQuality: nightSky.setQuality,
    setConstellationsVisible: nightSky.setConstellationsVisible,
    setConstellationMode: nightSky.setConstellationMode,
    setMeteorsVisible: nightSky.setMeteorsVisible,
    setCometsVisible: nightSky.setCometsVisible,
    setMeteorMode: nightSky.setMeteorMode,
    setCometMode: nightSky.setCometMode,
    sunLight,
    hemisphereLight,
    fog,
    group,
    // Optional callback for audio or UI: (strength, worldPosition) => void.
    onThunder: null,
    get lightningActive() { return bolt.visible; },
    get moonDiscOpacity() { return moon.visible ? moonMaterial.uniforms.uOpacity.value : 0; },
    get moonInFrame() { return moonInFrame; },
  };

  function makeLightning(time, strength, camera) {
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    start.copy(camera.position).addScaledVector(forward, 380 + random() * 180);
    start.addScaledVector(right, (random() - 0.5) * 210);
    start.y = 205 + random() * 90;
    const path = [start.clone()];
    for (let i = 1; i <= 18; i++) {
      const p = start.clone();
      p.y -= i * (9 + strength * 3);
      p.addScaledVector(right, (random() - 0.5) * 26 + i * 0.7);
      p.addScaledVector(forward, (random() - 0.5) * 8);
      path.push(p);
    }
    const paths = [path];
    for (let branch = 0; branch < 2; branch++) {
      const origin = path[5 + branch * 5];
      const branchPath = [origin.clone()];
      const sign = branch ? 1 : -1;
      for (let i = 1; i <= 7; i++) {
        const p = origin.clone().addScaledVector(right, sign * i * 9 + (random() - 0.5) * 12);
        p.y -= i * 8;
        branchPath.push(p);
      }
      paths.push(branchPath);
    }
    let cursor = 0;
    function vertex(target, point, offset) {
      target[cursor] = point.x + right.x * offset;
      target[cursor + 1] = point.y + right.y * offset;
      target[cursor + 2] = point.z + right.z * offset;
    }
    for (const segmentPath of paths) {
      for (let i = 0; i < segmentPath.length - 1; i++) {
        const a = segmentPath[i];
        const b = segmentPath[i + 1];
        const width = segmentPath === path ? 0.8 : 0.4;
        const vertices = [[a, -1], [b, -1], [a, 1], [b, -1], [b, 1], [a, 1]];
        for (const [point, sign] of vertices) {
          vertex(boltPositions, point, sign * width);
          vertex(haloPositions, point, sign * width * 4.5);
          cursor += 3;
        }
      }
    }
    for (const mesh of [bolt, boltHalo]) {
      mesh.geometry.setDrawRange(0, cursor / 3);
      mesh.geometry.attributes.position.needsUpdate = true;
    }
    lightningLight.position.copy(start);
    strikeTime = time;
    nextStrike = time + (2.1 + random() * 3.2) / Math.max(strength, 0.4);
    if (typeof api.onThunder === 'function') api.onThunder(strength, start.clone());
  }

  function update(time, env = {}, camera) {
    if (disposed || !camera) return;
    time = Number.isFinite(time) ? time : lastTime;
    const weather = env.weather || 'sunny';
    const hour = Number.isFinite(env.hour) ? env.hour : 12;
    if (env.sunDirection?.isVector3 && env.sunDirection.lengthSq() > 0.001) {
      sunDirection.copy(env.sunDirection).normalize();
    } else {
      const angle = ((hour - 6) / 24) * Math.PI * 2;
      sunDirection.set(Math.cos(angle), Math.sin(angle), -0.35).normalize();
    }
    const physicalSunHeight = sunDirection.y;
    sunBackdropDirection.copy(sunDirection);
    if (env.sunBackdropDirection?.isVector3 && env.sunBackdropDirection.lengthSq() > 0.001) {
      sunBackdropDirection.copy(env.sunBackdropDirection).normalize();
    }
    const daylight = clamp(env.daylight ?? ((sunDirection.y + 0.08) / 0.36), 0, 1);
    // Elapsed animation time governs only weather transitions. Sun position and
    // daylight deliberately remain immediate so scrubbing the hour feels direct.
    const dt = getAnimationDelta(time - lastTime, .15, env);
    const weatherBlend = weatherInitialized ? 1 - Math.exp(-dt * 1.7) : 1;
    weatherInitialized = true;
    function weatherValue(key, target) {
      weatherState[key] += (target - weatherState[key]) * weatherBlend;
      return weatherState[key];
    }
    const cloudiness = weatherValue('cloudiness', clamp(env.cloudiness ?? weatherCloudiness[weather] ?? 0.2, 0, 1));
    const rainStrength = weatherValue('rain', clamp(env.rain ?? (weather === 'rain' || weather === 'storm' ? 1 : 0), 0, 1));
    const snowStrength = weatherValue('snow', clamp(env.snow ?? (weather === 'snow' ? 1 : 0), 0, 1));
    const fogStrength = weatherValue('fog', clamp(env.fog ?? (weather === 'fog' ? 1 : 0), 0, 1));
    const stormStrength = weatherValue('storm', clamp(env.storm ?? (weather === 'storm' ? 1 : 0), 0, 1));
    const wind = weatherValue('wind', clamp(typeof env.wind === 'number' ? env.wind : 0.25, 0, 2));
    const twilight = (1 - THREE.MathUtils.smoothstep(Math.abs(physicalSunHeight), 0.03, 0.55))
      * THREE.MathUtils.smoothstep(daylight, 0.01, 0.55) * (1 - cloudiness * 0.65);
    const night = Math.pow(1 - daylight, 1.6);
    const sunVisibility = getSunVisibility({
      sunHeight: physicalSunHeight, daylight, cloudiness,
      rain: rainStrength, snow: snowStrength, fog: fogStrength, storm: stormStrength,
    });
    const sunset = getSunsetState({ sunHeight: physicalSunHeight, daylight, cloudiness,
      rain: rainStrength, snow: snowStrength, fog: fogStrength, storm: stormStrength, hour });
    const legacyTwilight = twilight * (1 - sunset.glow);
    const rainbowStrength = advanceAfterRain(afterRain, time, {
      weather, daylight, cloudiness, rain: rainStrength, snow: snowStrength,
      fog: fogStrength, storm: stormStrength, sunVisibility,
    });

    if (stormStrength > 0.05 && (previousStorm <= 0.05 || time < lastTime)) {
      nextStrike = time + 0.35;
      strikeTime = -Infinity;
    }
    if (stormStrength > 0.05 && time >= nextStrike) makeLightning(time, stormStrength, camera);
    if (stormStrength <= 0.05) nextStrike = Infinity;
    const age = time - strikeTime;
    let flash = 0;
    if (stormStrength > 0.05 && age >= 0 && age < 0.54) {
      if (age < 0.09) flash = 1 - age * 5;
      else if (age < 0.15) flash = 0.14;
      else if (age < 0.23) flash = 0.85;
      else flash = Math.max(0, (0.54 - age) * 1.4);
      flash *= 0.6 + stormStrength * 0.4;
    }
    bolt.visible = boltHalo.visible = flash > 0.06;
    boltMaterial.opacity = flash;
    haloMaterial.opacity = flash * 0.32;
    lightningLight.intensity = flash * 40000;

    if (env.moonDirection?.isVector3) moonDirection.copy(env.moonDirection).normalize();
    else if (Array.isArray(env.moon)) moonDirection.set(...env.moon).normalize();
    else moonDirection.copy(sunDirection).negate();
    const moonLight = clamp(env.moonLight ?? clamp(moonDirection.y * 2, 0, 1), 0, 1);
    const moonThroughWeather = moonLight * (1 - cloudiness * 0.78)
      * (1 - fogStrength * 0.75) * (1 - rainStrength * 0.15) * (1 - snowStrength * 0.12);
    const moonFillStrength = moonThroughWeather * night;

    const uniforms = skyMaterial.uniforms;
    const eclipse=env.eclipse;
    uniforms.uEclipseActive.value=eclipse?.active?1:0;
    uniforms.uEclipseOffset.value=eclipse?.offset??-2.1;
    uniforms.uEclipseCoverage.value=eclipse?.coverage??0;
    uniforms.uEclipseTotality.value=eclipse?.totality??0;
    const seaHorizon = env.seaHorizon ?? getSeaHorizonState(env);
    uniforms.uSeaHorizonNight.value = seaHorizon.night;
    uniforms.uSeaHorizonColor.value.fromArray(seaHorizon.color);
    uniforms.uSeaHorizonTime.value = time;
    uniforms.uSeaHorizonWeather.value = seaHorizon.weather;
    uniforms.uSeaHorizonCloudCover.value = seaHorizon.cloudCover;
    uniforms.uZenith.value.copy(colors.zenithNight).lerp(colors.zenithMoon, moonFillStrength)
      .lerp(colors.zenithDay, daylight);
    uniforms.uZenith.value.lerp(colors.zenithDusk, legacyTwilight * 0.56);
    uniforms.uZenith.value.lerp(colors.overcastTop, cloudiness * daylight * 0.57);
    uniforms.uHorizon.value.copy(colors.horizonNight).lerp(colors.horizonMoon, moonFillStrength)
      .lerp(colors.horizonDay, daylight);
    uniforms.uHorizon.value.lerp(colors.horizonDusk, legacyTwilight * 0.88);
    uniforms.uHorizon.value.lerp(colors.overcastHorizon, cloudiness * daylight * 0.4);
    fogColor.copy(colors.fogNight).lerp(colors.fogMoon, moonFillStrength)
      .lerp(colors.fogDay, daylight).lerp(colors.fogDusk, legacyTwilight * 0.4);
    fogColor.lerp(uniforms.uSunsetHorizon.value.fromArray(sunset.horizonColor), sunset.glow * 0.28);
    fog.color.copy(fogColor).multiplyScalar(1 - daylight * (rainStrength * 0.08 + stormStrength * 0.32));
    // FogExp2 在远景会平方放大密度；保留最远全岛视角的地形对比，远海仍被雾笼罩。
    fog.density = Math.min(0.0021, 0.00042 + fogStrength * 0.0019 + rainStrength * 0.0005
      + snowStrength * 0.00065 + stormStrength * 0.00025);
    uniforms.uBelow.value.copy(fogColor);
    uniforms.uSunDirection.value.copy(sunBackdropDirection);
    uniforms.uSunVisibility.value = sunVisibility;
    // Weather dims the visible surface of the disc; its physical descent is
    // already handled by framing and per-pixel horizon clipping. This keeps
    // the half disc red instead of mixing most of the pale sky into it.
    uniforms.uSunDiscVisibility.value = getSunVisibility({ sunHeight: .10, daylight:env.solarDaylight??daylight, cloudiness,
      rain: rainStrength, snow: snowStrength, fog: fogStrength, storm: stormStrength });
    uniforms.uSunAngularRadius.value = Number.isFinite(env.sunAngularRadius)
      ? clamp(env.sunAngularRadius, 0.001, 0.06) : 0.01;
    uniforms.uSunColor.value.copy(colors.sunset).lerp(colors.sunlight, clamp(physicalSunHeight * 2.8, 0, 1));
    if (sunset.glow > 0) uniforms.uSunColor.value.fromArray(sunset.sunColor);
    uniforms.uSunDiscIntensity.value = sunset.discIntensity;
    uniforms.uSunRedness.value = sunset.redness;
    uniforms.uSunsetStrength.value = sunset.glow;
    uniforms.uSunsetHorizonMix.value = sunset.horizonMix;
    uniforms.uSunsetZenithMix.value = sunset.zenithMix;
    uniforms.uSunsetZenith.value.fromArray(sunset.zenithColor);
    uniforms.uSunsetGold.value.fromArray(sunset.cloudGold);
    uniforms.uSunsetRose.value.fromArray(sunset.cloudRose);
    uniforms.uDaylight.value = daylight;
    uniforms.uTwilight.value = twilight;
    uniforms.uCloudiness.value = cloudiness;
    uniforms.uStorm.value = stormStrength;
    uniforms.uLightning.value = flash;
    camera.getWorldPosition(center);
    sky.position.copy(center);
    uniforms.uRainbowStrength.value = 0;
    uniforms.uRainbowSecondary.value = rainbowAppearance.update(afterRain.startedAt);
    if (rainbowStrength > 0.001) {
      // Frame a broad double bow over the sea, with its feet lost below the horizon.
      camera.getWorldDirection(forward);
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const slope = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) * 0.5);
      const rainbowX = innerWidth < 760 ? 0 : -.08;
      const horizonY = -(forward.y + right.y * rainbowX * slope * camera.aspect) / (cameraUp.y * slope);
      const horizonPixels = (1 - horizonY) * innerHeight * 0.5;
      const frame = getRainbowFraming({ width: innerWidth, height: innerHeight,
        horizonPixels, fov: camera.getEffectiveFOV() });
      if (cameraUp.y > 0.1 && frame.visible) {
        uniforms.uRainbowCenter.value.copy(forward)
          .addScaledVector(right, rainbowX * slope * camera.aspect)
          .addScaledVector(cameraUp, horizonY * slope).normalize();
        uniforms.uRainbowCenter.value.y = 0;
        uniforms.uRainbowCenter.value.normalize().multiplyScalar(Math.cos(frame.depression));
        uniforms.uRainbowCenter.value.y = -Math.sin(frame.depression);
        uniforms.uRainbowUp.value.set(0, 1, 0);
        uniforms.uRainbowRight.value.crossVectors(uniforms.uRainbowCenter.value, uniforms.uRainbowUp.value).normalize();
        // Orthogonal up keeps angular distance and the colour bands circular.
        uniforms.uRainbowUp.value.crossVectors(uniforms.uRainbowRight.value, uniforms.uRainbowCenter.value).normalize();
        uniforms.uRainbowRadius.value = frame.radius;
        uniforms.uRainbowWidth.value = frame.width;
        uniforms.uRainbowStrength.value = rainbowStrength;
      }
    }
    nightSky.update(time, { ...env, daylight, cloudiness, fog: fogStrength, moonLight: moonThroughWeather,
      moonDirection, sunDirection }, camera);
    const moonPhase = env.moonPhase ?? 0.5;
    const moonIllumination = env.moonIllumination ?? 1;
    const moonElevation = Number.isFinite(env.moonAltitude) ? Math.sin(env.moonAltitude) : moonDirection.y;
    uniforms.uMoonDirection.value.copy(moonDirection);
    uniforms.uMoonStrength.value = moonLight * night * (1 - cloudiness * 0.9) * (1 - fogStrength);
    moon.position.copy(center).addScaledVector(moonDirection, 1900);
    moon.quaternion.copy(camera.quaternion);
    moon.scale.setScalar(getMoonBackdropScale(camera, innerWidth, innerHeight, moonPhase, moonDirection));
    const phaseAngle = moonPhase * Math.PI * 2;
    moonMaterial.uniforms.uLightDirection.value.set(Math.sin(phaseAngle), 0, -Math.cos(phaseAngle));
    moonMaterial.uniforms.uTint.value.copy(colors.moonTint).lerp(colors.moonrise, 0.2 * Math.exp(-Math.max(moonElevation, 0) * 12));
    moonMaterial.uniforms.uOpacity.value = night * (1 - cloudiness * 0.86) * (1 - fogStrength * 0.7)
      * THREE.MathUtils.smoothstep(moonElevation, -0.008, 0.025)
      * (env.moonVisibility ?? getMoonNightVisibility(daylight));
    moon.visible = moonIllumination > 0.001 && moonMaterial.uniforms.uOpacity.value > 0.01;
    moonInFrame = moonIllumination >= .99 && moon.visible && moonViewVisibility(camera, moon);

    cloudColor.copy(colors.cloudNight).lerp(colors.cloudDay, daylight);
    cloudColor.lerp(colors.cloudDusk, legacyTwilight * 0.48);
    cloudColor.lerp(colors.cloudStorm, stormStrength * 0.72);
    cloudColor.lerp(colors.flash, flash * 0.72);
    const motion = advanceCloudMotion(cloudMotion, time, env, cloudFrame);
    cloudFlowDirection.fromArray(motion.direction);
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const sunsetSide = clamp(sunBackdropDirection.dot(right) * 4, -1, 1);
    const hasVisualCover = Number.isFinite(env.skyCloudCover);
    const visualCover = hasVisualCover ? clamp(env.skyCloudCover, 0, 1) : cloudiness;
    // Each layer integrates its own velocity. Changes in wind speed or a
    // capped fast layer never rescale its accumulated displacement.
    for (const cloud of clouds) {
      const data = cloud.userData;
      const layerSpeed = getCloudLayerSpeed(motion.speed, data.motionLayer);
      data.drift.addScaledVector(cloudFlowDirection, motion.delta * layerSpeed);
      cloud.position.x = THREE.MathUtils.euclideanModulo(data.origin.x + data.drift.x + 2200, 4400) - 2200;
      cloud.position.z = THREE.MathUtils.euclideanModulo(data.origin.z + data.drift.y + 2200, 4400) - 2200;
      cloud.scale.set(data.width * (1 + (data.thin ? sunset.glow * 0.28 : 0)),
        data.height * (1 - (data.thin ? sunset.glow * 0.18 : 0)), 1);
      cloud.material.color.copy(cloudColor);
      let coverage;
      if (hasVisualCover) {
        // Individual clouds fade in at different cover thresholds. A sunset
        // may reveal an existing cloud's detail, but cannot create clear-sky clouds.
        const population = THREE.MathUtils.smoothstep(visualCover, data.threshold, Math.min(1, data.threshold + 0.16));
        const density = data.kind === 'cirrus' ? .42 + visualCover * .58 : .82 + visualCover * .18;
        coverage = population * THREE.MathUtils.lerp(density, Math.max(density, 0.72), sunset.glow * 0.85);
      } else {
        coverage = Math.max(data.clearCoverage, clamp((cloudiness - data.threshold) * 2.4 + 0.28, 0, 1));
        coverage = THREE.MathUtils.lerp(coverage, Math.max(coverage, 0.72), sunset.glow * 0.85);
      }
      const border = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(cloud.position.x), Math.abs(cloud.position.z)), 1850, 2200);
      cloudDirection.copy(cloud.position).sub(center).normalize();
      const sunClearance = 1 - sunVisibility * 0.85
        * THREE.MathUtils.smoothstep(cloudDirection.dot(sunBackdropDirection), 0.97, 0.999);
      const moonClearance = 1 - moonFillStrength * 0.65
        * THREE.MathUtils.smoothstep(cloudDirection.dot(moonDirection), 0.965, 0.999);
      const cloudSunset = cloud.material.userData.sunsetUniforms;
      cloudSunset.uCloudSunsetStrength.value = sunset.glow;
      cloudSunset.uCloudSunsetGold.value.fromArray(sunset.cloudGold);
      cloudSunset.uCloudSunsetRose.value.fromArray(sunset.cloudRose);
      cloudSunset.uCloudSunsetShadow.value.fromArray(sunset.cloudShadow);
      cloudSunset.uCloudSunsetFacing.value = THREE.MathUtils.smoothstep(cloudDirection.dot(sunBackdropDirection), -0.1, 0.95);
      cloudSunset.uCloudSunsetVariation.value = data.sunsetVariation;
      cloudSunset.uCloudSunsetSide.value = sunsetSide;
      cloud.material.opacity = data.opacity * coverage * border * sunClearance * moonClearance
        * Math.max(0.42 + daylight * 0.58, sunset.glow * 0.82) * (1 - fogStrength * 0.45);
      cloud.visible = cloud.material.opacity > 0.008;
    }

    for (let index = 0; index < precipitationLayers.length; index++) {
      const points = precipitationLayers[index];
      const strength = index === 0 ? rainStrength : snowStrength;
      points.visible = strength > 0.01;
      const precipitation = points.material.uniforms;
      precipitation.uCenter.value.copy(center);
      precipitation.uTime.value = time;
      precipitation.uWind.value.set(wind * (points === rain ? 18 : 7), wind * 3);
      precipitation.uStrength.value = strength * (points === rain ? 0.68 : 0.92);
      precipitation.uColor.value.copy(precipitationColors[index]);
      precipitation.uColor.value.multiplyScalar(0.42 + daylight * 0.58 + flash * 0.8);
    }

    hemisphereLight.color.copy(colors.hemiNight).lerp(colors.hemiMoon, moonFillStrength)
      .lerp(colors.hemiDay, daylight).lerp(colors.flash, flash * 0.8);
    hemisphereLight.groundColor.copy(colors.groundNight).lerp(colors.groundMoon, moonFillStrength)
      .lerp(colors.groundDay, daylight);
    hemisphereLight.intensity = 0.25 + moonFillStrength * 1.24
      + daylight * (0.83 + cloudiness * 0.2) + flash * 0.6;
    const sunHeight = clamp(physicalSunHeight, 0, 1);
    sunLight.color.copy(colors.sunset).lerp(colors.sunlight, clamp(sunHeight * 3.2, 0, 1));
    if (sunset.glow > 0) sunLight.color.fromArray(sunset.sunColor);
    sunLight.color.lerp(colors.moonlight, night).lerp(colors.flash, flash * 0.85);
    sunLight.color.lerp(colors.brightMoonlight, moonFillStrength * 0.7 * (1 - flash));
    sunLight.intensity = daylight * (2.1 + sunHeight * 1.15) * (0.12 + 0.88 * sunVisibility)
      + night * moonLight * 1.08 * (1 - cloudiness * 0.8)
      * (1 - fogStrength * 0.7) + flash * 1.7;
    const lightDirection = daylight > 0.12 ? sunBackdropDirection : moonDirection;
    sunLight.position.copy(lightDirection).multiplyScalar(380);
    if (daylight <= 0.12) {
      sunLight.position.y = Math.max(48, sunLight.position.y);
    }
    sunLight.position.add(sunLight.target.position);
    moonFill.color.copy(moonFillNightColor).lerp(dayBounceColor, daylight);
    moonFill.intensity = moonFillStrength * 0.46 + daylight * 0.65 * (0.35 + 0.65 * sunVisibility);
    fillDirection.copy(camera.position).sub(sunLight.target.position);
    fillDirection.y = Math.max(fillDirection.y, 0);
    if (fillDirection.lengthSq() < 0.001) fillDirection.set(1, 0, 1);
    fillDirection.normalize();
    fillDirection.y += 0.7;
    moonFill.position.copy(fillDirection.normalize()).multiplyScalar(380).add(sunLight.target.position);
    previousStorm = stormStrength;
    lastTime = time;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    nightSky.dispose();
    const materials = new Set();
    const textures = new Set();
    group.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) materials.add(object.material);
    });
    for (const material of materials) {
      if (material.map) textures.add(material.map);
      if (material.uniforms?.uTexture) textures.add(material.uniforms.uTexture.value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    sunLight.shadow.dispose();
    scene.remove(group, hemisphereLight, sunLight, sunLight.target, moonFill);
    if (scene.fog === fog) scene.fog = originalFog;
  }

  return api;
}
