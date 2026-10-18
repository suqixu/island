import * as THREE from 'three';

/** Derive subpixel leaves from the finished canopy, preserving its seeded layout.
 * A root-to-tip fold keeps two lit faces; equal leaf area avoids thinning the
 * distant crown when replacing each eight-vertex leaf with a four-point diamond.
 */
export function createForestCanopyLod(source) {
  const samples = [[0, 1], [2, 4], [3, 5], [6, 7]];
  const count = source.attributes.position.count / 8;
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new attribute.array.constructor(count * 4 * attribute.itemSize);
    for (let leaf = 0; leaf < count; leaf++) {
      for (let vertex = 0; vertex < 4; vertex++) {
        for (let component = 0; component < attribute.itemSize; component++) {
          values[(leaf * 4 + vertex) * attribute.itemSize + component] =
            (attribute.array[(leaf * 8 + samples[vertex][0]) * attribute.itemSize + component]
              + attribute.array[(leaf * 8 + samples[vertex][1]) * attribute.itemSize + component]) / 2;
        }
      }
    }
    result.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  const positions = result.attributes.position;
  const root = new THREE.Vector3(), tip = new THREE.Vector3(), left = new THREE.Vector3(), right = new THREE.Vector3();
  const centre = new THREE.Vector3(), leftOffset = new THREE.Vector3(), rightOffset = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  const indices = [];
  for (let leaf = 0; leaf < count; leaf++) {
    const first = leaf * 4;
    root.fromBufferAttribute(positions, first); left.fromBufferAttribute(positions, first + 1);
    right.fromBufferAttribute(positions, first + 2); tip.fromBufferAttribute(positions, first + 3);
    let originalArea = 0;
    for (let offset = leaf * 18; offset < leaf * 18 + 18; offset += 3) {
      triangle.a.fromBufferAttribute(source.attributes.position, source.index.getX(offset));
      triangle.b.fromBufferAttribute(source.attributes.position, source.index.getX(offset + 1));
      triangle.c.fromBufferAttribute(source.attributes.position, source.index.getX(offset + 2));
      originalArea += triangle.getArea();
    }
    const diamondArea = triangle.set(root, left, tip).getArea() + triangle.set(root, tip, right).getArea();
    let widthScale = originalArea / diamondArea;
    centre.copy(left).add(right).multiplyScalar(.5);
    leftOffset.copy(left).sub(centre); rightOffset.copy(right).sub(centre);
    // The raised centre fold contributes a little area of its own, so refine
    // width instead of assuming the folded diamond scales perfectly linearly.
    for (let refinement = 0; refinement < 3; refinement++) {
      left.copy(leftOffset).multiplyScalar(widthScale).add(centre);
      right.copy(rightOffset).multiplyScalar(widthScale).add(centre);
      const area = triangle.set(root, left, tip).getArea() + triangle.set(root, tip, right).getArea();
      widthScale *= originalArea / area;
    }
    left.copy(leftOffset).multiplyScalar(widthScale).add(centre);
    right.copy(rightOffset).multiplyScalar(widthScale).add(centre);
    positions.setXYZ(first + 1, left.x, left.y, left.z);
    positions.setXYZ(first + 2, right.x, right.y, right.z);
    indices.push(first, first + 1, first + 3, first, first + 3, first + 2);
  }
  result.setIndex(indices); result.computeVertexNormals();
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}
