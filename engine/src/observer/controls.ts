import type { CameraState } from './types';
import { clampFov } from './zoom';
export const MIN_DATE = Date.UTC(1900, 0, 1);
export const MAX_DATE = Date.UTC(2101, 0, 1) - 1;
export const SPEEDS = [-86400, -3600, -60, -1, 0, 1, 60, 3600, 86400];
export function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
export function wrapAzimuth(deg: number) { return ((deg % 360) + 360) % 360; }
export function angleDelta(target: number, current: number) { return ((target - current + 540) % 360) - 180; }
export function nextSpeed(speed: number, sign: number) { const i = SPEEDS.indexOf(speed); return SPEEDS[clamp((i < 0 ? 5 : i) + sign, 0, SPEEDS.length - 1)]; }
export function speedText(speed: number) { if (!speed) return '暂停'; const n = Math.abs(speed); return `${speed < 0 ? '−' : ''}${n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : n}×`; }
export class ObservationClock {
  timestamp = Date.now(); speed = 1; lastSpeed = 1; live = true;
  tick(dtSeconds: number) {
    if (this.live) this.timestamp = Date.now();
    else if (this.speed) {
      const wanted = this.timestamp + Math.max(0, dtSeconds) * 1000 * this.speed;
      this.timestamp = clamp(wanted, MIN_DATE, MAX_DATE);
      if (wanted !== this.timestamp) this.speed = 0;
    }
    return new Date(this.timestamp);
  }
  setDate(date: Date) {
    const t = date.getTime();
    if (!Number.isFinite(t) || t < MIN_DATE || t > MAX_DATE) throw new Error('日期必须在 1900–2100 年之间');
    this.timestamp = t; this.speed = 0; this.live = false;
  }
  setSpeed(speed: number) { this.live = false; this.speed = speed; if (speed) this.lastSpeed = speed; }
  togglePause() { this.setSpeed(this.speed ? 0 : this.lastSpeed || 1); }
  now() { this.timestamp = Date.now(); this.speed = 1; this.lastSpeed = 1; this.live = true; }
}
export class ViewController {
  camera: CameraState = { azimuthDeg: 180, altitudeDeg: 35, fovDeg: 70 };
  target: CameraState | null = null;
  velocityAz = 0; velocityAlt = 0;
  reducedMotion = false;
  dragging = false;
  update(dt: number) {
    dt = clamp(dt, 0, 0.1);
    if (this.target) {
      const blend = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
      this.camera.azimuthDeg = wrapAzimuth(this.camera.azimuthDeg + angleDelta(this.target.azimuthDeg, this.camera.azimuthDeg) * blend);
      this.camera.altitudeDeg += (this.target.altitudeDeg - this.camera.altitudeDeg) * blend;
      this.camera.fovDeg *= Math.exp(Math.log(this.target.fovDeg / this.camera.fovDeg) * blend);
      const tolerance = this.camera.fovDeg * 0.0001;
      if (Math.abs(angleDelta(this.target.azimuthDeg, this.camera.azimuthDeg)) < tolerance && Math.abs(this.camera.altitudeDeg - this.target.altitudeDeg) < tolerance && Math.abs(this.camera.fovDeg - this.target.fovDeg) < tolerance) {
        this.camera = { ...this.target }; this.target = null;
      }
    } else if (!this.dragging) {
      const damping = Math.exp(-8 * dt);
      const integral = (1 - damping) / 8;
      this.camera.azimuthDeg = wrapAzimuth(this.camera.azimuthDeg + this.velocityAz * integral);
      this.camera.altitudeDeg = clamp(this.camera.altitudeDeg + this.velocityAlt * integral, -90, 90);
      this.velocityAz *= damping; this.velocityAlt *= damping;
    }
  }
  move(dx: number, dy: number, height: number, dt: number) {
    this.target = null;
    const scale = this.camera.fovDeg / Math.max(1, height);
    // Inverse-cos restores local horizontal sensitivity for a narrow field, but
    // azimuth is singular at the pole. Bound it by the angular half-field: a
    // near-pole pixel may rotate the field slightly, never whip it around.
    const localScale = Math.max(Math.cos(this.camera.altitudeDeg*Math.PI/180),Math.sin(this.camera.fovDeg*Math.PI/360));
    const da = -dx * scale / localScale, dh = dy * scale;
    this.camera.azimuthDeg = wrapAzimuth(this.camera.azimuthDeg + da);
    this.camera.altitudeDeg = clamp(this.camera.altitudeDeg + dh, -90, 90);
    this.velocityAz = clamp(da / Math.max(dt, 0.016), -90, 90);
    this.velocityAlt = clamp(dh / Math.max(dt, 0.016), -90, 90);
  }
  stop() { this.target = null; this.velocityAz = this.velocityAlt = 0; }
  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.camera.fovDeg = clampFov(this.camera.fovDeg * factor);
    if (this.target) this.target.fovDeg = this.camera.fovDeg;
  }
  /** Carry a moving target's delta through a slew, then lock exactly. Smoothing
   * the ephemeris itself causes multi-arcsecond drift at planetary magnification. */
  follow(az:number,alt:number) {
    az=wrapAzimuth(az);alt=clamp(alt,-90,90);
    if(this.target) {
      this.camera.azimuthDeg=wrapAzimuth(this.camera.azimuthDeg+angleDelta(az,this.target.azimuthDeg));
      this.camera.altitudeDeg=clamp(this.camera.altitudeDeg+alt-this.target.altitudeDeg,-90,90);
      this.target.azimuthDeg=az;this.target.altitudeDeg=alt;
    } else { this.camera.azimuthDeg=az;this.camera.altitudeDeg=alt; }
    this.velocityAz=this.velocityAlt=0;
  }
  goTo(az: number, alt: number, fov = this.camera.fovDeg) { this.stop(); this.target = { azimuthDeg: wrapAzimuth(az), altitudeDeg: clamp(alt, -90, 90), fovDeg: clampFov(fov) }; }
}
export const STAR_NAMES: Record<string, string> = {
  Sirius:'天狼星',Canopus:'老人星',Arcturus:'大角星',Vega:'织女星',Capella:'五车二',Rigel:'参宿七',Procyon:'南河三',Betelgeuse:'参宿四',Achernar:'水委一',Hadar:'马腹一',Altair:'牛郎星',Acrux:'十字架二',Aldebaran:'毕宿五',Spica:'角宿一',Antares:'心宿二',Pollux:'北河三',Fomalhaut:'北落师门',Deneb:'天津四',Mimosa:'十字架三',Regulus:'轩辕十四',Adhara:'弧矢七',Castor:'北河二',Shaula:'尾宿八',Gacrux:'十字架一',Bellatrix:'参宿五',Elnath:'五车五',Alnair:'鹤一',Alnitak:'参宿一',Alioth:'玉衡',Dubhe:'天枢',Mirfak:'天船三',Wezen:'弧矢一',Sargas:'尾宿五',KausAustralis:'箕宿三',Avior:'海石一',Alkaid:'摇光',Menkalinan:'五车三',Atria:'三角形三',Alhena:'井宿三',Peacock:'孔雀十一',Polaris:'北极星',Alpheratz:'壁宿二',Hamal:'娄宿三',Diphda:'土司空',Nunki:'斗宿四',Mizar:'开阳',Merak:'天璇',Phecda:'天玑',Megrez:'天权',Alcor:'辅星',Algol:'大陵五','Rigil Kentaurus':'南门二',Denebola:'五帝座一',Albireo:'辇道增七',Sadr:'天津一',Almach:'天大将军一',Algedi:'牛宿二',Sadalsuud:'虚宿一',Markab:'室宿一',Scheat:'室宿二',Enif:'危宿三',Mintaka:'参宿三',Alnilam:'参宿二'
};
export const CONSTELLATION_NAMES: Record<string,string> = {And:'仙女座',Aql:'天鹰座',Aqr:'宝瓶座',Ari:'白羊座',Aur:'御夫座',Boo:'牧夫座',Cnc:'巨蟹座',CMa:'大犬座',CMi:'小犬座',Cap:'摩羯座',Cas:'仙后座',Cen:'半人马座',Cep:'仙王座',Cet:'鲸鱼座',Cyg:'天鹅座',Dra:'天龙座',Gem:'双子座',Her:'武仙座',Leo:'狮子座',Lib:'天秤座',Lyr:'天琴座',Oph:'蛇夫座',Ori:'猎户座',Peg:'飞马座',Per:'英仙座',Psc:'双鱼座',PsA:'南鱼座',Sgr:'人马座',Sco:'天蝎座',Tau:'金牛座',UMa:'大熊座',UMi:'小熊座',Vir:'室女座',Tri:'三角座',Del:'海豚座',Sge:'天箭座',CrB:'北冕座',CrA:'南冕座',Cru:'南十字座',Pup:'船尾座',Vel:'船帆座',Car:'船底座',Ser:'巨蛇座',Eri:'波江座',Lep:'天兔座'};
export const BODY_NAMES: Record<string,string> = {sun:'太阳',moon:'月亮',mercury:'水星',venus:'金星',mars:'火星',jupiter:'木星',saturn:'土星',uranus:'天王星',neptune:'海王星'};
export function compass(az: number) { return ['北','东北','东','东南','南','西南','西','西北'][Math.round(wrapAzimuth(az) / 45) % 8]; }
export function phaseName(phase: number) { const p=wrapAzimuth(phase);return p<10||p>350?'新月':p<80?'娥眉月':p<100?'上弦月':p<170?'盈凸月':p<190?'满月':p<260?'亏凸月':p<280?'下弦月':'残月'; }
