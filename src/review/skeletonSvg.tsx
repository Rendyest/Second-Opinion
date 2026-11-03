import type { PoseFrame } from '../contracts';
import { drawList } from '../components/VideoStage';

/**
 * Static skeleton SVG drawn from a pose_frame's joints only — no pixels, no
 * video. Used for queue thumbnails and the review player. Joints are 0..1,
 * so the viewBox is 0 0 100 100. Weak joints render dimmed and dashed, never
 * dropped; status is never colour alone (weak limbs also dash).
 */
export function SkeletonSvg({
  frame,
  dimBelowConf,
  label,
}: {
  frame: PoseFrame;
  dimBelowConf: number;
  label: string;
}) {
  const { joints, segments } = drawList(frame, dimBelowConf);
  const byName = new Map(joints.map((j) => [j.name, j]));
  const px = (x: number): number => Math.round(x * 1000) / 10;
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={label}>
      {segments.map((s) => {
        const a = byName.get(s.a)?.joint;
        const b = byName.get(s.b)?.joint;
        if (!a || !b) return null;
        return (
          <line
            key={`${s.a}-${s.b}`}
            x1={px(a.x)}
            y1={px(a.y)}
            x2={px(b.x)}
            y2={px(b.y)}
            stroke={s.highlight ? '#b36b00' : '#333'}
            strokeWidth={s.highlight ? 2.4 : 1.6}
            strokeDasharray={s.weak ? '2 1.4' : undefined}
            opacity={s.weak ? 0.45 : 1}
          />
        );
      })}
      {joints.map((j) => (
        <circle
          key={j.name}
          cx={px(j.joint.x)}
          cy={px(j.joint.y)}
          r={j.weak ? 1.6 : 2.2}
          fill={j.weak ? 'none' : '#333'}
          stroke="#333"
          strokeWidth={0.8}
          strokeDasharray={j.weak ? '1 0.8' : undefined}
          opacity={j.weak ? 0.45 : 1}
        />
      ))}
    </svg>
  );
}
