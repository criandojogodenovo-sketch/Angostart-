/**
 * AngoStart — Detecção de suporte a WebGL (Fase 22/23).
 *
 * Partilhado pelos loaders 3D (Avatar3DLoader e ChatMascotLoader): deteta
 * SE o dispositivo consegue renderizar WebGL antes de montar o canvas.
 * Nunca lança — devolve false em qualquer cenário de falha.
 */
export function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}
