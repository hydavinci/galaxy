export class TimeSystem {
  private date: Date;
  private speed = 1; // 1 = realtime, 0 = paused, >1 = fast forward, <0 = rewind
  private lastNonZeroSpeed = 1;
  private lastReal: number;

  constructor() {
    this.date = new Date();
    this.lastReal = Date.now();
  }

  update() {
    const now = Date.now();
    const dt = now - this.lastReal;
    this.lastReal = now;
    this.date = new Date(this.date.getTime() + dt * this.speed);
  }

  setSpeed(s: number) {
    this.speed = s;
    if (s !== 0) this.lastNonZeroSpeed = s;
  }
  getSpeed(): number { return this.speed; }
  isPaused(): boolean { return this.speed === 0; }

  togglePause() {
    if (this.speed === 0) this.setSpeed(this.lastNonZeroSpeed || 1);
    else this.speed = 0;
  }

  rewind() {
    const s = this.speed;
    if (s > 1) this.setSpeed(s / 2);
    else if (s === 1) this.setSpeed(0);
    else if (s === 0) this.setSpeed(-1);
    else this.setSpeed(s * 2);
  }

  fastForward() {
    const s = this.speed;
    if (s < -1) this.setSpeed(s / 2);
    else if (s === -1) this.setSpeed(0);
    else if (s === 0) this.setSpeed(1);
    else this.setSpeed(s * 2);
  }

  getDate(): Date { return this.date; }

  getJD(): number {
    return this.date.getTime() / 86400000 + 2440587.5;
  }

  getGMST(): number {
    const jd = this.getJD();
    const T = (jd - 2451545.0) / 36525.0;
    let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) +
      0.000387933 * T * T - T * T * T / 38710000.0;
    gmst = ((gmst % 360) + 360) % 360;
    return gmst;
  }

  getDateString(): string {
    return this.date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  getSpeedLabel(): string {
    if (this.speed === 0) return '⏸';
    if (this.speed === 1) return '1×';
    if (this.speed > 0) return `${this.speed}×`;
    return `${this.speed}×`;
  }
}
