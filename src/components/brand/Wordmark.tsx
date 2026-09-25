/**
 * NAVRIS logomark + wordmark.
 *
 * Built as live SVG rather than a generated raster: the mark has to inherit the
 * state colour, sit on projector-safe flat fills, and stay crisp at 4K. The
 * design follows the brief — a GNSS signal arc over an inertial ring, thin
 * precise line-art, single stroke weight, no gradients and no 3D.
 *
 * The optional "recovering" state gets a slow arc sweep, because that motion
 * reports something true about the system rather than decorating it.
 */

interface LogomarkProps {
  size?: number;
  color?: string;
  accent?: string;
  animate?: boolean;
  className?: string;
}

export function Logomark({
  size = 28,
  color = 'currentColor',
  accent = '#2DD4BF',
  animate = false,
  className = '',
}: LogomarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="NAVRIS"
    >
      {/* Inertial ring — the gyroscope reference. */}
      <circle cx="16" cy="16" r="10.5" stroke={color} strokeWidth="1" opacity="0.55" />
      <circle cx="16" cy="16" r="6" stroke={color} strokeWidth="0.75" opacity="0.3" />

      {/* Gyroscope gimbal axes. */}
      <line x1="5.5" y1="16" x2="26.5" y2="16" stroke={color} strokeWidth="0.75" opacity="0.35" />
      <line x1="16" y1="5.5" x2="16" y2="26.5" stroke={color} strokeWidth="0.75" opacity="0.35" />

      {/* The position fix — a single precise point. */}
      <circle cx="16" cy="16" r="1.9" fill={accent} />

      {/* GNSS signal arc, open at the top: the sky is above the ring. */}
      <path
        d="M9.4 12.6a9.4 9.4 0 0 1 13.2 0"
        stroke={accent}
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M12.1 9.4a6 6 0 0 1 7.8 0"
        stroke={accent}
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* Sweep arc: drawn only while the system is re-fusing. */}
      {animate && (
        <path
          d="M9.4 12.6a9.4 9.4 0 0 1 13.2 0"
          stroke={accent}
          strokeWidth="1.6"
          strokeLinecap="round"
          className="animate-trace-dash"
          style={{ strokeDasharray: '4 20' }}
        />
      )}
    </svg>
  );
}

export function Wordmark({
  accent = '#2DD4BF',
  animate = false,
  className = '',
}: {
  accent?: string;
  animate?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Logomark size={26} color="#8C9AB2" accent={accent} animate={animate} />
      <div className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[0.22em] text-ink">NAVRIS</span>
        <span className="mt-[3px] font-mono text-[8px] uppercase tracking-[0.18em] text-ink-dim">
          Navigation &amp; Inertial System
        </span>
      </div>
    </div>
  );
}
