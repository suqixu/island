/** Manual lighting modes are independent of music playback. */
export function getArtificialLightControls(mode='auto'){
  const allOff=mode==='all-off';
  return{artificialLightsOff:allOff,lighthouseLightsOff:allOff||mode==='lighthouse-off'};
}
