import {parseFilmScript} from './film-script.js';

export function createFilmLibrary(sources,{capabilities}={}) {
  const films=[],errors=[];
  for(const [path,source] of Object.entries(sources).sort(([a],[b])=>a.localeCompare(b))){
    const id=path.split('/').at(-1).replace(/\.json$/,'');
    try{films.push({id,script:parseFilmScript(source.default??source,{capabilities})});}
    catch(error){errors.push({id,message:error.message});}
  }
  return {films,errors};
}
