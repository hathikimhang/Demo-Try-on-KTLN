import type { WristEngineEstimate, WristEngineMode } from '../../models/wristEngine.types';
import type { LiveOrientation, V3, WristPose } from '../../models/wrist.types';
import { add, mul, project, rotate } from '../../services/geometry/wristGeometry';

/** Never draw current results over a grace image, newer video, or stale frame. */
export function matchesPocFrame(p: WristEngineEstimate | undefined, capturedAt: number, now: number, width: number, height: number, held: boolean, display?: { isInferenceImage: boolean; receivedAt: number; frameId?: number }) {
  return !!p && !held && p.timestamp === capturedAt && now >= capturedAt && now - capturedAt <= 1000 && p.width === width && p.height === height &&
    (!display || (display.isInferenceImage && display.frameId === p.frameId && display.receivedAt >= capturedAt && now >= display.receivedAt && now - display.receivedAt <= 500));
}

export function drawWristEngineDebug(ctx: CanvasRenderingContext2D, p: WristEngineEstimate, mode: WristEngineMode, v1: LiveOrientation | null, rendered: WristPose | null = null, telemetry: Record<string, unknown> | null = null) {
  const W = ctx.canvas.width, aspect = p.height / p.width;
  const image = (v: V3) => project(v, { focal: p.focal, aspect });
  const text = (label: string, x: number, y: number, color = '#fff') => {
    // Caller already mirrors the complete webcam composition. Counter-mirror text.
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.font = '15px monospace';
    ctx.fillStyle = '#101722e8'; ctx.fillRect(-2, -15, ctx.measureText(label).width + 4, 19);
    ctx.fillStyle = color; ctx.fillText(label, 0, 0); ctx.restore();
  };
  const mark = (point: { x: number; y: number } | null, label: string, color: string, radius = 6, labelY = -9) => {
    if (!point) return;
    const x = point.x * W, y = point.y * W;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
    text(label, x + 9, y + labelY, color);
  };
  const axis = (start: V3, direction: V3, label: string, color: string) => {
    const a = image(start), b = image(add(start, mul(direction, .08)));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x * W, a.y * W); ctx.lineTo(b.x * W, b.y * W); ctx.stroke();
    text(label, b.x * W, b.y * W, color);
  };
  ctx.save();
  mark(p.hand0, 'H0', '#fff', 3, -30);
  mark(p.rawAnchor, `A2R ${p.anchorState}`, '#00ffff', 6, 18);
  mark(p.filteredAnchor, 'A2F = raw (filter OFF)', '#66ff66', 10, 36);
  if (p.anchorEdges) {
    ctx.strokeStyle = '#00ffff'; ctx.beginPath(); ctx.moveTo(p.anchorEdges[0].x * W, p.anchorEdges[0].y * W); ctx.lineTo(p.anchorEdges[1].x * W, p.anchorEdges[1].y * W); ctx.stroke();
  }
  if (p.contourLine) {
    ctx.strokeStyle = '#00ffff'; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(p.contourLine[0].x * W, p.contourLine[0].y * W); ctx.lineTo(p.contourLine[1].x * W, p.contourLine[1].y * W); ctx.stroke(); ctx.setLineDash([]);
  }
  if (p.anchor && p.axis2D) {
    ctx.strokeStyle = '#ffdf00'; ctx.beginPath(); ctx.moveTo(p.anchor.x * W, p.anchor.y * W);
    ctx.lineTo((p.anchor.x + p.axis2D.x * .08) * W, (p.anchor.y + p.axis2D.y * .08) * W); ctx.stroke();
  }
  if (p.anchor) {
    // Virtual depth for drawing axes only. Not an observed 3D anchor or wear center.
    const start = { x: p.anchor.x - .5, y: p.anchor.y - aspect / 2, z: p.focal };
    if (p.orientation) for (const [d, label, color] of [
      [{ x: 1, y: 0, z: 0 }, 'X2', '#ff6666'], [{ x: 0, y: 1, z: 0 }, 'Y2', '#66ff66'], [{ x: 0, y: 0, z: 1 }, 'Z2', '#66aaff'],
    ] as const) axis(start, rotate(p.orientation, d), label, color);
    else if (p.axis3D) axis(start, p.axis3D, 'Pose Z; roll?', '#66aaff');
  }
  if (mode === 'compare' && v1) {
    mark(image(v1.wristAnchor), 'A1', '#ff99ff');
    if (v1.forearmAxis) axis(v1.wristAnchor, v1.forearmAxis, 'Z1', '#ff99ff');
  }
  if (v1?.pose) mark(image(v1.pose.center), 'W1 estimated', '#ffb347', 5, -48);
  if (rendered) mark(image(rendered.center), mode === 'v2' ? 'R2 continuity (V1 geometry)' : 'R1 rendered', '#ff6633', 8, -66);
  const lines = [
    `V2 ${p.engineVersion} #${p.frameId} t=${p.timestamp.toFixed(0)}`,
    `tracking=${p.trackingState} orientation=${p.orientationState}`,
    `${p.orientationSource} | ${p.reason}`,
    `2D ${p.axis2DSource}=${p.confidence2D.toFixed(2)} 3D=${p.confidence3D.toFixed(2)} depthAge=${p.depthAgeMs ?? '?'}ms`,
    `anchor: ${p.anchorReason}; V2 wear center: UNCONFIRMED`,
    'H0 white | A1 pink | A2R cyan | A2F green (no filter)',
    'Z1 pink | Z2 blue | W1 orange = V1 only',
    ...(mode === 'compare' ? [`V1 ${v1?.source ?? 'None'} conf=${(v1?.confidence ?? 0).toFixed(2)} depth=${v1?.depth ?? '?'} reason=${v1?.reason ?? '?'} anchor=${v1 ? 'available' : 'unavailable'}`] : []),
    ...(telemetry ? [
      `FPS camera=${Number(telemetry.cameraFPS).toFixed(1)} infer=${Number(telemetry.inferenceFPS).toFixed(1)} GL=${Number(telemetry.renderFPS).toFixed(1)}`,
      `latency=${Number(telemetry.inferenceLatencyMs).toFixed(0)}ms age=${Number(telemetry.poseAgeMs).toFixed(0)}ms drop=${telemetry.frameDropCount}`,
      `render sample #${telemetry.frameId} visible=${telemetry.braceletVisible} ${telemetry.visibilityChangeReason}`,
      `continuity=${telemetry.trackingState} conf=${Number(telemetry.confidence).toFixed(2)} resets=${telemetry.filterResetCount ?? '? (V1)'}`,
    ] : []),
    'OBSERVED = model evidence; NOT webcam accuracy PASS',
  ];
  const wrapped = lines.flatMap(line => {
    const count = Math.max(20, Math.floor((W - 24) / 9.1));
    return Array.from({ length: Math.ceil(line.length / count) }, (_, i) => line.slice(i * count, (i + 1) * count));
  });
  wrapped.forEach((line, i) => text(line, W - 12, ctx.canvas.height - 12 - (wrapped.length - 1 - i) * 20));
  ctx.restore();
}
