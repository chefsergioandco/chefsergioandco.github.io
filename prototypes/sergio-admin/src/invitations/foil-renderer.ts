export type FoilRenderer = { draw: (yaw: number, inspect?: boolean, pitch?: number) => void; dispose: () => void }

const vertexSource = `attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUV;
void main() { vUV=aUV; gl_Position=vec4(aPosition,0.0,1.0); }`
const fragmentBody = `varying vec2 vUV;
uniform sampler2D uPaper;
uniform sampler2D uInk;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uAngle;
uniform float uPitch;
uniform float uInspection;
uniform float uFoil;
uniform sampler2D uMask;
uniform float uMasked;
uniform float uLaminate;
float luminance(vec3 c) { return dot(c,vec3(0.2126,0.7152,0.0722)); }
vec3 linearColor(vec3 c) { return pow(max(c,vec3(0.0)),vec3(2.2)); }
void main() {
  vec4 art=texture2D(uInk,vUV);
  vec3 paper=texture2D(uPaper,vUV).rgb;
  float ink=clamp(art.a,0.0,1.0);
  vec2 stepUV=uTexel*1.35;
  float h=texture2D(uHeight,vUV).a;
  float hL=texture2D(uHeight,vUV-vec2(stepUV.x,0.0)).a;
  float hR=texture2D(uHeight,vUV+vec2(stepUV.x,0.0)).a;
  float hB=texture2D(uHeight,vUV-vec2(0.0,stepUV.y)).a;
  float hT=texture2D(uHeight,vUV+vec2(0.0,stepUV.y)).a;
  vec2 slope=vec2(hR-hL,hT-hB);
  float pL=luminance(texture2D(uPaper,vUV-vec2(uTexel.x,0.0)).rgb);
  float pR=luminance(texture2D(uPaper,vUV+vec2(uTexel.x,0.0)).rgb);
  float pB=luminance(texture2D(uPaper,vUV-vec2(0.0,uTexel.y)).rgb);
  float pT=luminance(texture2D(uPaper,vUV+vec2(0.0,uTexel.y)).rgb);
  vec2 fiber=vec2(pL-pR,pB-pT);
  /* z=-depth*h is a cavity: the wall normal points INTO each glyph. */
  vec3 paperNormal=normalize(vec3(fiber*0.8,1.0));
  vec3 inkNormal=normalize(vec3(slope*0.18+fiber*0.08,1.0));
  vec3 light=normalize(vec3(-0.55,0.65,1.4));
  float paperDiffuse=0.965+0.035*max(0.0,dot(paperNormal,light));
  float faceDiffuse=0.86+0.14*max(0.0,dot(inkNormal,light));
  /* A shallow top/left inner wall darkens; the opposite lip is not a
     painted white outline. Broad reflections can cross the glyph floor. */
  float wallShade=clamp(dot(slope,vec2(-0.55,0.65)),0.0,1.0);
  float cavityAO=1.0-0.16*wallShade-0.035*h*(1.0-h);
  vec3 base=mix(linearColor(paper)*paperDiffuse,linearColor(art.rgb)*faceDiffuse*cavityAO,ink);
  /* The local view varies over the sheet. At angle=0 the softbox lands
     near x=.76; +14 degrees shifts it toward x=.44. */
  float viewX=sin(uAngle)*0.72+(vUV.x-0.5)*0.55;
  float viewY=-0.16+sin(uPitch)*0.65+(vUV.y-0.5)*0.08;
  vec3 view=normalize(vec3(viewX,viewY,max(0.3,cos(uAngle)*cos(uPitch))));
  vec3 glossNormal=normalize(vec3(slope*0.035+fiber*0.05,1.0));
  vec3 reflection=reflect(-view,glossNormal);
  vec2 environment=reflection.xy/max(0.35,reflection.z);
  float grain=luminance(paper)-0.94;
  float roughness=clamp(0.19+grain*1.4,0.16,0.28);
  float boxWidth=0.078+roughness*0.13;
  float boxX=abs((environment.x+0.14)/boxWidth);
  float boxY=(environment.y-0.16)/0.70;
  /* A broad, nearly white rectangular studio source with soft edges. */
  float softbox=exp(-pow(boxX,4.0))*exp(-boxY*boxY);
  float broadFill=0.018*exp(-pow((environment.x-0.28)/0.35,2.0));
  float ndv=max(0.0,dot(glossNormal,view));
  float fresnel=0.055+0.945*pow(1.0-ndv,5.0);
  float gloss=clamp((softbox+broadFill)*fresnel*(17.5+uInspection),0.0,0.92);
  /* Only printed material reflects the softbox. The cotton stays matte. A mask, when given, limits the
     reflection to foil, so flat ink printed beside it stays as matte as the paper. */
  float foilAmount=mix(ink,clamp(texture2D(uMask,vUV).a,0.0,1.0),uMasked);
  base+=foilAmount*gloss*uFoil*(vec3(1.0)-base);
  /* A satin overlaminate (a plastic card) is smooth and covers everything printed beneath it: one faint,
     sharper reflection of the same studio source across the whole surface, ink and paper alike. */
  vec3 laminateReflection=reflect(-view,vec3(0.0,0.0,1.0));
  vec2 laminateEnvironment=laminateReflection.xy/max(0.35,laminateReflection.z);
  float laminateBox=exp(-pow(abs((laminateEnvironment.x+0.14)/0.06),4.0))*exp(-pow((laminateEnvironment.y-0.16)/0.55,2.0));
  float laminateFresnel=0.04+0.96*pow(1.0-max(0.0,view.z),5.0);
  base+=uLaminate*laminateBox*laminateFresnel*3.0*(vec3(1.0)-base);
  gl_FragColor=vec4(pow(clamp(base,0.0,1.0),vec3(1.0/2.2)),1.0);
}`

/** The cotton is diffuse; only the separately masked foil reflects the studio source. Without `foilMask`,
 * every printed mark on a foil face reflects (the invitation); with it, only the mask's marks do (the gift card). */
export function createFoilRenderer(target: HTMLCanvasElement, paper: HTMLCanvasElement, ink: HTMLCanvasElement, height: HTMLCanvasElement, foil: boolean, foilMask?: HTMLCanvasElement, laminate = 0): FoilRenderer | null {
  let gl: WebGLRenderingContext | null
  try { gl = target.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' }) } catch { return null }
  if (!gl || paper.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || paper.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null
  const context = gl
  const shaders: WebGLShader[] = [], textures: WebGLTexture[] = []
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, disposed = false
  const release = () => { textures.forEach(texture => context.deleteTexture(texture)); shaders.forEach(shader => context.deleteShader(shader)); context.deleteBuffer(buffer); context.deleteProgram(program) }
  const compile = (type: number, source: string) => {
    const shader = context.createShader(type)
    if (!shader) throw new Error('Material shader unavailable')
    shaders.push(shader); context.shaderSource(shader, source); context.compileShader(shader)
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('Material shader could not compile')
    return shader
  }
  try {
    target.width = paper.width; target.height = paper.height
    program = context.createProgram()
    if (!program) throw new Error('Material program unavailable')
    const precision = context.getShaderPrecisionFormat(context.FRAGMENT_SHADER, context.HIGH_FLOAT)
    context.attachShader(program, compile(context.VERTEX_SHADER, vertexSource))
    context.attachShader(program, compile(context.FRAGMENT_SHADER, `precision ${precision?.precision ? 'highp' : 'mediump'} float;\n${fragmentBody}`))
    context.linkProgram(program)
    if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error('Material program could not link')
    context.useProgram(program)
    buffer = context.createBuffer(); context.bindBuffer(context.ARRAY_BUFFER, buffer)
    context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]), context.STATIC_DRAW)
    const position = context.getAttribLocation(program, 'aPosition'), uv = context.getAttribLocation(program, 'aUV')
    context.enableVertexAttribArray(position); context.vertexAttribPointer(position, 2, context.FLOAT, false, 16, 0)
    context.enableVertexAttribArray(uv); context.vertexAttribPointer(uv, 2, context.FLOAT, false, 16, 8)
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true); context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    // Without a mask, unit 3 holds a 1×1 transparent texture and uMasked=0, so the result is unchanged.
    const blank = document.createElement('canvas'); blank.width = 1; blank.height = 1
    ;[paper, ink, height, foilMask ?? blank].forEach((canvas, index) => {
      const texture = context.createTexture()
      if (!texture) throw new Error('Material texture unavailable')
      textures.push(texture); context.activeTexture(context.TEXTURE0 + index); context.bindTexture(context.TEXTURE_2D, texture)
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE); context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE)
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR); context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR)
      context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, canvas)
    })
    context.uniform1i(context.getUniformLocation(program, 'uPaper'), 0); context.uniform1i(context.getUniformLocation(program, 'uInk'), 1); context.uniform1i(context.getUniformLocation(program, 'uHeight'), 2)
    context.uniform1i(context.getUniformLocation(program, 'uMask'), 3); context.uniform1f(context.getUniformLocation(program, 'uMasked'), foilMask ? 1 : 0); context.uniform1f(context.getUniformLocation(program, 'uLaminate'), laminate)
    context.uniform2f(context.getUniformLocation(program, 'uTexel'), 1 / paper.width, 1 / paper.height)
    context.uniform1f(context.getUniformLocation(program, 'uFoil'), foil ? 1 : 0)
    const angle = context.getUniformLocation(program, 'uAngle'), inspection = context.getUniformLocation(program, 'uInspection'), pitch = context.getUniformLocation(program, 'uPitch')
    context.disable(context.DEPTH_TEST); context.disable(context.BLEND); context.viewport(0, 0, paper.width, paper.height)
    target.dataset.renderer = 'webgl'
    return {
      draw(yaw, inspect = false, pitchRadians = 0) {
        if (disposed || context.isContextLost()) return
        context.useProgram(program); context.uniform1f(angle, Number.isFinite(yaw) ? yaw : 0); context.uniform1f(inspection, inspect ? .5 : 0); context.uniform1f(pitch, Number.isFinite(pitchRadians) ? pitchRadians : 0)
        context.drawArrays(context.TRIANGLES, 0, 6)
      },
      dispose() { if (!disposed) { disposed = true; release(); delete target.dataset.renderer } },
    }
  } catch { release(); return null }
}

const cachedPapers = new Map<string, HTMLCanvasElement>()
export function cottonPaper(width = 1400, height = 1000): HTMLCanvasElement {
  const key = `${width}x${height}`, cached = cachedPapers.get(key)
  if (cached) return cached
  const paper = document.createElement('canvas'); paper.width = width; paper.height = height
  const context = paper.getContext('2d')!
  const image = context.createImageData(paper.width, paper.height), pixels = image.data
  let seed = 43129
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
  for (let y = 0; y < paper.height; y++) for (let x = 0; x < paper.width; x++) {
    const offset = (y * paper.width + x) * 4, variation = (random() - .5) * 3.7 + Math.sin(x * .017 + y * .013) * .28 + Math.sin(x * .006 - y * .011) * .35
    pixels[offset] = 254 + variation; pixels[offset + 1] = 254 + variation; pixels[offset + 2] = 253 + variation; pixels[offset + 3] = 255
  }
  context.putImageData(image, 0, 0); context.lineCap = 'round'
  for (let index = 0; index < Math.round(10000 * width * height / 1400000); index++) {
    const x = random() * paper.width, y = random() * paper.height, length = random() * 5 + 1, angle = random() * Math.PI * 2
    context.strokeStyle = index % 3 ? 'rgba(123,123,121,.025)' : 'rgba(255,255,255,.13)'; context.lineWidth = .3 + random() * .5
    context.beginPath(); context.moveTo(x, y); context.quadraticCurveTo(x + Math.cos(angle) * length * .5, y + Math.sin(angle) * length * .4, x + Math.cos(angle) * length, y + Math.sin(angle) * length); context.stroke()
  }
  cachedPapers.set(key, paper)
  return paper
}
