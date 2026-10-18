import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Two lobes, dark margins, fine veins and small pale edge markings. All colour
// is geometry; there are no new image requests or transparent wing rectangles.
function wingGeometry() {
  const positions = [], colors = [];
  const dark = new THREE.Color('#403126'), light = new THREE.Color('#ffffff');
  const triangle = (a, b, c, color) => {
    for (const point of [a, b, c]) { positions.push(...point); colors.push(color.r, color.g, color.b); }
  };
  const lobes = [
    { center: [.105, 0, .055], edge: [[.012, 0, .08], [.10, 0, .23], [.25, 0, .25], [.35, 0, .17], [.36, 0, .07], [.27, 0, -.025], [.04, 0, -.07]] },
    { center: [.10, 0, -.105], edge: [[.018, 0, -.025], [.20, 0, -.045], [.28, 0, -.14], [.23, 0, -.24], [.12, 0, -.27], [.028, 0, -.16]] },
  ];
  for (const { center, edge } of lobes) {
    const inner = edge.map(point => point.map((value, axis) => center[axis] + (value - center[axis]) * .86));
    edge.forEach((point, index) => {
      const next = (index + 1) % edge.length;
      triangle(center, inner[index], inner[next], light);
      triangle(point, edge[next], inner[next], dark); triangle(point, inner[next], inner[index], dark);
      // A very narrow vein sits just above the coloured wing membrane.
      const tip = inner[index];
      triangle([center[0] - .002, .001, center[2]], [center[0] + .002, .001, center[2]], [tip[0], .001, tip[2]], dark);
      if (index > 1 && index < edge.length - 1) {
        const x = center[0] + (point[0] - center[0]) * .92, z = center[2] + (point[2] - center[2]) * .92;
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * Math.PI * 2, b = (k + 1) / 6 * Math.PI * 2;
          triangle([x, .002, z], [x + Math.cos(a) * .009, .002, z + Math.sin(a) * .009], [x + Math.cos(b) * .009, .002, z + Math.sin(b) * .009], light);
        }
      }
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); return geometry;
}

export function createButterflyMeshes(capacity) {
  const parts = [];
  const abdomen = new THREE.SphereGeometry(1, 7, 6); abdomen.scale(.021, .025, .125); abdomen.translate(0, 0, -.045); parts.push(abdomen);
  const head = new THREE.SphereGeometry(.028, 7, 5); head.translate(0, .008, .09); parts.push(head);
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  function stem(a, b, radius) {
    const geometry = new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 4);
    direction.subVectors(b, a).normalize(); geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); parts.push(geometry);
  }
  for (const side of [-1, 1]) {
    stem(new THREE.Vector3(side * .012, .02, .10), new THREE.Vector3(side * .055, .065, .18), .003);
    for (const z of [-.055, .005, .05]) stem(new THREE.Vector3(side * .01, -.005, z), new THREE.Vector3(side * .055, -.04, z + .025), .0025);
  }
  const bodyGeometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
  const body = new THREE.InstancedMesh(bodyGeometry, new THREE.MeshStandardMaterial({ color: '#473e30', roughness: .85 }), capacity);
  const rightGeometry = wingGeometry(), leftGeometry = rightGeometry.clone();
  leftGeometry.scale(-1, 1, 1); leftGeometry.computeVertexNormals();
  const wingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .8 });
  const wings = [new THREE.InstancedMesh(rightGeometry, wingMaterial, capacity), new THREE.InstancedMesh(leftGeometry, wingMaterial, capacity)];
  body.name = '花丛蝴蝶身体'; wings[0].name = '花丛蝴蝶右翼'; wings[1].name = '花丛蝴蝶左翼';
  for (const mesh of [body, ...wings]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // At most sixteen insects over several flower patches; a scene-level
    // distance gate replaces repeatedly rebuilding dynamic bounding spheres.
    mesh.frustumCulled = false; mesh.castShadow = false;
  }
  return { body, wings };
}
