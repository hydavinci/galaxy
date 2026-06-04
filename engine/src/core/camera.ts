export class Camera {
  azimuth = 0;
  altitude = 0;
  fov = Math.PI / 3; // 60 degrees

  private velAz = 0;
  private velAlt = 0;
  private friction = 0.92;

  rotate(dAz: number, dAlt: number) {
    this.azimuth += dAz;
    this.altitude = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.altitude + dAlt));
    this.velAz = dAz;
    this.velAlt = dAlt;
  }

  /**
   * Zoom toward the point under the mouse.
   * Unprojects mouse to a 3D sky direction, changes FOV,
   * then rotates camera so that direction stays under the mouse.
   */
  zoom(delta: number, mouseX?: number, mouseY?: number, canvasW?: number, canvasH?: number) {
    const newFov = Math.max(0.1 * Math.PI / 180, Math.min(120 * Math.PI / 180, this.fov * (1 + delta * 0.001)));

    if (mouseX === undefined || canvasW === undefined) {
      this.fov = newFov;
      return;
    }

    const aspect = canvasW / canvasH!;
    const mx = (mouseX / canvasW - 0.5) * 2;
    const my = -(mouseY! / canvasH! - 0.5) * 2;

    // Unproject mouse to view-space ray (before zoom)
    const tanHalf = Math.tan(this.fov / 2);
    const rayX = mx * aspect * tanHalf;
    const rayY = my * tanHalf;
    const rayZ = -1; // looking down -Z in view space

    // Convert view-space ray to world-space direction
    const viewMat = this.getViewMatrix();
    // View matrix is orthonormal rotation, so inverse = transpose
    // world = transpose(view) * ray
    const wx = viewMat[0] * rayX + viewMat[1] * rayY + viewMat[2] * rayZ;
    const wy = viewMat[4] * rayX + viewMat[5] * rayY + viewMat[6] * rayZ;
    const wz = viewMat[8] * rayX + viewMat[9] * rayY + viewMat[10] * rayZ;

    // Normalize to get sky direction
    const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const skyX = wx / len, skyY = wy / len, skyZ = wz / len;

    // Sky direction in spherical coords
    const skyAlt = Math.asin(skyY);
    const skyAz = Math.atan2(skyZ, skyX);

    // Apply new FOV
    this.fov = newFov;

    // Now: where on screen would this sky point appear with the NEW fov but SAME camera?
    // Project sky direction back to view space
    const vx2 = viewMat[0] * skyX + viewMat[4] * skyY + viewMat[8] * skyZ;
    const vy2 = viewMat[1] * skyX + viewMat[5] * skyY + viewMat[9] * skyZ;
    const vz2 = viewMat[2] * skyX + viewMat[6] * skyY + viewMat[10] * skyZ;

    // Project to NDC with new FOV
    const newTanHalf = Math.tan(this.fov / 2);
    const newNdcX = vx2 / (-vz2) / aspect / newTanHalf;
    const newNdcY = vy2 / (-vz2) / newTanHalf;

    // The sky point moved from (mx, my) to (newNdcX, newNdcY) on screen
    // We need to rotate camera to bring it back to (mx, my)
    // Difference in NDC
    const dNdcX = mx - newNdcX;
    const dNdcY = my - newNdcY;

    // Convert NDC shift to angular shift (using new FOV)
    const dAngX = dNdcX * aspect * newTanHalf;
    const dAngY = dNdcY * newTanHalf;

    // Apply as camera rotation (same as drag)
    this.azimuth += dAngX;
    this.altitude += dAngY;
    this.altitude = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.altitude));
  }

  update() {
    if (Math.abs(this.velAz) > 0.0001 || Math.abs(this.velAlt) > 0.0001) {
      this.azimuth += this.velAz;
      this.altitude = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.altitude + this.velAlt));
      this.velAz *= this.friction;
      this.velAlt *= this.friction;
    }
  }

  stopInertia() {
    this.velAz = 0;
    this.velAlt = 0;
  }

  lookAt(ra: number, dec: number) {
    // Convert star coordinates to camera azimuth/altitude
    // Camera forward = (cosAlt*sinAz, -sinAlt, -cosAlt*cosAz)
    // Star direction = (cos(dec)*cos(ra), sin(dec), cos(dec)*sin(ra))
    this.azimuth = Math.atan2(Math.cos(ra), -Math.sin(ra));
    this.altitude = -dec;
    this.fov = Math.min(this.fov, 30 * Math.PI / 180);
    this.stopInertia();
  }

  getViewMatrix(): Float32Array {
    const cosAz = Math.cos(this.azimuth), sinAz = Math.sin(this.azimuth);
    const cosAlt = Math.cos(this.altitude), sinAlt = Math.sin(this.altitude);

    // Rotation: first around Y (azimuth), then around X (altitude)
    return new Float32Array([
      cosAz, sinAlt * sinAz, -cosAlt * sinAz, 0,
      0, cosAlt, sinAlt, 0,
      sinAz, -sinAlt * cosAz, cosAlt * cosAz, 0,
      0, 0, 0, 1
    ]);
  }

  getProjMatrix(aspect: number): Float32Array {
    const f = 1.0 / Math.tan(this.fov / 2);
    const near = 0.01, far = 10.0;
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ]);
  }
}
