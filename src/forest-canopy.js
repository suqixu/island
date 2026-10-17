import * as THREE from 'three';
import { seededRandom, TAU } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

function tube(points, radii, positions, indices) {
  const sides = 4, start = positions.length / 3;
  const tangent = new THREE.Vector3(), side = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let ring = 0; ring < points.length; ring++) {
    tangent.subVectors(points[Math.min(ring + 1, points.length - 1)], points[Math.max(0, ring - 1)]).normalize();
    side.crossVectors(tangent, Math.abs(tangent.y) > .92 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
    normal.crossVectors(side, tangent).normalize();
    for (let segment = 0; segment < sides; segment++) {
      const angle = segment / sides * TAU, radius = radii[ring];
      positions.push(points[ring].x + (side.x * Math.cos(angle) + normal.x * Math.sin(angle)) * radius,
        points[ring].y + (side.y * Math.cos(angle) + normal.y * Math.sin(angle)) * radius,
        points[ring].z + (side.z * Math.cos(angle) + normal.z * Math.sin(angle)) * radius);
      if (!ring) continue;
      const a = start + (ring - 1) * sides + segment, b = start + (ring - 1) * sides + (segment + 1) % sides;
      const c = start + ring * sides + segment, d = start + ring * sides + (segment + 1) % sides;
      indices.push(a, c, b, b, c, d);
    }
  }
}

function geometry(positions, indices) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(indices); result.computeVertexNormals();
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

/** Four reusable broadleaf forms. Real gaps and folded leaves avoid opaque crown balls. */
export function createForestCanopy(seed = 1922) {
  const random = seededRandom(seed);
  const leafPositions = [], leafIndices = [], colors = [], flex = [], cover = [], uvs = [];
  const woodPositions = [], woodIndices = [];
  const tierCounts = [8, 7, 5], startAngle = random() * TAU;
  const shape = .88 + random() * .2, lean = new THREE.Vector3((random() - .5) * .26, 0, (random() - .5) * .26);
  tube([new THREE.Vector3(0, -2.1, 0), new THREE.Vector3(0, -.9, 0),
    new THREE.Vector3(lean.x, .15, lean.z), new THREE.Vector3(lean.x * 1.7, 1.4, lean.z * 1.7)],
  [.105, .085, .055, .018], woodPositions, woodIndices);
  for (let tier = 0; tier < 3; tier++) {
    for (let shoot = 0; shoot < tierCounts[tier]; shoot++) {
      const angle = startAngle + shoot / tierCounts[tier] * TAU + tier * .49 + (random() - .5) * .38;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const sideways = new THREE.Vector3(-radial.z, 0, radial.x);
      const radius = ([1.67, 1.42, .90][tier] + random() * .28) * shape;
      const tipY = [-.62, .39, 1.36][tier] + (random() - .5) * .38;
      const rootY = [-1.28, -.40, .35][tier] + random() * .12;
      const bend = (random() - .5) * .44;
      const points = Array.from({ length: 3 }, (_, index) => {
        const t = index / 2;
        return new THREE.Vector3(radial.x * radius * t + sideways.x * Math.sin(t * Math.PI) * bend + lean.x * tier * .4,
          rootY + (tipY - rootY) * t + Math.sin(t * Math.PI) * .20,
          radial.z * radius * t + sideways.z * Math.sin(t * Math.PI) * bend + lean.z * tier * .4);
      });
      tube(points, [.047 - tier * .007, .024, .008], woodPositions, woodIndices);
      const shootShade = .73 + random() * .23;
      for (let leaf = 0; leaf < 16; leaf++) {
        // Leaves attach along the outer shoot. Alternating phyllotaxis gives each
        // branch an airy leaf spray instead of a random cloud of loose polygons.
        const t = .28 + leaf / 15 * .71, at = t * 2, ring = Math.min(1, Math.floor(at));
        const root = points[ring].clone().lerp(points[ring + 1], at - ring);
        const spin = leaf * 2.39996 + random() * .95;
        const direction = radial.clone().multiplyScalar(.22 + random() * .55)
          .addScaledVector(sideways, Math.cos(spin) * .90);
        direction.y = .18 + Math.sin(spin) * .43 + (tier === 2 ? .1 : 0);
        direction.normalize();
        const side = new THREE.Vector3().crossVectors(direction, UP).normalize();
        const normal = new THREE.Vector3().crossVectors(side, direction).normalize();
        const length = .285 + random() * .125, width = .146 + random() * .078;
        const curl = .037 + random() * .031, roll = (random() - .5) * .036;
        const start = leafPositions.length / 3, leafShade = shootShade * (.94 + random() * .13) * (.86 + t * .20);
        // Four narrow-to-wide-to-narrow sections make a small, cupped oval leaf.
        // The tips retain a tiny width instead of a conspicuous triangular spike.
        for (let section = 0; section < 4; section++) {
          const progress = [0, .24, .66, 1][section], breadth = [.055, .82, .91, .10][section];
          const centre = root.clone().addScaledVector(direction, length * progress)
            .addScaledVector(normal, Math.sin(progress * Math.PI) * curl * .36 - progress * progress * curl);
          for (const sign of [-1, 1]) {
            const point = centre.clone().addScaledVector(side, sign * width * breadth)
              .addScaledVector(normal, sign * roll * Math.sin(progress * Math.PI));
            leafPositions.push(...point.toArray());
            const shade = leafShade * [.78, .91, 1, 1.05][section] * (sign < 0 ? .98 : 1);
            colors.push(shade * .965, shade, shade * .91);
            flex.push(section === 0 ? 0 : [.0, .11, .23, .36 + random() * .04][section]);
            cover.push(Math.max(.15, normal.y) * (tier === 2 ? 1 : .65));
            uvs.push(sign < 0 ? .5 - breadth * .5 : .5 + breadth * .5, progress);
          }
          if (!section) continue;
          const a = start + (section - 1) * 2, b = a + 1, c = start + section * 2, d = c + 1;
          leafIndices.push(a, c, b, b, c, d);
        }
      }
    }
  }
  const leaves = geometry(leafPositions, leafIndices), branches = geometry(woodPositions, woodIndices);
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  leaves.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  leaves.setAttribute('aCover', new THREE.Float32BufferAttribute(cover, 1));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  branches.setAttribute('aFlex', new THREE.Float32BufferAttribute(new Float32Array(woodPositions.length / 3), 1));
  return { leaves, branches };
}
