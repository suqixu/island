import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 模型一次创建，身体和左右双翼分别合批；不请求额外图片。
export function createMeadowInsectMeshes(kind, capacity) {
  const bee = kind === 'bee', parts = [], wingParts = [];
  const dark = new THREE.Color('#332b22'), gold = new THREE.Color('#e5ae42');
  function colored(geometry, value) {
    const color = new THREE.Color(value), attribute = geometry.attributes.position, colors = [];
    for (let index = 0; index < attribute.count; index++) colors.push(color.r, color.g, color.b);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); return geometry;
  }
  function ellipsoid(x, y, z, sx, sy, sz, color, target = parts) {
    const geometry = colored(new THREE.SphereGeometry(1, 9, 7), color);
    geometry.scale(sx, sy, sz); geometry.translate(x, y, z); target.push(geometry); return geometry;
  }
  function rod(a, b, radius, color, target = parts) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const geometry = colored(new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 5), color);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()));
    geometry.translate((a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2); target.push(geometry);
  }
  if (bee) {
    const abdomen = ellipsoid(0, 0, -.105, .078, .065, .125, '#e5ae42');
    const p = abdomen.attributes.position, c = abdomen.attributes.color;
    for (let index = 0; index < p.count; index++) {
      const band = Math.floor((p.getZ(index) + .23) / .045), color = band % 2 ? dark : gold;
      c.setXYZ(index, color.r, color.g, color.b);
    }
    ellipsoid(0, .012, .015, .068, .065, .074, '#bd8a35');
    ellipsoid(0, .014, .108, .053, .048, .047, '#3f3422');
    for (const side of [-1, 1]) {
      ellipsoid(side*.038, .03, .133, .017, .022, .012, '#171c18');
      rod([side*.018,.035,.14],[side*.048,.072,.20],.003,'#332b22');
    }
    ellipsoid(.118, .018, .048, .13, .003, .072, '#e0eced', wingParts);
    ellipsoid(.080, .016, -.062, .085, .003, .050, '#e0eced', wingParts);
    rod([.018,.021,.02],[.223,.021,.055],.0018,'#6b969c',wingParts);
    rod([.018,.020,-.04],[.142,.020,-.075],.0015,'#6b969c',wingParts);
  } else {
    ellipsoid(0, .005, .015, .039, .044, .085, '#3b8790');
    for (const side of [-1, 1]) ellipsoid(side*.034, .019, .105, .036, .032, .035, '#619d80');
    for (let index = 0; index < 9; index++) {
      const width = .027 - index*.0018;
      ellipsoid(0, 0, -.085-index*.052, width, width*.82, .035, index%2 ? '#214e58' : '#68b1ba');
    }
    for (const z of [.045, -.040]) {
      ellipsoid(.235, .014, z, .24, .0025, .045, '#d3e5df', wingParts);
      rod([.015,.018,z],[.457,.018,z],.0015,'#5c999e',wingParts);
      rod([.09,.018,z],[.35,.018,z+.025],.001,'#89b6b0',wingParts);
    }
  }
  for (const side of [-1, 1]) for (const z of [-.035, .005, .045]) {
    rod([side*.02,-.01,z],[side*.07,-.09,z+.026],.003,'#3b3b2a');
  }
  function merge(items) { const geometry = mergeGeometries(items); items.forEach(part=>part.dispose()); return geometry; }
  const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: bee ? .8 : .42, metalness: bee ? 0 : .15 });
  const wingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: bee ? .58 : .48, depthWrite: false, roughness: .5 });
  const rightGeometry = merge(wingParts), leftGeometry = rightGeometry.clone(); leftGeometry.scale(-1,1,1); leftGeometry.computeVertexNormals();
  const body = new THREE.InstancedMesh(merge(parts), bodyMaterial, capacity);
  const wings = [new THREE.InstancedMesh(rightGeometry, wingMaterial, capacity), new THREE.InstancedMesh(leftGeometry, wingMaterial, capacity)];
  const name = bee ? '采蜜蜂' : '草间蜻蜓'; body.name = `${name}身体`; wings[0].name = `${name}右翼`; wings[1].name = `${name}左翼`;
  const meshes = [body, ...wings];
  for (const mesh of meshes) { mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = false; mesh.userData.meadowInsect = true; }
  return { body, wings, meshes };
}
