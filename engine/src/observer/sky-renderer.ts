import * as AstronomyModule from 'astronomy-engine';
// astronomy-engine 2.1.19 needs this namespace bridge for Node/tsx and Vite parity.
const Astronomy: typeof AstronomyModule = Reflect.get(AstronomyModule, 'default') ?? AstronomyModule;
const { Body, RotationAxis } = Astronomy;
import { refractedAltitude } from './astronomy';
import { assetUrl } from './assets';
import { planetLocatorMagnitude } from './allsky';
import { tanHalfFov } from './zoom';
import { PlanetTextureManager } from './planet-textures';
import { SATURN_RING_INNER, SATURN_RING_OUTER } from './saturn-rings';
import { CONSTELLATIONS } from '../data/constellations';
import { HipsRenderer } from '../hips/hips-renderer';
import type { CameraState, ProjectedPoint, RenderStats, SkyBody, SkySettings, SkyState, Vec3 } from './types';
import { BODY_FRAG, LINE_FRAG, LINE_VERT, QUAD_VERT, SKY_FRAG, STAR_FRAG, STAR_VERT } from './shaders/sky';

const RAD = Math.PI / 180;
export const CATALOG_LEVELS = [
  { file: 'stars-lod0.bin', count: 520 }, { file: 'stars-lod1.bin', count: 2313 },
  { file: 'stars-lod2.bin', count: 12625 }, { file: 'stars-lod3.bin', count: 67665 },
  { file: 'stars-lod4.bin', count: 32394 },
] as const;
export const CATALOG_STAR_COUNT = 115517;
const IDENTITY = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
const DEFAULT_SETTINGS: SkySettings = { atmosphere:false, ground:false, constellations:false, grid:false, labels:true, milkyWay:true, refraction:false, lightPollution:4, mode:'visual' };
const BODY_ENUM: Record<string,AstronomyModule.Body> = { sun:Body.Sun, moon:Body.Moon, mercury:Body.Mercury, venus:Body.Venus, mars:Body.Mars, jupiter:Body.Jupiter, saturn:Body.Saturn, uranus:Body.Uranus, neptune:Body.Neptune };
const clamp = (x:number, min:number, max:number) => Math.max(min,Math.min(max,x));
const dot = (a:Vec3,b:Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const normalize = (a:Vec3):Vec3 => { const n=Math.hypot(...a)||1; return [a[0]/n,a[1]/n,a[2]/n]; };
const smooth = (a:number,b:number,x:number) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

export function horizontalDirection(azimuthDeg:number, altitudeDeg:number):Vec3 {
  const a=azimuthDeg*RAD,h=altitudeDeg*RAD,c=Math.cos(h);
  return [c*Math.sin(a),Math.sin(h),-c*Math.cos(a)];
}
export function transformDirection(m:Float32Array,p:Vec3):Vec3 {
  return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2],m[1]*p[0]+m[5]*p[1]+m[9]*p[2],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]];
}
export function equatorialDirection(raRad:number,decRad:number):Vec3 {
  return [Math.cos(decRad)*Math.cos(raRad),Math.sin(decRad),Math.cos(decRad)*Math.sin(raRad)];
}
export function apparentDirection(p:Vec3,enabled:boolean):Vec3 {
  if(!enabled) return p;
  const alt=Math.asin(clamp(p[1],-1,1))/RAD;
  return horizontalDirection(Math.atan2(p[0],-p[2])/RAD,refractedAltitude(alt));
}
export function cameraBasis(camera:CameraState):{right:Vec3;up:Vec3;forward:Vec3} {
  const a=camera.azimuthDeg*RAD,h=camera.altitudeDeg*RAD;
  return { right:[Math.cos(a),0,Math.sin(a)], up:[-Math.sin(a)*Math.sin(h),Math.cos(h),Math.cos(a)*Math.sin(h)], forward:horizontalDirection(camera.azimuthDeg,camera.altitudeDeg) };
}
/** CSS-pixel pinhole projection; a point behind the viewer is never visible. */
export function projectDirection(p:Vec3,camera:CameraState,width:number,height:number,ground=false):ProjectedPoint {
  const {right,up,forward}=cameraBasis(camera),depth=dot(p,forward);
  const tan=tanHalfFov(camera.fovDeg),aspect=width/Math.max(1,height);
  const nx=dot(p,right)/(depth*tan*aspect),ny=dot(p,up)/(depth*tan);
  const altitudeDeg=Math.asin(clamp(p[1],-1,1))/RAD;
  return { x:(nx+1)*width/2,y:(1-ny)*height/2,
    visible:depth>0 && Number.isFinite(nx) && Number.isFinite(ny) && Math.abs(nx)<=1 && Math.abs(ny)<=1 && (!ground||altitudeDeg>=-1e-6),
    altitudeDeg,azimuthDeg:(Math.atan2(p[0],-p[2])/RAD+360)%360 };
}
/** Display model, not an instrument calibration or a claim of Bortle-class precision. */
export function skyPhotometry(sunAltitudeDeg:number,settings:SkySettings,fovDeg:number) {
  const pollution=clamp(settings.lightPollution,1,9);
  const darkness=settings.atmosphere ? 1-smooth(-18,-3,sunAltitudeDeg) : 1;
  const zoom=clamp(Math.log2(60/Math.max(0.1,fovDeg))*0.35,0,1.5);
  const enhanced=settings.mode==='enhanced';
  const darkLimit=(enhanced?8.7:6.4)-0.43*(pollution-1)+zoom;
  const limitingMagnitude=Math.min(11,settings.atmosphere ? darkLimit-7*(1-darkness) : darkLimit);
  return { limitingMagnitude, exposure:45*Math.pow(10,0.4*(limitingMagnitude-6.4)), starVisibility:darkness*darkness,
    milkyWayOpacity:(enhanced?0.26:0.105)*Math.pow(darkness,3)*Math.pow(1-(pollution-1)/10,2) };
}
export function projectedIlluminatedFraction(targetDirection:Vec3,targetToSun:Vec3):number {
  return clamp((1-dot(normalize(targetDirection),normalize(targetToSun)))/2,0,1);
}
export function angularDiameterCssPixels(angularDiameterRad:number,fovDeg:number,height:number):number {
  return height*Math.tan(angularDiameterRad/2)/tanHalfFov(fovDeg);
}
/** Circular local optical window, NOT the ellipse of an off-axis pinhole sphere.
 * The center retains projectDirection's sky projection; both CSS axes use the
 * centered optical scale tan(angularRadius)/tan(FOV/2). No physical size changes.
 * radius is the unchanged unit-distance sphere radius sin(angularDiameter/2).
 * CPU culling, picking and the shader all use this same circle. */
export function bodyViewGeometry(center:Vec3,radius:number,camera:CameraState,width:number,height:number,extentScale=1) {
  if(!(radius>0&&radius<1)||!Number.isFinite(radius)||!(width>0&&height>0)||!Number.isFinite(width+height)||!center.every(Number.isFinite))return null;
  const b=cameraBasis(camera),forward=normalize(center),v:Vec3=[dot(forward,b.right),dot(forward,b.up),dot(forward,b.forward)];
  const [x,y,z]=v,ty=tanHalfFov(camera.fovDeg),tx=ty*width/height;
  const tangentRadius=radius/Math.sqrt((1-radius)*(1+radius)); // exactly tan(angularDiameter/2)
  // Enlarges only ring culling/draw rect; physical globe optics/picking unchanged.
  const extentRadius=radius*extentScale;
  if(!(extentRadius>0&&extentRadius<1)||!Number.isFinite(extentRadius))return null;
  const boundRadius=extentRadius/Math.sqrt((1-extentRadius)*(1+extentRadius));
  // Reject BEFORE dividing: a camera-plane/behind-camera center has no local
  // optical window, even when the old sphere cone would cross the near plane.
  if(!(z>0&&tx>0&&ty>0)||!Number.isFinite(tx+ty)||
     Math.abs(x)>z*(tx+boundRadius)||Math.abs(y)>z*(ty+boundRadius))return null;
  const cx=x/z,cy=y/z;
  // A circle outside a viewport corner must not acquire a spurious rectangle.
  if(Math.hypot(Math.max(0,Math.abs(cx)-tx),Math.max(0,Math.abs(cy)-ty))>boundRadius)return null;
  const centerNdc:[number,number]=[cx/tx,cy/ty],rx=boundRadius/tx,ry=boundRadius/ty;
  const rect:[number,number,number,number]=[Math.max(-1,centerNdc[0]-rx),Math.max(-1,centerNdc[1]-ry),Math.min(1,centerNdc[0]+rx),Math.min(1,centerNdc[1]+ry)];
  // Shortest-arc rotation camera.forward -> body.forward, with no arbitrary
  // look-at pole or roll flip. z>0 makes 1+z well conditioned. These are the
  // transported camera axes expressed back in the apparent world frame.
  const k=1/(1+z);
  const fromView=(p:Vec3):Vec3=>b.right.map((r,i)=>r*p[0]+b.up[i]*p[1]+b.forward[i]*p[2]) as Vec3;
  const right=fromView([1-x*x*k,-x*y*k,-x]),up=fromView([-x*y*k,1-y*y*k,-y]);
  return {centerView:v,centerNdc,rect,right,up,forward,radiusCssPixels:height*tangentRadius/(2*ty)};
}
/** Inclusive circular limb picking in CSS pixels, also with an off-screen center.
 * Deliberately no old world-ray sphere-cone test: that would pick an ellipse. */
export function bodyDiskContains(center:Vec3,diameterRad:number,camera:CameraState,width:number,height:number,x:number,y:number):boolean {
  if(!(diameterRad>0&&diameterRad<Math.PI)||!Number.isFinite(x+y)||x<0||x>width||y<0||y>height)return false;
  const geometry=bodyViewGeometry(center,Math.sin(diameterRad/2),camera,width,height);
  if(!geometry)return false;
  const [nx,ny]=geometry.centerNdc,dx=x-(nx+1)*width/2,dy=y-(1-ny)*height/2;
  // Only round-off slack at the mathematical limb, not an enlarged hit target.
  return Math.hypot(dx,dy)<=geometry.radiusCssPixels*(1+1e-12);
}
export function validateCatalog(buffer:ArrayBuffer,expectedCount:number):Float32Array {
  if(buffer.byteLength!==expectedCount*16) throw new Error(`目录长度异常：${buffer.byteLength/16}/${expectedCount}`);
  const data=new Float32Array(buffer);
  for(let i=0;i<data.length;i+=4) if(!Number.isFinite(data[i])||!Number.isFinite(data[i+1])||!Number.isFinite(data[i+2])||!Number.isFinite(data[i+3])||Math.abs(data[i+1])>Math.PI/2+1e-5) throw new Error(`目录记录异常：${i/4}`);
  return data;
}
function multiply(a:Float32Array,b:Float32Array,out:Float32Array) {
  for(let col=0;col<4;col++) for(let row=0;row<4;row++) out[col*4+row]=a[row]*b[col*4]+a[4+row]*b[col*4+1]+a[8+row]*b[col*4+2]+a[12+row]*b[col*4+3];
}
interface Program { program:WebGLProgram; uniforms:Map<string,WebGLUniformLocation|null>; }
interface Mesh { vao:WebGLVertexArrayObject; buffer:WebGLBuffer; count:number; }
interface Axes { north:Vec3;prime:Vec3;east:Vec3; }

export class SkyRenderer {
  private gl:WebGL2RenderingContext;
  private ready=false;
  private disposed=false;
  private initPromise:Promise<void>|null=null;
  private programs:Program[]=[];
  private starProgram!:Program;
  private skyProgram!:Program;
  private lineProgram!:Program;
  private bodyProgram!:Program;
  private meshes:Mesh[]=[];
  private stars!:Mesh;
  private bodyPoints!:Mesh;
  private grid!:Mesh;
  private horizon!:Mesh;
  private constellations!:Mesh;
  private quadVAO!:WebGLVertexArrayObject;
  private fallbackTexture!:WebGLTexture;
  private hips!:HipsRenderer;
  private textureManager!:PlanetTextureManager;
  private lost=false;
  private catalogFailures:string[]=[];
  private controllers=new Set<AbortController>();
  private bodyPointData=new Float32Array(16*4);
  private view=new Float32Array(16);
  private projection=new Float32Array(16);
  private equatorialView=new Float32Array(16);
  private normalMatrix=new Float32Array(9);
  private basis=cameraBasis({azimuthDeg:0,altitudeDeg:0,fovDeg:60});
  private axesState:SkyState|null=null;
  private bodyAxes=new Map<string,Axes>();
  private settings={...DEFAULT_SETTINGS};
  private width=1;
  private height=1;
  private dpr=1;
  private maxPointSize=64;
  private stats:RenderStats={catalogCount:0,hipsTiles:0,hipsLoading:0,fps:0,status:'正在初始化渲染器'};
  private fpsAt=0;
  private frameCount=0;
  private contextLost=() => { this.ready=false; this.lost=true; this.textureManager?.contextLost(); this.stats.status='WebGL 上下文丢失，请刷新独立预览'; };

  constructor(private canvas:HTMLCanvasElement) {
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,depth:true,powerPreference:'high-performance',premultipliedAlpha:false});
    if(!gl) throw new Error('此浏览器没有可用的 WebGL2；没有执行 GPU 画面验收');
    this.gl=gl; canvas.addEventListener('webglcontextlost',this.contextLost); this.resize();
  }
  async init():Promise<void> {
    if(this.disposed) throw new Error('渲染器已释放');
    if(!this.initPromise) this.initPromise=this.initialize();
    return this.initPromise;
  }
  private async initialize() {
    const gl=this.gl;
    this.starProgram=this.createProgram(STAR_VERT,STAR_FRAG);this.skyProgram=this.createProgram(QUAD_VERT,SKY_FRAG);
    this.lineProgram=this.createProgram(LINE_VERT,LINE_FRAG);this.bodyProgram=this.createProgram(QUAD_VERT,BODY_FRAG);
    this.quadVAO=gl.createVertexArray()!;this.fallbackTexture=this.createPlaceholder();
    this.textureManager=new PlanetTextureManager(gl);
    this.maxPointSize=(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1];
    this.bodyPoints=this.makeMesh(this.bodyPointData,4,gl.DYNAMIC_DRAW);
    this.grid=this.makeMesh(this.gridData(false),3);this.horizon=this.makeMesh(this.gridData(true),3);
    this.constellations=this.makeMesh(this.constellationData(),3);
    this.hips=new HipsRenderer(gl,{url:'https://alasky.cds.unistra.fr/MellingerRGB',maxOrder:3,tileSize:512,format:'jpg',frame:'galactic',requireCompleteBase:true,maxRetries:2});
    this.hips.init();
    const levels=await Promise.all(CATALOG_LEVELS.map(async level=>{
      const controller=new AbortController();this.controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),15000);
      try {
        const response=await fetch(assetUrl(`./data/${level.file}`),{signal:controller.signal});
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        return validateCatalog(await response.arrayBuffer(),level.count);
      } catch(error) { this.catalogFailures.push(`${level.file}: ${error instanceof Error?error.message:String(error)}`); return null; }
      finally { clearTimeout(timer); this.controllers.delete(controller); }
    }));
    if(this.disposed||this.lost) return;
    const length=levels.reduce((sum,data)=>sum+(data?.length??0),0);
    if(!length) { this.stats.status='目录加载失败：没有目录星，未生成替代星点'; throw new Error(this.stats.status); }
    const stars=new Float32Array(length);let offset=0;
    for(const data of levels) if(data) { stars.set(data,offset);offset+=data.length; }
    this.stars=this.makeMesh(stars,4);this.stats.catalogCount=stars.length/4;this.ready=true;
    this.fpsAt=performance.now();
    this.stats.status=this.catalogFailures.length?'部分真实星表加载失败（未用生成点替代）':'真实目录就绪；银河底图准备 0/12';
  }
  render(state:SkyState,camera:CameraState,settings:SkySettings):void {
    if(this.disposed||!this.ready) return;
    const gl=this.gl;this.settings={...settings};this.resize();this.updateCamera(camera);
    multiply(this.view,state.equatorialToHorizontal,this.equatorialView);
    const photo=skyPhotometry(state.sunAltitudeDeg,settings,camera.fovDeg);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clearDepth(1);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);gl.depthMask(false);this.drawSky(state,camera,false);
    if(settings.milkyWay && photo.milkyWayOpacity>0.0001) {
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);this.hips.setOpacity(photo.milkyWayOpacity);
      this.hips.render(this.equatorialView,this.projection,camera.fovDeg*RAD,[this.canvas.width,this.canvas.height],{equatorialToHorizontal:state.equatorialToHorizontal,horizontalView:this.view,refraction:settings.refraction});
      gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    }
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);this.drawStars(this.stars,this.stars.count,state,settings,photo);
    if(settings.constellations) this.drawLines(this.constellations,state.equatorialToHorizontal,[0.35,0.55,0.74,0.28*photo.starVisibility],settings.refraction);
    this.drawBodies(state,camera,settings,photo);
    gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.BLEND);
    if(settings.ground) this.drawSky(state,camera,true);
    if(settings.grid) this.drawLines(this.grid,IDENTITY,[0.32,0.56,0.66,0.18],false);
    if(settings.ground) this.drawLines(this.horizon,IDENTITY,[0.53,0.66,0.58,0.40],false);
    gl.bindVertexArray(null);gl.depthMask(true);gl.disable(gl.BLEND);this.updateStats();
  }
  /** Uses last render's ground/refraction switches unless refraction is explicitly supplied. */
  projectEquatorial(raRad:number,decRad:number,state:SkyState,camera:CameraState,refraction=this.settings.refraction):ProjectedPoint {
    this.resizeDimensions();
    const h=normalize(transformDirection(state.equatorialToHorizontal,equatorialDirection(raRad,decRad)));
    return projectDirection(apparentDirection(h,refraction),camera,this.width,this.height,this.settings.ground);
  }
  /** Exact overlay coordinates: pass apparentAltitudeDeg for a refracted body.
   * The physical horizon/compass (alt=0) must NOT itself be refracted. */
  projectHorizontal(azDeg:number,altDeg:number,camera:CameraState):ProjectedPoint {
    this.resizeDimensions();return projectDirection(horizontalDirection(azDeg,altDeg),camera,this.width,this.height,this.settings.ground);
  }
  getStats():RenderStats { return {...this.stats,textures:this.textureManager?.getStats()}; }
  dispose() {
    if(this.disposed) return;this.disposed=true;this.ready=false;
    const gl=this.gl;this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    for(const c of this.controllers) c.abort();this.controllers.clear();this.hips?.dispose();
    for(const p of this.programs) gl.deleteProgram(p.program);
    for(const m of this.meshes) {gl.deleteBuffer(m.buffer);gl.deleteVertexArray(m.vao);}
    if(this.quadVAO) gl.deleteVertexArray(this.quadVAO);
    if(this.fallbackTexture) gl.deleteTexture(this.fallbackTexture);
    this.textureManager?.dispose();this.stats.status='渲染器已释放';
  }
  private resizeDimensions() {this.width=Math.max(1,this.canvas.clientWidth||this.canvas.width||1);this.height=Math.max(1,this.canvas.clientHeight||this.canvas.height||1);}
  private resize() {
    this.resizeDimensions();this.dpr=clamp(globalThis.devicePixelRatio||1,1,2);
    const w=Math.round(this.width*this.dpr),h=Math.round(this.height*this.dpr);
    if(this.canvas.width!==w||this.canvas.height!==h) {this.canvas.width=w;this.canvas.height=h;}
  }
  private updateCamera(camera:CameraState) {
    this.basis=cameraBasis(camera);const {right:r,up:u,forward:f}=this.basis;
    this.view.set([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,0,0,0,1]);
    const cot=1/tanHalfFov(camera.fovDeg),near=.01,far=10;
    this.projection.set([cot*this.height/this.width,0,0,0,0,cot,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  }
  private createProgram(vertex:string,fragment:string):Program {
    const gl=this.gl;
    const compile=(type:number,source:string) => {
      const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`预览 GLSL 编译失败：${error}`);}
      return shader;
    };
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) {const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error(`预览 GLSL 链接失败：${error}`);}
    const p={program,uniforms:new Map<string,WebGLUniformLocation|null>()};this.programs.push(p);return p;
  }
  private loc(p:Program,name:string) {if(!p.uniforms.has(name))p.uniforms.set(name,this.gl.getUniformLocation(p.program,name));return p.uniforms.get(name)!;}
  private scalar(p:Program,name:string,value:number) {this.gl.uniform1f(this.loc(p,name),value);}
  private vec(p:Program,name:string,value:Vec3) {this.gl.uniform3f(this.loc(p,name),...value);}
  private matrix(p:Program,name:string,value:Float32Array) {this.gl.uniformMatrix4fv(this.loc(p,name),false,value);}
  private makeMesh(data:Float32Array,components:number,usage?:number):Mesh {
    const gl=this.gl,vao=gl.createVertexArray()!,buffer=gl.createBuffer()!;
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,usage??gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,components,gl.FLOAT,false,components*4,0);gl.bindVertexArray(null);
    const mesh={vao,buffer,count:data.length/components};this.meshes.push(mesh);return mesh;
  }
  private atmosphereUniforms(p:Program,state:SkyState,camera:CameraState) {
    const sun=state.bodies.find(b=>b.id.toLowerCase()==='sun');
    this.vec(p,'u_right',this.basis.right);this.vec(p,'u_up',this.basis.up);this.vec(p,'u_forward',this.basis.forward);
    const tan=tanHalfFov(camera.fovDeg);this.gl.uniform2f(this.loc(p,'u_tanFov'),tan*this.width/this.height,tan);
    this.vec(p,'u_sunDirection',sun?.direction??horizontalDirection(180,state.sunAltitudeDeg));this.scalar(p,'u_sunAltitude',state.sunAltitudeDeg);
    this.scalar(p,'u_atmosphere',+this.settings.atmosphere);this.scalar(p,'u_pollution',(clamp(this.settings.lightPollution,1,9)-1)/8);
  }
  private drawSky(state:SkyState,camera:CameraState,ground:boolean) {
    const gl=this.gl,p=this.skyProgram;gl.useProgram(p.program);this.atmosphereUniforms(p,state,camera);this.scalar(p,'u_groundPass',+ground);
    gl.uniform4f(this.loc(p,'u_rect'),-1,-1,1,1);gl.bindVertexArray(this.quadVAO);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  private drawStars(mesh:Mesh,count:number,state:SkyState,settings:SkySettings,photo:ReturnType<typeof skyPhotometry>) {
    const gl=this.gl,p=this.starProgram;gl.useProgram(p.program);
    this.matrix(p,'u_equatorial',state.equatorialToHorizontal);this.matrix(p,'u_view',this.view);this.matrix(p,'u_proj',this.projection);
    this.scalar(p,'u_refraction',+settings.refraction);this.scalar(p,'u_ground',+settings.ground);this.scalar(p,'u_atmosphere',+settings.atmosphere);
    this.scalar(p,'u_limit',photo.limitingMagnitude);this.scalar(p,'u_exposure',photo.exposure);this.scalar(p,'u_visibility',photo.starVisibility);
    this.scalar(p,'u_dpr',this.dpr);this.scalar(p,'u_maxPointSize',this.maxPointSize);gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.POINTS,0,count);
  }
  private drawLines(mesh:Mesh,frame:Float32Array,color:[number,number,number,number],refraction:boolean) {
    const gl=this.gl,p=this.lineProgram;gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.program);this.matrix(p,'u_frame',frame);this.matrix(p,'u_view',this.view);this.matrix(p,'u_proj',this.projection);
    this.scalar(p,'u_refraction',+refraction);this.scalar(p,'u_ground',+this.settings.ground);gl.uniform4f(this.loc(p,'u_color'),...color);
    gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.LINES,0,mesh.count);
  }
  private drawBodies(state:SkyState,camera:CameraState,settings:SkySettings,photo:ReturnType<typeof skyPhotometry>) {
    const gl=this.gl;let pointCount=0;const resolved:SkyBody[]=[];
    for(const body of state.bodies) {
      const id=body.id.toLowerCase();
      if(!Number.isFinite(body.angularDiameterRad)||body.angularDiameterRad<=0) continue;
      const diameter=angularDiameterCssPixels(body.angularDiameterRad,camera.fovDeg,this.height);
      if(id!=='sun'&&id!=='moon'&&diameter<1.4) {
        if(pointCount<16) {this.bodyPointData.set([body.raRad,body.decRad,!settings.ground&&!settings.atmosphere?planetLocatorMagnitude(body.magnitude):body.magnitude,id==='mars'?1.25:0.5],pointCount*4);pointCount++;}
      } else resolved.push(body);
    }
    // Unresolved planets have compact photometric PSFs, NOT enlarged surface disks.
    if(pointCount) {
      gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.bodyPoints.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.bodyPointData.subarray(0,pointCount*4));
      this.drawStars(this.bodyPoints,pointCount,state,settings,!settings.ground&&!settings.atmosphere?{...photo,limitingMagnitude:Math.max(6,photo.limitingMagnitude),exposure:Math.max(45,photo.exposure),starVisibility:1}:photo);
    }
    // One scheduling/upload point per frame, only for actually visible disks/rings.
    const visible=resolved.map(body=> {
      const center=apparentDirection(normalize(body.direction),settings.refraction),radius=Math.sin(body.angularDiameterRad/2);
      const extent=body.id.toLowerCase()==='saturn'?SATURN_RING_OUTER:1;
      if(settings.ground&&center[1]+radius*extent<0)return null;
      const geometry=bodyViewGeometry(center,radius,camera,this.width,this.height,extent);
      return geometry?{body,geometry}:null;
    }).filter((entry):entry is NonNullable<typeof entry>=>entry!==null);
    const demands=visible.flatMap(({body,geometry})=> {
      const id=body.id.toLowerCase(),devicePixelDiameter=geometry.radiusCssPixels*2*this.dpr,screenPosition=geometry.centerNdc;
      return id==='saturn'?[{id,devicePixelDiameter,screenPosition},{id:'saturn-ring',devicePixelDiameter:devicePixelDiameter*SATURN_RING_OUTER,screenPosition}]:[{id,devicePixelDiameter,screenPosition}];
    });
    this.textureManager.update(camera,demands,performance.now());
    // Opaque spheres and alpha ring-only pixels share a far-to-near pass. Zero
    // alpha gaps discard before depth writes. Ring/sphere order is analytic.
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(true);gl.disable(gl.CULL_FACE);
    visible.sort((a,b)=>b.body.distanceAU-a.body.distanceAU);
    for(const {body,geometry} of visible) this.drawBody(body,state,camera,settings,geometry);
  }
  private drawBody(body:SkyBody,state:SkyState,camera:CameraState,settings:SkySettings,geometry:NonNullable<ReturnType<typeof bodyViewGeometry>>) {
    const gl=this.gl,p=this.bodyProgram,id=body.id.toLowerCase(),original=normalize(body.direction);
    const center=apparentDirection(original,settings.refraction),radius=Math.sin(body.angularDiameterRad/2);
    const {rect,centerNdc,right,up,forward}=geometry;
    const texture=this.textureManager.get(id),ring=id==='saturn'?this.textureManager.get('saturn-ring'):undefined;
    gl.useProgram(p.program);this.atmosphereUniforms(p,state,camera);
    gl.uniform4f(this.loc(p,'u_rect'),clamp(rect[0],-1,1),clamp(rect[1],-1,1),clamp(rect[2],-1,1),clamp(rect[3],-1,1));
    gl.uniform2f(this.loc(p,'u_centerNdc'),...centerNdc);this.scalar(p,'u_radius',radius);
    this.vec(p,'u_bodyRight',right);this.vec(p,'u_bodyUp',up);this.vec(p,'u_bodyForward',forward);
    // Undo apparent-altitude rotation for physical lighting and body-fixed texture UV.
    this.refractionNormalMatrix(original,center);gl.uniformMatrix3fv(this.loc(p,'u_normalToGeometric'),false,this.normalMatrix);
    this.vec(p,'u_light',body.sunDirection);
    const axes=this.axesFor(body,state);this.vec(p,'u_axisNorth',axes.north);this.vec(p,'u_axisPrime',axes.prime);this.vec(p,'u_axisEast',axes.east);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture?.texture??this.fallbackTexture);gl.uniform1i(this.loc(p,'u_texture'),0);
    this.scalar(p,'u_hasTexture',+(texture?.ready??false));
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,ring?.texture??this.fallbackTexture);gl.uniform1i(this.loc(p,'u_ringTexture'),1);
    this.scalar(p,'u_hasRing',+(ring?.ready??false));gl.uniform2f(this.loc(p,'u_ringRadii'),SATURN_RING_INNER,SATURN_RING_OUTER);gl.activeTexture(gl.TEXTURE0);
    this.vec(p,'u_color',id==='venus'?[0.96,0.93,0.82]:this.hexColor(body.color));
    this.scalar(p,'u_sun',+(id==='sun'));this.scalar(p,'u_moon',+(id==='moon'));
    this.scalar(p,'u_depth',clamp((Math.log10(Math.max(1e-7,body.distanceAU))+6)/10,.01,.99));
    const altitude=Math.asin(clamp(center[1],-1,1))/RAD;
    const airmass=1/(Math.max(0,center[1])+.50572*Math.pow(Math.max(.1,altitude+6.07995),-1.6364));
    this.scalar(p,'u_transmission',settings.atmosphere?Math.pow(10,-.4*.15*Math.max(0,Math.min(40,airmass)-1)):1);
    gl.bindVertexArray(this.quadVAO);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  private refractionNormalMatrix(original:Vec3,apparent:Vec3) {
    const az=Math.atan2(original[0],-original[2]),east:Vec3=[Math.cos(az),0,Math.sin(az)];
    const tangent=(p:Vec3):Vec3=>[-Math.sin(az)*p[1],Math.hypot(p[0],p[2]),Math.cos(az)*p[1]];
    const aUp=tangent(apparent),gUp=tangent(original);
    for(let c=0;c<3;c++) for(let r=0;r<3;r++) this.normalMatrix[c*3+r]=east[r]*east[c]+gUp[r]*aUp[c]+original[r]*apparent[c];
  }
  private axesFor(body:SkyBody,state:SkyState):Axes {
    if(this.axesState!==state) {this.axesState=state;this.bodyAxes.clear();}
    const id=body.id.toLowerCase(),cached=this.bodyAxes.get(id);if(cached)return cached;
    let north:Vec3=[0,1,0],prime:Vec3=[1,0,0],east:Vec3=[0,0,1];const name=BODY_ENUM[id];
    if(name) {
      const axis=RotationAxis(name,state.date),a=axis.ra*15*RAD,d=axis.dec*RAD,w=(axis.spin%360)*RAD;
      // IAU pole/prime meridian in conventional XYZ, swapped Y/Z for engine J2000.
      const q:Vec3=[-Math.sin(a),0,Math.cos(a)],t:Vec3=[-Math.sin(d)*Math.cos(a),Math.cos(d),-Math.sin(d)*Math.sin(a)];
      north=[axis.north.x,axis.north.z,axis.north.y];
      prime=q.map((x,i)=>Math.cos(w)*x+Math.sin(w)*t[i]) as Vec3;
      east=q.map((x,i)=>-Math.sin(w)*x+Math.cos(w)*t[i]) as Vec3;
    }
    const axes={north:normalize(transformDirection(state.equatorialToHorizontal,north)),prime:normalize(transformDirection(state.equatorialToHorizontal,prime)),east:normalize(transformDirection(state.equatorialToHorizontal,east))};
    this.bodyAxes.set(id,axes);return axes;
  }
  private createPlaceholder():WebGLTexture {
    const gl=this.gl,texture=gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([200,200,200,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return texture;
  }
  private hexColor(color:string):Vec3 {const match=/^#([0-9a-f]{6})$/i.exec(color);if(!match)return [.85,.85,.83];const n=parseInt(match[1],16);return [(n>>16)/255,((n>>8)&255)/255,(n&255)/255];}
  private gridData(horizonOnly:boolean):Float32Array {
    const vertices:number[]=[];
    const segment=(az0:number,h0:number,az1:number,h1:number)=>vertices.push(...horizontalDirection(az0,h0),...horizontalDirection(az1,h1));
    if(horizonOnly) {for(let a=0;a<360;a+=2)segment(a,0,a+2,0);}
    else {
      for(let h=-75;h<=75;h+=15)if(h!==0)for(let a=0;a<360;a+=2)segment(a,h,a+2,h);
      for(let a=0;a<360;a+=30)for(let h=-90;h<90;h+=2)segment(a,h,a,h+2);
    }
    return new Float32Array(vertices);
  }
  private constellationData():Float32Array {
    const vertices:number[]=[];
    for(const constellation of CONSTELLATIONS)for(const [ra1,dec1,ra2,dec2] of constellation.lines) {
      const a=equatorialDirection(ra1,dec1),b=equatorialDirection(ra2,dec2),angle=Math.acos(clamp(dot(a,b),-1,1)),segments=Math.max(1,Math.ceil(angle/(2*RAD)));
      const point=(t:number):Vec3=>angle<1e-6?a:normalize(a.map((x,i)=>(x*Math.sin((1-t)*angle)+b[i]*Math.sin(t*angle))/Math.sin(angle)) as Vec3);
      for(let i=0;i<segments;i++)vertices.push(...point(i/segments),...point((i+1)/segments));
    }
    return new Float32Array(vertices);
  }
  private updateStats() {
    const now=performance.now();this.frameCount++;
    if(now-this.fpsAt>=500) {this.stats.fps=this.frameCount*1000/(now-this.fpsAt);this.frameCount=0;this.fpsAt=now;}
    const hips=this.hips.getStats();this.stats.hipsTiles=hips.loaded;this.stats.hipsLoading=hips.loading;
    const warnings:string[]=[];
    if(this.catalogFailures.length)warnings.push(`星表缺失 ${this.catalogFailures.length}/5`);
    if(this.settings.milkyWay) {
      if(hips.baseFailed)warnings.push(`银河底图加载失败 ${hips.baseFailed}/12（银河层关闭，回退目录星）`);
      else if(!hips.baseReady)warnings.push(`银河底图准备 ${hips.baseLoaded}/12`);
      else if(hips.detailFailed)warnings.push(`银河细节失败 ${hips.detailFailed}（保留完整底图）`);
    }
    const textures=this.textureManager.getStats();
    if(textures.failed)warnings.push(`天体贴图失败 ${textures.failed}（保留已就绪贴图；无底图时使用光照纯色）`);
    this.stats.status=warnings.length?warnings.join('；'):`真实目录 ${this.stats.catalogCount.toLocaleString()} 星 · 无生成补点`;
  }
}
