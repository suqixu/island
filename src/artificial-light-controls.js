/** Manual controls compose with scene-driven blackout requests. */
export function getArtificialLightControls(mode='auto',sceneBlackout=false){
  const allOff=Boolean(sceneBlackout||mode==='all-off');
  return{artificialLightsOff:allOff,lighthouseLightsOff:allOff||mode==='lighthouse-off'};
}
