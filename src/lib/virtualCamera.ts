/**
 * Creates a synthetic CCTV canvas stream for testing and fallback when hardware camera
 * permission is blocked or unavailable in iframe sandbox environments.
 */
export function createVirtualCCTVStream(label = 'LIVING ROOM [CAM-01]'): {
  stream: MediaStream;
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

    // 1. Dark ambient room background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(0.5, '#1e293b');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Room furniture outlines (Living room security view)
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.25)';
    ctx.lineWidth = 2;

    // Floor perspective grid lines
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * 0.7);
    ctx.lineTo(canvas.width, canvas.height * 0.7);
    ctx.moveTo(canvas.width * 0.2, canvas.height * 0.7);
    ctx.lineTo(0, canvas.height);
    ctx.moveTo(canvas.width * 0.8, canvas.height * 0.7);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.stroke();

    // Window frame with outdoor night glow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(canvas.width * 0.65, canvas.height * 0.15, 160, 180);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.strokeRect(canvas.width * 0.65, canvas.height * 0.15, 160, 180);

    // Living room sofa
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(canvas.width * 0.15, canvas.height * 0.55, 240, 90, [10, 10, 0, 0]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.stroke();

    // Subtle moving indicator (e.g. simulated pet or motion pulse)
    const motionX = canvas.width * 0.5 + Math.sin(frameCount * 0.03) * 120;
    const motionY = canvas.height * 0.72 + Math.cos(frameCount * 0.02) * 15;
    ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
    ctx.beginPath();
    ctx.arc(motionX, motionY, 6, 0, Math.PI * 2);
    ctx.fill();

    // Motion pulse ring
    const pulseRadius = 12 + (frameCount % 30);
    ctx.strokeStyle = `rgba(16, 185, 129, ${Math.max(0, 1 - pulseRadius / 42)})`;
    ctx.beginPath();
    ctx.arc(motionX, motionY, pulseRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 3. CCTV Scanlines effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillRect(0, y, canvas.width, 1.5);
    }

    // 4. CCTV HUD Overlays (REC indicator, timestamp, camera title)
    // Red REC circle (flashing)
    if (Math.floor(frameCount / 20) % 2 === 0) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(35, 30, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('REC', 48, 35);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('REC', 48, 35);
    }

    // Camera Label
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(label, 110, 35);

    // Live Timestamp
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(Math.floor(now.getMilliseconds() / 100));
    const dateStr = now.toISOString().split('T')[0];
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px monospace';
    ctx.fillText(`${dateStr} ${timeStr}`, canvas.width - 210, 35);

    // Bottom status bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, canvas.height - 35, canvas.width, 35);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '12px monospace';
    ctx.fillText('SIGNAL: 1080P/30FPS • MODE: TEST/SIMULATION • JAT MAOMO TECH', 20, canvas.height - 14);

    animationFrameId = requestAnimationFrame(draw);
  };

  draw();

  // Capture canvas stream at 25 fps
  // Support both standard captureStream and webkit
  const stream: MediaStream = (canvas as any).captureStream ? (canvas as any).captureStream(25) : new MediaStream();

  const stop = () => {
    cancelAnimationFrame(animationFrameId);
    stream.getTracks().forEach((t) => t.stop());
  };

  return { stream, stop };
}
