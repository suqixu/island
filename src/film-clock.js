/** 影片进度可以重播；模型累计时钟保持单调，避免退出后等待时间追平。 */
export function createFilmClock(state) {
  let previous=0;
  return {
    reset(){previous=0;},
    step(time){state.elapsed+=Math.max(0,time-previous);previous=time;},
    restore(saved){const elapsed=state.elapsed;Object.assign(state,saved,{elapsed});return elapsed-saved.elapsed;},
  };
}
