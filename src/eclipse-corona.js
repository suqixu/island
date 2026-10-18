// Shared solar/lunar corona: soft radial falloff with broad, uneven streamers.
export const ECLIPSE_CORONA_GLSL=/* glsl */`
  float eclipseCorona(float radius,float angle){
    return exp(-max(0.0,radius-1.0)*2.8)
      *(0.65+0.35*pow(abs(cos(angle*3.0)),3.0))
      *smoothstep(1.0,1.07,radius)*(1.0-smoothstep(2.6,4.2,radius));
  }
`;
