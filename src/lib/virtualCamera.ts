/**
 * Creates a synthetic high-resolution CCTV surveillance canvas stream
 * with realistic camera HUD, motion tracker, timestamp, and instant frame snapshotting.
 */

export type CameraPreset = 'LIVING ROOM [CAM-01]' | 'FRONT DOOR [CAM-02]' | 'GARAGE & DRIVEWAY [CAM-03]' | 'NURSERY [CAM-04]';

export function createVirtualCCTVStream(label: string = 'LIVING ROOM [CAM-01]'): {
  stream: MediaStream;
  getFrame: () => string | null;
  canvas: HTMLCanvasElement;
  stop: () => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  let animationFrameId: number;
  let frameCount = 0;

  const draw = () => {
    if (!ctx) return;
    frameCount++;

    // 1. Tactical Surveillance Dark Background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (label.includes('FRONT DOOR')) {
      gradient.addColorStop(0, '#020617');
      gradient.addColorStop(0.6, '#0f172a');
      gradient.addColorStop(1, '#020617');
    } else if (label.includes('GARAGE')) {
      gradient.addColorStop(0, '#090d16');
      gradient.addColorStop(0.5, '#1e293b');
      gradient.addColorStop(1, '#090d16');
    } else {
      gradient.addColorStop(0, '#0b1329');
      gradient.addColorStop(0.5, '#111e38');
      gradient.addColorStop(1, '#080e1e');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Perspective & Room Elements
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1.5;

    // Floor lines
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * 0.72);
    ctx.lineTo(canvas.width, canvas.height * 0.72);
    ctx.moveTo(canvas.width * 0.15, canvas.height * 0.72);
    ctx.lineTo(0, canvas.height);
    ctx.moveTo(canvas.width * 0.85, canvas.height * 0.72);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.stroke();

    if (label.includes('FRONT DOOR')) {
      // Porch Doorway
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.strokeRect(canvas.width * 0.35, canvas.height * 0.2, 190, 250);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(canvas.width * 0.35, canvas.height * 0.2, 190, 250);

      // Outdoor garden light
      ctx.fillStyle = 'rgba(234, 179, 8, 0.2)';
      ctx.beginPath();
      ctx.arc(canvas.width * 0.3, canvas.height * 0.3, 30, 0, Math.PI * 2);
      ctx.fill();
    } else if (label.includes('GARAGE')) {
      // Garage shutter lines
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
      for (let y = canvas.height * 0.2; y < canvas.height * 0.7; y += 20) {
        ctx.beginPath();
        ctx.moveTo(canvas.width * 0.1, y);
        ctx.lineTo(canvas.width * 0.9, y);
        ctx.stroke();
      }
    } else {
      // Living Room Sofa & Window
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(canvas.width * 0.65, canvas.height * 0.15, 160, 180);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.strokeRect(canvas.width * 0.65, canvas.height * 0.15, 160, 180);

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(canvas.width * 0.12, canvas.height * 0.54, 230, 95, [8, 8, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.stroke();
    }

    // 3. Motion Target Simulation (Tracking bounding box)
    const targetX = canvas.width * 0.5 + Math.sin(frameCount * 0.025) * 140;
    const targetY = canvas.height * 0.68 + Math.cos(frameCount * 0.015) * 12;
    const boxW = 40;
    const boxH = 40;

    // Tactical Target Reticle
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    // Corner brackets
    const cSize = 8;
    // Top Left
    ctx.beginPath();
    ctx.moveTo(targetX - boxW / 2, targetY - boxH / 2 + cSize);
    ctx.lineTo(targetX - boxW / 2, targetY - boxH / 2);
    ctx.lineTo(targetX - boxW / 2 + cSize, targetY - boxH / 2);
    // Top Right
    ctx.moveTo(targetX + boxW / 2 - cSize, targetY - boxH / 2);
    ctx.lineTo(targetX + boxW / 2, targetY - boxH / 2);
    ctx.lineTo(targetX + boxW / 2, targetY - boxH / 2 + cSize);
    // Bottom Left
    ctx.moveTo(targetX - boxW / 2, targetY + boxH / 2 - cSize);
    ctx.lineTo(targetX - boxW / 2, targetY + boxH / 2);
    ctx.lineTo(targetX - boxW / 2 + cSize, targetY + boxH / 2);
    // Bottom Right
    ctx.moveTo(targetX + boxW / 2 - cSize, targetY + boxH / 2);
    ctx.lineTo(targetX + boxW / 2, targetY + boxH / 2);
    ctx.lineTo(targetX + boxW / 2, targetY + boxH / 2 - cSize);
    ctx.stroke();

    // Target label
    ctx.fillStyle = '#10b981';
    ctx.font = '10px monospace';
    ctx.fillText('TARGET_01', targetX - boxW / 2, targetY - boxH / 2 - 4);

    // Subtle motion dot
    ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
    ctx.beginPath();
    ctx.arc(targetX, targetY, 4, 0, Math.PI * 2);
    ctx.fill();

    // 4. CCTV Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillRect(0, y, canvas.width, 1.5);
    }

    // 5. Tactical Center Crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 15, canvas.height / 2);
    ctx.lineTo(canvas.width / 2 + 15, canvas.height / 2);
    ctx.moveTo(canvas.width / 2, canvas.height / 2 - 15);
    ctx.lineTo(canvas.width / 2, canvas.height / 2 + 15);
    ctx.stroke();

    // 6. Security HUD Header
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, 42);

    // Red Flashing REC
    if (Math.floor(frameCount / 25) % 2 === 0) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(22, 21, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('REC', 34, 25);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('REC', 34, 25);
    }

    // Camera Name
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(label, 80, 25);

    // Live Timestamp with milliseconds
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(Math.floor(now.getMilliseconds() / 100));
    const dateStr = now.toISOString().split('T')[0];
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.fillText(`${dateStr} ${timeStr}`, canvas.width - 190, 25);

    // 7. Security HUD Footer Bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '11px monospace';
    ctx.fillText('FPS: 30 • 1080P HD • AUDIO: SYNC • SYSTEM: JAT MAOMO TECH', 15, canvas.height - 10);

    // Signal strength meter dots
    ctx.fillStyle = '#10b981';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(canvas.width - 55 + i * 8, canvas.height - 18, 5, 8 + i * 2);
    }

    animationFrameId = requestAnimationFrame(draw);
  };

  draw();

  const stream: MediaStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : new MediaStream();

  const getFrame = (): string | null => {
    try {
      return canvas.toDataURL('image/jpeg', 0.55);
    } catch {
      return null;
    }
  };

  const stop = () => {
    cancelAnimationFrame(animationFrameId);
    stream.getTracks().forEach((t) => t.stop());
  };

  return { stream, getFrame, canvas, stop };
}
