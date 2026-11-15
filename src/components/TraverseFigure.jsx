/**
 * Illustration of the core idea: the straight line between two points
 * crosses hazards, the planned route goes around them.
 * Purely a drawing (not real terrain data).
 */
export default function TraverseFigure() {
  const craterRings = [118, 98, 78, 58, 38, 20]

  return (
    <figure className="traverse">
      <svg viewBox="0 0 720 440" role="img" aria-labelledby="traverse-title traverse-desc">
        <title id="traverse-title">A planned route compared with a straight line</title>
        <desc id="traverse-desc">
          A dashed straight line from the landing site to a sample site cuts across a crater. The
          planned route curves around the crater and past a patch of loose sand.
        </desc>

        <defs>
          <pattern id="sand" width="14" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 6 Q3.5 1 7 6 T14 6" fill="none" stroke="var(--rust)" strokeWidth="1.2" />
          </pattern>
        </defs>

        {/* Background contour lines */}
        <g fill="none" stroke="var(--line)" strokeWidth="1.2">
          <path d="M-10 70 C120 40 220 90 330 60 S560 20 730 60" />
          <path d="M-10 110 C110 85 200 120 300 96 S470 50 560 30" />
          <path d="M-10 410 C140 385 260 430 400 405 S620 420 730 380" />
          <path d="M470 450 C520 400 600 395 730 330" />
          <path d="M-10 250 C40 240 80 262 120 250 S160 200 150 150 S60 140 -10 160" />
        </g>

        {/* Crater: rings get tighter and warmer toward the steep wall */}
        <g transform="translate(318 232) rotate(-14)" fill="none">
          {craterRings.map((r, i) => (
            <ellipse
              key={r}
              rx={r}
              ry={r * 0.78}
              stroke={i > 1 ? 'var(--rust)' : 'var(--line)'}
              strokeWidth={i > 1 ? 1.5 : 1.2}
            />
          ))}
        </g>

        {/* Loose sand */}
        <path
          d="M512 262 C548 240 612 250 632 286 C650 320 612 352 566 348 C524 344 488 300 512 262 Z"
          fill="url(#sand)"
          stroke="var(--rust)"
          strokeWidth="1.2"
        />

        {/* Straight line */}
        <line
          x1="92"
          y1="356"
          x2="636"
          y2="92"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeDasharray="5 7"
        />

        {/* Planned route */}
        <path
          d="M92 356 C170 392 300 404 400 366 C478 336 446 232 508 176 C552 136 596 116 636 92"
          fill="none"
          stroke="var(--spice-light)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />

        {/* Landing site */}
        <circle cx="92" cy="356" r="11" fill="var(--bg)" stroke="var(--spice-light)" strokeWidth="2.5" />
        <circle cx="92" cy="356" r="3.5" fill="var(--spice-light)" />

        {/* Sample site */}
        <rect
          x="627"
          y="83"
          width="18"
          height="18"
          transform="rotate(45 636 92)"
          fill="var(--spice-light)"
        />

        <g className="traverse-labels">
          <text x="92" y="392" textAnchor="middle" className="place">Landing site</text>
          <text x="636" y="66" textAnchor="middle" className="place">Sample site</text>
          <text x="318" y="126" textAnchor="middle" className="terrain">crater wall</text>
          <text x="572" y="378" textAnchor="middle" className="terrain">loose sand</text>
          <text x="112" y="334" className="terrain" transform="rotate(-25.9 112 334)">straight line</text>
          <text x="296" y="424" className="route">planned route</text>
        </g>
      </svg>
      <figcaption>The shortest path is rarely the safest.</figcaption>
    </figure>
  )
}
