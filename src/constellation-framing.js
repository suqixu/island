// Keep at least an 80-degree field along the shorter screen dimension so
// complete constellations fit without moving their catalogue stars.
export function getConstellationViewFov(baseFov,aspect,enabled){
  if(!enabled)return baseFov;
  const wideFov=2*Math.atan(Math.tan(40*Math.PI/180)/Math.min(1,aspect))*180/Math.PI;
  return Math.max(baseFov,Math.min(125,wideFov));
}
