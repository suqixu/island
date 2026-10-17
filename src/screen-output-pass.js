import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createScreenOutputPass() {
  const output = new OutputPass();
  // This terminal pass writes only to the screen. Preserve the scene buffer so
  // the composer never binds/allocates its otherwise unused full-size target.
  output.needsSwap = false;
  return output;
}
