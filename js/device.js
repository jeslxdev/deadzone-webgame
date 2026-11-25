// Detecção de dispositivo (celular/tablet com toque)
const mq = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
export const isTouch = mq('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && mq('(hover: none)'));
export const isSmallScreen = () => Math.min(innerWidth, innerHeight) < 620;
// Qualidade reduzida em celulares (memória e GPU menores)
export const lowPower = isTouch;
