import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 单批光点保留每只萤火虫的独立亮度，不添加逐只灯光或外部贴图。
export function createFireflyPoints(capacity, profile) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, capacity);
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(profile.color) }, uSize: { value: profile.pointSize } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `
      attribute float aBrightness;
      uniform float uSize;
      varying float vBrightness;
      void main() {
        vBrightness = aBrightness;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(uSize / max(1.0, -viewPosition.z), 1.0, 9.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vBrightness;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (radius > 1.0 || vBrightness < 0.001) discard;
        float halo = exp(-radius * radius * 5.5) * (1.0 - smoothstep(0.65, 1.0, radius));
        gl_FragColor = vec4(uColor, halo * vBrightness);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = '林缘萤火虫'; points.userData.nightWildlife = true; points.frustumCulled = false;
  return points;
}

export function createMothMeshes(capacity) {
  const parts = [];
  function ellipsoid(x, y, z, sx, sy, sz) {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    geometry.scale(sx, sy, sz); geometry.translate(x, y, z); parts.push(geometry);
  }
  ellipsoid(0, 0, -.04, .035, .036, .11);
  ellipsoid(0, .006, .045, .042, .04, .044);
  ellipsoid(0, .008, .095, .028, .029, .029);
  const bodyGeometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#b9a98e', roughness: .95 });
  const wingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .95, color: '#fff8eb' });
  function wingGeometry(side) {
    const shape = new THREE.Shape();
    shape.moveTo(0, .07); shape.bezierCurveTo(side*.1, .14, side*.25, .14, side*.235, .035);
    shape.bezierCurveTo(side*.24, -.015, side*.13, -.1, side*.045, -.08); shape.lineTo(0, -.025);
    const geometry = new THREE.ShapeGeometry(shape, 7); geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position, colors = [], cream = new THREE.Color('#e6dbc4'), brown = new THREE.Color('#a8977c');
    for (let index = 0; index < position.count; index++) {
      const x = Math.abs(position.getX(index)), z = position.getZ(index);
      const band = Math.abs(x - .13 + z * .25) < .013;
      const color = band || x > .215 ? brown : cream; colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); return geometry;
  }
  const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
  const wings = [-1, 1].map(side => new THREE.InstancedMesh(wingGeometry(side), wingMaterial, capacity));
  body.name = '亭灯飞蛾身体'; wings[0].name = '亭灯飞蛾左翼'; wings[1].name = '亭灯飞蛾右翼';
  const meshes = [body, ...wings];
  for (const mesh of meshes) {
    mesh.userData.nightWildlife = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = false;
  }
  return { body, wings, meshes };
}
