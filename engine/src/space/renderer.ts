import { HipsRenderer } from '../hips/hips-renderer';
import { PlanetTextureManager, type PlanetTextureDemand, type PlanetTextureStats } from '../observer/planet-textures';
import { SATURN_RING_INNER, SATURN_RING_OUTER } from '../observer/saturn-rings';
import { QUAD_VERT, SPACE_BODY_FRAG, SPACE_STAR_VERT, SPACE_STAR_FRAG } from './shaders';
import { STELLAR_SURFACE_FRAG } from './stellar-shaders';
import { OBSERVATION_MAP_SOURCES } from './observations';
import { StellarFramePlanner, STELLAR_RESOLVED_DIAMETER, STELLAR_SURFACE_DIAMETER, type StellarFrame } from './stellar-render';
import { bodyFrame, bodyHitDistance, clamp, finiteVector, logarithmicDepth, photographicBackgroundWeight, projectSpace, RAD, relativePosition, spaceCameraBasis, starMagnitude, textureCamera, validCamera, type BodyFrame } from './render-math';
import type { CatalogStar3D, SpaceCamera, SpaceProjection, SpaceRenderOptions, SpaceSnapshot, SpaceView, Vec3 } from './types';

interface Program { program:WebGLProgram; uniforms:Map<string,WebGLUniformLocation|null>; }
interface PointMesh { vao:WebGLVertexArrayObject; buffer:WebGLBuffer; count:number; }
export interface SpaceRenderStats {
  catalogCount:number; rejectedStars:number; drawnStars:number; bodiesDrawn:number; resolvedBodies:number; locatorBodies:number;
  hipsTiles:number; hipsLoading:number; backgroundWeight:number; fps:number; status:string; textures?:PlanetTextureStats;
  resolvedStars:number;
}
const RESOLVED_DIAMETER=1.4;
const NO_STELLAR_FRAMES:readonly StellarFrame[]=[];
const MELLINGER='https://alasky.cds.unistra.fr/MellingerRGB';

/** One canvas, one finite EQJ world. Never calls Earth-observer ephemerides or modal/globe code. */
export class SpaceRenderer {
  private readonly gl:WebGL2RenderingContext;
  private ready=false;
  private disposed=false;
  private lost=false;
  private programs:Program[]=[];
  private starProgram!:Program;
  private bodyProgram!:Program;
  private stellarProgram?:Program;
  private stellarPlanner?:StellarFramePlanner;
  private renderedStellarFrames:readonly StellarFrame[]=NO_STELLAR_FRAMES;
  private stellarFailed=false;
  private previousSuppression='';
  private quad!:WebGLVertexArrayObject;
  private placeholder!:WebGLTexture;
  private stars!:PointMesh;
  private locators!:PointMesh;
  private textureManager!:PlanetTextureManager;
  private hips!:HipsRenderer;
  private catalog:CatalogStar3D[]=[];
  private starData=new Float32Array(0);
  private locatorData=new Float32Array(0);
  private previousPosition?:Vec3;
  private width=1;
  private height=1;
  private dpr=1;
  private maxPointSize=64;
  private viewMatrix=new Float32Array(16);
  private projectionMatrix=new Float32Array(16);
  private fpsAt=0;
  private frameCount=0;
  private lastCinematic=true;
  private stats:SpaceRenderStats={catalogCount:0,rejectedStars:0,drawnStars:0,bodiesDrawn:0,resolvedBodies:0,locatorBodies:0,resolvedStars:0,hipsTiles:0,hipsLoading:0,backgroundWeight:0,fps:0,status:'三维渲染器初始化'};
  private onContextLost=(event:Event)=>{event.preventDefault();this.ready=false;this.lost=true;this.textureManager?.contextLost();this.stats.status='WebGL 上下文丢失，请刷新空间预览';};

  constructor(private readonly canvas:HTMLCanvasElement){
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,depth:true,powerPreference:'high-performance',premultipliedAlpha:false});
    if(!gl)throw new Error('此浏览器没有可用的 WebGL2');
    this.gl=gl;canvas.addEventListener('webglcontextlost',this.onContextLost);this.resize();
  }
  async init(stars:CatalogStar3D[]):Promise<void>{
    if(this.disposed)throw new Error('三维渲染器已释放');
    if(this.ready)return;
    if(this.lost)throw new Error('WebGL 上下文已丢失，请重新创建渲染器');
    try {
      const gl=this.gl;
      this.starProgram=this.createProgram(SPACE_STAR_VERT,SPACE_STAR_FRAG);
      this.bodyProgram=this.createProgram(QUAD_VERT,SPACE_BODY_FRAG);
      this.quad=gl.createVertexArray()!;if(!this.quad)throw new Error('无法分配 quad VAO');
      this.placeholder=this.createPlaceholder();
      this.textureManager=new PlanetTextureManager(gl,{sources:OBSERVATION_MAP_SOURCES});
      const maxSize=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
      this.maxPointSize=maxSize?.[1]||64;
      const ids=new Set<string>();
      this.catalog=stars.filter(star=>{
        const valid=!!star.id&&!ids.has(star.id)&&finiteVector(star.positionAU)&&Number.isFinite(star.absoluteMagnitude)&&Number.isFinite(star.bv)&&Number.isFinite(star.distancePc)&&star.distancePc>0&&!!star.sourceId;
        if(valid)ids.add(star.id);return valid;
      });
      this.stats.catalogCount=this.catalog.length;this.stats.rejectedStars=stars.length-this.catalog.length;
      this.stellarPlanner=new StellarFramePlanner(this.catalog);
      this.starData=new Float32Array(this.catalog.length*6);
      this.stars=this.createPointMesh(this.starData);
      this.locatorData=new Float32Array(16*6);this.locators=this.createPointMesh(this.locatorData);
      // The same survey/coordinate implementation as the observer, but only an
      // inertial camera matrix: no Earth horizontal transform and no refraction.
      this.hips=new HipsRenderer(gl,{url:MELLINGER,maxOrder:3,tileSize:512,format:'jpg',frame:'galactic',requireCompleteBase:true,maxRetries:2,
        maxCacheTiles:64,maxConcurrentLoads:3,maxQueuedLoads:32,maxVisibleTiles:96,maxMeshTiles:128});
      this.hips.init();this.ready=true;this.stats.status=this.catalog.length?`真实三维目录 ${this.catalog.length.toLocaleString()} 星`:'无可用距离星表；未生成替代恒星';
    }catch(error){this.dispose();throw error;}
  }
  render(snapshot:SpaceSnapshot,view:SpaceView,options:SpaceRenderOptions,now:number):void {
    if(!this.ready||this.disposed||this.lost)return;
    const camera=view.camera;
    if(!validCamera(camera)){this.renderedStellarFrames=NO_STELLAR_FRAMES;this.stats.resolvedStars=0;this.stats.status='相机坐标无效（拒绝上传非有限坐标）';return;}
    const gl=this.gl;this.resize();this.updateMatrices(camera);this.lastCinematic=options.cinematic;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clearDepth(1);gl.clearColor(.0001,.00015,.0003,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    this.stats.backgroundWeight=options.photographicBackground?photographicBackgroundWeight(camera.positionAU):0;
    if(this.stats.backgroundWeight>.0001){
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
      this.hips.setOpacity(this.stats.backgroundWeight*(options.cinematic?.22:.12));
      this.hips.render(this.viewMatrix,this.projectionMatrix,camera.fovDeg*RAD,[this.canvas.width,this.canvas.height]);
    }
    let stellar=this.stellarFrames(camera,view.selectedId);
    // Lazy, texture-free shader: an Earth-neighborhood frame allocates no extra
    // GPU objects. Compilation failure keeps every affected old point visible.
    if(stellar.length&&!this.stellarProgram){
      try{this.stellarProgram=this.createProgram(QUAD_VERT,STELLAR_SURFACE_FRAG);}
      catch{this.stellarFailed=true;stellar=[];}
    }
    const suppressed=new Set(stellar.flatMap(f=>f.pointIds));
    this.updateStars(camera,suppressed);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(true);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    this.drawPoints(this.stars,camera,options.cinematic,false);
    const sun=snapshot.bodies.find(b=>b.id.toLowerCase()==='sun')?.positionAU??[0,0,0] as Vec3;
    const visible=snapshot.bodies.map(body=>bodyFrame(body,sun,camera,this.width,this.height,options.cinematic)).filter((f):f is BodyFrame=>!!f);
    const resolved=visible.filter(f=>f.radiusCssPixels*2>=RESOLVED_DIAMETER);
    const tiny=visible.filter(f=>f.radiusCssPixels*2<RESOLVED_DIAMETER);
    // A finite bounded buffer, resized only if the caller supplies more bodies.
    if(tiny.length*6>this.locatorData.length){this.locatorData=new Float32Array(tiny.length*6);gl.bindBuffer(gl.ARRAY_BUFFER,this.locators.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.locatorData,gl.DYNAMIC_DRAW);}
    let pointCount=0;
    for(const frame of tiny){
      const id=frame.body.id.toLowerCase();
      this.locatorData.set([...frame.direction,2,id==='mars'?1.3:.5,logarithmicDepth(frame.distanceAU)],pointCount++*6);
    }
    this.locators.count=pointCount;
    if(pointCount){gl.bindBuffer(gl.ARRAY_BUFFER,this.locators.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.locatorData.subarray(0,pointCount*6));this.drawPoints(this.locators,camera,options.cinematic,true);}
    const demands:PlanetTextureDemand[]=resolved.flatMap(f=>{
      const demand={id:f.body.textureId.toLowerCase(),devicePixelDiameter:f.radiusCssPixels*2*this.dpr,screenPosition:f.centerNdc};
      return f.body.id.toLowerCase()==='saturn'?[demand,{...demand,id:'saturn-ring',devicePixelDiameter:demand.devicePixelDiameter*SATURN_RING_OUTER}]:[demand];
    });
    const focus=resolved.reduce<BodyFrame|undefined>((a,b)=>!a||b.radiusCssPixels*(b.body.id.toLowerCase()==='saturn'?SATURN_RING_OUTER:1)>a.radiusCssPixels*(a.body.id.toLowerCase()==='saturn'?SATURN_RING_OUTER:1)?b:a,undefined);
    // Once per frame, same monotonic clock as navigation. HD stability is measured
    // in observer-to-body image geometry, never by comparing heliocentric AU values.
    this.textureManager.update(textureCamera(focus,camera),demands,now);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(true);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
    const surfaces:Array<BodyFrame|StellarFrame>=[...resolved,...stellar];
    surfaces.sort((a,b)=>b.distanceAU-a.distanceAU);
    for(const frame of surfaces){if('model' in frame)this.drawStellar(frame,camera,options.cinematic);else this.drawBody(frame,camera,options.cinematic);}
    this.renderedStellarFrames=stellar;
    gl.bindVertexArray(null);gl.activeTexture(gl.TEXTURE0);gl.depthMask(true);gl.disable(gl.BLEND);
    this.stats.resolvedBodies=resolved.length;this.stats.locatorBodies=pointCount;this.stats.bodiesDrawn=resolved.length+pointCount;this.stats.drawnStars=this.stars.count;this.stats.resolvedStars=stellar.length;
    this.updateStats(now,options);
  }
  project(positionAU:Vec3,camera:SpaceCamera):SpaceProjection {this.dimensions();return projectSpace(positionAU,camera,this.width,this.height);}
  /** Array reference of the last actually rendered stellar surfaces (transition included). */
  getStellarFrames():readonly StellarFrame[] {return this.disposed||this.lost?NO_STELLAR_FRAMES:this.renderedStellarFrames;}
  /** Same bounded, selected-priority geometry used by render and surface picking. */
  stellarFrames(camera:SpaceCamera,selectedId:string|null):readonly StellarFrame[] {
    this.dimensions();return this.disposed||this.lost||this.stellarFailed?[]:this.stellarPlanner?.plan(camera,this.width,this.height,selectedId)??[];
  }
  pick(x:number,y:number,snapshot:SpaceSnapshot,view:SpaceView):string|null {
    this.dimensions();const camera=view.camera;
    if(!validCamera(camera)||!Number.isFinite(x+y)||x<0||y<0||x>this.width||y>this.height)return null;
    const sun=snapshot.bodies.find(b=>b.id.toLowerCase()==='sun')?.positionAU??[0,0,0] as Vec3;
    let hit:{id:string;distance:number;score:number}|null=null;
    for(const body of snapshot.bodies){
      const f=bodyFrame(body,sun,camera,this.width,this.height,false);if(!f)continue;
      const d=bodyHitDistance(f,x,y,this.width,this.height,camera);
      if(f.radiusCssPixels*2>=RESOLVED_DIAMETER){if(d!==null&&(!hit||d<hit.distance))hit={id:body.id,distance:d,score:0};}
      else {
        const p=projectSpace(body.positionAU,camera,this.width,this.height),score=Math.hypot(x-p.x,y-p.y);
        if(p.visible&&score<=25&&(!hit||f.distanceAU<hit.distance))hit={id:body.id,distance:f.distanceAU,score};
      }
    }
    const stellar=this.stellarFrames(camera,view.selectedId),suppressed=new Set(stellar.flatMap(f=>f.pointIds));
    for(const f of stellar){
      const d=bodyHitDistance(f,x,y,this.width,this.height,camera);
      if(d!==null&&(!hit||d<hit.distance||d===hit.distance&&f.star.id===view.selectedId))hit={id:f.star.id,distance:d,score:0};
    }
    let starHit:{id:string;distance:number;score:number}|null=null;
    for(const star of this.catalog){
      if(suppressed.has(star.id))continue;
      const p=projectSpace(star.positionAU,camera,this.width,this.height);
      if(!p.visible||starMagnitude(star,p.distanceAU)>(this.lastCinematic?8.7:6.6)+.15)continue;
      const score=Math.hypot(x-p.x,y-p.y);
      if(score<=10&&(!hit||p.distanceAU<hit.distance)&&(!starHit||score<starHit.score||score===starHit.score&&(star.id===view.selectedId||starHit.id!==view.selectedId&&star.id.localeCompare(starHit.id)<0)))starHit={id:star.id,distance:p.distanceAU,score};
    }
    return starHit?.id??hit?.id??null;
  }
  getStats():SpaceRenderStats {return {...this.stats,textures:this.textureManager?.getStats()};}
  dispose():void {
    if(this.disposed)return;this.disposed=true;this.ready=false;
    this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    this.textureManager?.dispose();this.hips?.dispose();this.stellarPlanner?.dispose();this.renderedStellarFrames=NO_STELLAR_FRAMES;
    const gl=this.gl;
    for(const p of this.programs)gl.deleteProgram(p.program);this.programs=[];
    for(const mesh of [this.stars,this.locators])if(mesh){gl.deleteBuffer(mesh.buffer);gl.deleteVertexArray(mesh.vao);}
    if(this.quad)gl.deleteVertexArray(this.quad);if(this.placeholder)gl.deleteTexture(this.placeholder);
    this.catalog=[];this.starData=new Float32Array(0);this.locatorData=new Float32Array(0);this.stats.status='空间渲染器已释放';
  }
  private dimensions(){this.width=Math.max(1,this.canvas.clientWidth||this.canvas.width||1);this.height=Math.max(1,this.canvas.clientHeight||this.canvas.height||1);}
  private resize(){this.dimensions();this.dpr=clamp(globalThis.devicePixelRatio||1,1,2);const width=Math.round(this.width*this.dpr),height=Math.round(this.height*this.dpr);if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}}
  private updateMatrices(camera:SpaceCamera){
    const {right:r,up:u,forward:f}=spaceCameraBasis(camera);
    this.viewMatrix.set([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,0,0,0,1]);
    const cot=1/Math.tan(camera.fovDeg*RAD/2),near=.01,far=10;
    this.projectionMatrix.set([cot*this.height/this.width,0,0,0,0,cot,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  }
  private updateStars(camera:SpaceCamera,suppressed:ReadonlySet<string>){
    const suppression=Array.from(suppressed).sort().join('/');
    if(this.previousPosition?.every((v,i)=>v===camera.positionAU[i])&&suppression===this.previousSuppression)return;
    let count=0;
    for(const star of this.catalog){
      if(suppressed.has(star.id))continue;
      const relative=relativePosition(star.positionAU,camera.positionAU);if(!relative)continue;
      const magnitude=starMagnitude(star,relative.distanceAU);
      if(!Number.isFinite(magnitude))continue;
      const offset=count++*6;
      this.starData[offset]=relative.direction[0];this.starData[offset+1]=relative.direction[1];this.starData[offset+2]=relative.direction[2];
      this.starData[offset+3]=clamp(magnitude,-30,40);this.starData[offset+4]=clamp(star.bv,-.4,2);this.starData[offset+5]=logarithmicDepth(relative.distanceAU);
    }
    this.stars.count=count;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.stars.buffer);
    if(count)this.gl.bufferSubData(this.gl.ARRAY_BUFFER,0,this.starData.subarray(0,count*6));
    this.previousPosition=[...camera.positionAU];this.previousSuppression=suppression;
  }
  private drawPoints(mesh:PointMesh,camera:SpaceCamera,cinematic:boolean,locator:boolean){
    if(!mesh.count)return;const gl=this.gl,p=this.starProgram;gl.useProgram(p.program);const b=spaceCameraBasis(camera);
    this.vec(p,'u_right',b.right);this.vec(p,'u_up',b.up);this.vec(p,'u_forward',b.forward);
    const tan=Math.tan(camera.fovDeg*RAD/2);gl.uniform2f(this.loc(p,'u_tanFov'),tan*this.width/this.height,tan);
    this.scalar(p,'u_limit',cinematic?8.7:6.6);this.scalar(p,'u_exposure',cinematic?120:45);this.scalar(p,'u_dpr',this.dpr);this.scalar(p,'u_maxPointSize',this.maxPointSize);this.scalar(p,'u_locator',+locator);
    gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.POINTS,0,mesh.count);
  }
  private drawBody(f:BodyFrame,camera:SpaceCamera,cinematic:boolean){
    const gl=this.gl,p=this.bodyProgram,b=f.body,id=b.id.toLowerCase();gl.useProgram(p.program);
    gl.uniform4f(this.loc(p,'u_rect'),...f.rect);gl.uniform2f(this.loc(p,'u_centerNdc'),...f.centerNdc);
    const tan=Math.tan(camera.fovDeg*RAD/2);gl.uniform2f(this.loc(p,'u_tanFov'),tan*this.width/this.height,tan);
    this.vec(p,'u_bodyRight',f.right);this.vec(p,'u_bodyUp',f.up);this.vec(p,'u_bodyForward',f.forward);this.scalar(p,'u_radius',f.radius);this.vec(p,'u_light',f.light);
    this.vec(p,'u_axisNorth',b.axisNorth);this.vec(p,'u_axisPrime',b.axisPrime);this.vec(p,'u_axisEast',b.axisEast);
    const texture=this.textureManager.get(b.textureId.toLowerCase()),ring=id==='saturn'?this.textureManager.get('saturn-ring'):undefined;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture?.texture??this.placeholder);gl.uniform1i(this.loc(p,'u_texture'),0);this.scalar(p,'u_hasTexture',+(texture?.ready??false));
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,ring?.texture??this.placeholder);gl.uniform1i(this.loc(p,'u_ringTexture'),1);this.scalar(p,'u_hasRing',id==='saturn'?(ring?.ready?2:1):0);
    gl.uniform2f(this.loc(p,'u_ringRadii'),SATURN_RING_INNER,SATURN_RING_OUTER);gl.activeTexture(gl.TEXTURE0);
    this.vec(p,'u_color',this.hexColor(b.color));this.scalar(p,'u_sun',+(id==='sun'));this.scalar(p,'u_moon',+(id==='moon'));this.scalar(p,'u_earth',+(id==='earth'));this.scalar(p,'u_mars',+(id==='mars'));this.scalar(p,'u_logDistance',f.logDistance);this.scalar(p,'u_cinematic',+cinematic);
    gl.bindVertexArray(this.quad);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  private drawStellar(f:StellarFrame,camera:SpaceCamera,cinematic:boolean){
    const gl=this.gl,p=this.stellarProgram!,m=f.model;gl.useProgram(p.program);
    gl.uniform4f(this.loc(p,'u_rect'),...f.rect);gl.uniform2f(this.loc(p,'u_centerNdc'),...f.centerNdc);
    const tan=Math.tan(camera.fovDeg*RAD/2);gl.uniform2f(this.loc(p,'u_tanFov'),tan*this.width/this.height,tan);
    this.scalar(p,'u_radius',f.radius);
    this.vec(p,'u_color',m.color);this.scalar(p,'u_logDistance',f.logDistance);
    const diameter=f.radiusCssPixels*2,t=clamp((diameter-STELLAR_RESOLVED_DIAMETER)/(STELLAR_SURFACE_DIAMETER-STELLAR_RESOLVED_DIAMETER),0,1);
    this.scalar(p,'u_diameter',diameter);this.scalar(p,'u_surfaceMix',t*t*(3-2*t));
    // Only the unresolved transition reproduces the old display PSF. Resolved
    // smooth emission does not inherit its huge nearby-star exposure/saturation.
    const magnitude=clamp(starMagnitude(f.star,f.distanceAU),-30,40),limit=cinematic?8.7:6.6;
    const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
    this.scalar(p,'u_pointEnergy',10**(-.4*magnitude)*(cinematic?120:45)*(1-smooth(limit-.45,limit+.15,magnitude)));
    const bv=clamp(f.star.bv,-.4,2),temperature=4600*(1/(.92*bv+1.7)+1/(.92*bv+.62));
    const color:Vec3=temperature<6500?[1,.78+.22*smooth(2800,6500,temperature),.58+.42*smooth(2800,6500,temperature)]:
      [1-.27*smooth(6500,24000,temperature),1-.16*smooth(6500,24000,temperature),1];
    this.vec(p,'u_pointColor',color.map(x=>.3+.7*x) as Vec3);
    gl.bindVertexArray(this.quad);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  private createProgram(vertex:string,fragment:string):Program {
    const gl=this.gl,shaders:WebGLShader[]=[];let program:WebGLProgram|null=null;
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type);if(!shader)throw new Error('GLSL shader allocation failed');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(`空间 GLSL 编译失败：${gl.getShaderInfoLog(shader)}`);}
      program=gl.createProgram();if(!program)throw new Error('GL program allocation failed');for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`空间 GLSL 链接失败：${gl.getProgramInfoLog(program)}`);
      const result={program,uniforms:new Map<string,WebGLUniformLocation|null>()};this.programs.push(result);return result;
    }catch(error){if(program)gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  private loc(p:Program,name:string){if(!p.uniforms.has(name))p.uniforms.set(name,this.gl.getUniformLocation(p.program,name));return p.uniforms.get(name)!;}
  private scalar(p:Program,name:string,value:number){this.gl.uniform1f(this.loc(p,name),value);}
  private vec(p:Program,name:string,value:Vec3){this.gl.uniform3f(this.loc(p,name),...value);}
  private createPointMesh(data:Float32Array):PointMesh {
    const gl=this.gl,vao=gl.createVertexArray(),buffer=gl.createBuffer();if(!vao||!buffer){if(vao)gl.deleteVertexArray(vao);if(buffer)gl.deleteBuffer(buffer);throw new Error('Point mesh allocation failed');}
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);gl.bindVertexArray(null);
    return {vao,buffer,count:0};
  }
  private createPlaceholder():WebGLTexture {
    const gl=this.gl,t=gl.createTexture();if(!t)throw new Error('Texture allocation failed');gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([200,200,200,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;
  }
  private hexColor(color:string):Vec3 {const m=/^#([0-9a-f]{6})$/i.exec(color);if(!m)return [.85,.85,.83];const n=parseInt(m[1],16);return [(n>>16)/255,((n>>8)&255)/255,(n&255)/255];}
  private updateStats(now:number,options:SpaceRenderOptions){
    this.frameCount++;if(Number.isFinite(now)&&now-this.fpsAt>=500){this.stats.fps=this.frameCount*1000/(now-this.fpsAt);this.frameCount=0;this.fpsAt=now;}
    const hips=this.hips.getStats();this.stats.hipsTiles=hips.loaded;this.stats.hipsLoading=hips.loading;
    const messages:string[]=[];
    if(!this.catalog.length)messages.push('无可用距离星表；未生成替代恒星');
    if(this.stats.rejectedStars)messages.push(`跳过无效距离星 ${this.stats.rejectedStars}`);
    if(this.stellarFailed)messages.push('恒星尺寸示意不可用，保留目录光点');
    if(options.photographicBackground&&this.stats.backgroundWeight===0)messages.push('已远离太阳系：二维银河照片层已关闭');
    else if(options.photographicBackground){if(hips.baseFailed)messages.push('银河底图未完整加载，保留纯星空');else if(!hips.baseReady)messages.push(`银河底图准备 ${hips.baseLoaded}/12`);else if(hips.detailFailed)messages.push('银河细节失败，保留完整底图');}
    const textures=this.textureManager.getStats();if(textures.failed)messages.push(`贴图失败 ${textures.failed}（保留已就绪图或真实光照纯色）`);
    this.stats.status=messages.join('；')||`真实距离目录 ${this.catalog.length.toLocaleString()} 星 · ${this.stats.bodiesDrawn} 个太阳系目标在画面内`;
  }
}
