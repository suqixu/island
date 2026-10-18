import * as THREE from 'three';

/** Sample the same instance transform and road-plant wind field as the petals. */
export function createFlowerAnchors(mesh, uniforms, { point, flex, limit }) {
  const matrix = new THREE.Matrix4(), root = new THREE.Vector3();
  const count = Math.min(limit, mesh.count);
  return Array.from({ length: count }, (_, slot) => {
    const index = Math.floor(slot * mesh.count / count);
    mesh.getMatrixAt(index, matrix);
    const base = point.clone().applyMatrix4(matrix);
    root.setFromMatrixPosition(matrix);
    const origin = root.clone();
    return {
      available: () => mesh.visible && mesh.parent?.visible !== false && !!mesh.parent?.parent && index < mesh.count,
      sample(time, target) {
        mesh.updateWorldMatrix(true, false);
        target.copy(base).applyMatrix4(mesh.matrixWorld);
        root.copy(origin).applyMatrix4(mesh.matrixWorld);
        const phase = root.x * .071 + root.z * .097;
        const t = uniforms.uTime.value;
        const sway = .55 * Math.sin(t * .62 + phase) + .24 * Math.sin(t * .93 + phase * 1.7)
          + .11 * Math.sin(t * .27 + phase * .51) + .1 * Math.sin(t * .43);
        const flutter = (.72 * Math.sin(t * 4.3 + phase * 3.1 + point.x * 1.8 + point.z * 2.2)
          + .28 * Math.sin(t * 6.8 + phase * 2.3 + point.x * 2.7 - point.z * 1.3))
          * uniforms.uLeafFlutter.value * .2 * flex ** 3;
        const amplitude = uniforms.uPlantAmplitudes.value.z * .65;
        const along = sway * amplitude * flex ** 2 + flutter;
        const across = Math.sin(t * .67 + phase + 1.7) * amplitude * .15 * flex ** 2;
        const direction = uniforms.uWindDirection.value;
        target.x += direction.x * along - direction.y * across;
        target.y += flutter * .36;
        target.z += direction.y * along + direction.x * across;
        return target;
      },
    };
  });
}
