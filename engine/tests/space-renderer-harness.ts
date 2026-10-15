// Protocol recorder, NOT a GL implementation or pixel evidence. Native replay can
// consume captured shader strings and uniforms without rewriting application code.
export function recordingCanvas(width=960,height=640){
  let serial=0,program:any=null,vao:any=null,active=33984,depthWrite=true;
  const enabled=new Set<number>(),uniforms=new Map<any,Record<string,any>>(),sources=new Map<any,string>(),attached=new Map<any,any[]>();
  const bound=new Map<number,any>(),textures=new Map<number,any>(),textureSources=new Map<any,string>(),attributes=new Map<any,Record<string,any>>();
  const calls:{method:string;args:any[]}[]=[],draws:any[]=[],images:any[]=[],buffers=new Map<any,Float32Array>();
  const constants:Record<string,number>={VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,LINK_STATUS:35714,ALIASED_POINT_SIZE_RANGE:33901,MAX_TEXTURE_SIZE:3379,
    DEPTH_TEST:2929,CULL_FACE:2884,SCISSOR_TEST:3089,BLEND:3042,DEPTH_WRITEMASK:2930,CURRENT_PROGRAM:35725,VERTEX_ARRAY_BINDING:34229,ARRAY_BUFFER_BINDING:34964,ACTIVE_TEXTURE:34016,TEXTURE_BINDING_2D:32873,
    NO_ERROR:0,TEXTURE0:33984,TEXTURE1:33985,TEXTURE_2D:3553,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,POINTS:0,LINES:1,TRIANGLES:4,DYNAMIC_DRAW:35048,FLOAT:5126,LESS:513,ONE:1,SRC_ALPHA:770,ONE_MINUS_SRC_ALPHA:771};
  const gl:any=new Proxy({}, {get(_target,key:string){
    if(key in constants)return constants[key];if(key.toUpperCase()===key)return 1;
    if(key==='getParameter')return(p:number)=>p===33901?new Float32Array([1,64]):p===3379?8192:p===2930?depthWrite:p===35725?program:p===34229?vao:p===34964?bound.get(34962)??null:p===34016?active:p===32873?textures.get(active)??null:null;
    if(key==='getShaderParameter'||key==='getProgramParameter')return()=>true;
    if(key==='getShaderInfoLog'||key==='getProgramInfoLog')return()=>'';
    if(key==='isContextLost')return()=>false;if(key==='getError')return()=>0;
    if(key==='getAttribLocation')return(_p:any,name:string)=>name==='a_uv'?1:0;
    if(key==='getUniformLocation')return(p:any,name:string)=>({program:p,name});
    if(key==='isEnabled')return(p:number)=>enabled.has(p);
    if(key.startsWith('create'))return()=>({kind:key,id:++serial});
    return(...args:any[])=>{
      calls.push({method:key,args});
      if(key==='shaderSource')sources.set(args[0],args[1]);
      else if(key==='attachShader'){if(!attached.has(args[0]))attached.set(args[0],[]);attached.get(args[0])!.push(args[1]);}
      else if(key==='useProgram')program=args[0];
      else if(key==='bindVertexArray')vao=args[0];
      else if(key==='bindBuffer')bound.set(args[0],args[1]);
      else if(key==='bufferData'&&ArrayBuffer.isView(args[1]))buffers.set(bound.get(args[0]),new Float32Array(args[1] as Float32Array));
      else if(key==='bufferSubData')buffers.get(bound.get(args[0]))?.set(args[2],args[1]/4);
      else if(key==='vertexAttribPointer'){if(!attributes.has(vao))attributes.set(vao,{});attributes.get(vao)![args[0]]={args,buffer:bound.get(34962)};}
      else if(key==='texImage2D'&&args[5]?.src)textureSources.set(textures.get(active),args[5].src);
      else if(key==='activeTexture')active=args[0];else if(key==='bindTexture')textures.set(active,args[1]);
      else if(key==='depthMask')depthWrite=args[0];else if(key==='enable')enabled.add(args[0]);else if(key==='disable')enabled.delete(args[0]);
      else if(key.startsWith('uniform')){const loc=args[0];if(!loc)return;if(!uniforms.has(loc.program))uniforms.set(loc.program,{});const value=key.includes('Matrix')?Array.from(args[2]):args.slice(1);uniforms.get(loc.program)![loc.name]=value;}
      else if(key==='drawArrays'||key==='drawElements')draws.push({method:key,args,program:program?.id,uniforms:structuredClone(uniforms.get(program)||{}),shaders:(attached.get(program)||[]).map(s=>sources.get(s)),depth:enabled.has(constants.DEPTH_TEST),depthWrite,blend:enabled.has(constants.BLEND),textures:Object.fromEntries([...textures].map(([unit,t])=>[unit,textureSources.get(t)??null])),attributes:Object.fromEntries(Object.entries(attributes.get(vao)||{}).map(([key,a]:[string,any])=>[key,{args:a.args,data:Array.from(buffers.get(a.buffer)??[])}]))});
    };
  }});
  const listeners=new Map<string,Function>();
  const canvas:any={clientWidth:width,clientHeight:height,width,height,getContext:()=>gl,addEventListener:(type:string,fn:Function)=>listeners.set(type,fn),removeEventListener:(type:string)=>listeners.delete(type)};
  class FakeImage {
    onload:Function|null=null;onerror:Function|null=null;naturalWidth=2048;naturalHeight=1024;crossOrigin='';decoding='';private value='';
    constructor(){images.push(this);}
    set src(s:string){this.value=s;if(s.includes('ring_alpha'))this.naturalHeight=125;}
    get src(){return this.value;}
    decode(){return Promise.resolve();}
    load(){this.onload?.();}
  }
  return {canvas,gl,calls,draws,images,buffers,FakeImage,listeners};
}
