'use client';

import { useId } from 'react';

type AltrixsLogoProps = {
  /** dark = white/light text for dark backgrounds; light = navy text for light backgrounds */
  variant?: 'dark' | 'light';
  compact?: boolean;
  showSubtitle?: boolean;
  showMark?: boolean;
  width?: number;
  className?: string;
};

function Lettermark({ size, uid }: { size: number; uid: string }) {
  const left = `${uid}-left`;
  const right = `${uid}-right`;
  const leaf = `${uid}-leaf`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={left} x1="8" y1="34" x2="20" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7060D4" />
          <stop offset="1" stopColor="#3B2B9A" />
        </linearGradient>
        <linearGradient id={right} x1="16" y1="6" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C2BAF0" />
          <stop offset="0.45" stopColor="#7B6FD4" />
          <stop offset="1" stopColor="#4840A8" />
        </linearGradient>
        <linearGradient id={leaf} x1="16" y1="20" x2="24" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4840A8" />
          <stop offset="1" stopColor="#2B2088" />
        </linearGradient>
      </defs>
      {/* Left band of A */}
      <path
        d="M8 34 L18.5 6.5 C19 5.2 21 5.2 21.5 6.5 L24 14 L14.5 34 C13.9 35.4 12 35.4 11.4 34 L8 34Z"
        fill={`url(#${left})`}
      />
      {/* Right band of A */}
      <path
        d="M32 34 L21.5 6.5 C21 5.2 19 5.2 18.5 6.5 L16 14 L25.5 34 C26.1 35.4 28 35.4 28.6 34 L32 34Z"
        fill={`url(#${right})`}
      />
      {/* Crossbar */}
      <path d="M13.5 22.5 H26.5 V25.5 H13.5 Z" fill={`url(#${left})`} />
      {/* Leaf motifs in counter */}
      <path
        d="M17.2 16.2 C18.4 14.2 20.2 13.2 20.2 13.2 C20.2 13.2 20.6 15.4 19.4 17.4 C18.2 19.4 16.4 20.4 16.4 20.4 C16.4 20.4 16 18.2 17.2 16.2Z"
        fill={`url(#${leaf})`}
      />
      <path
        d="M22.8 16.2 C21.6 14.2 19.8 13.2 19.8 13.2 C19.8 13.2 19.4 15.4 20.6 17.4 C21.8 19.4 23.6 20.4 23.6 20.4 C23.6 20.4 24 18.2 22.8 16.2Z"
        fill={`url(#${leaf})`}
        opacity={0.9}
      />
    </svg>
  );
}

/**
 * Altrixs brand mark — SVG "A" lettermark + wordmark (dotless-i + purple tittle).
 */
export function AltrixsLogo({
  variant = 'dark',
  compact = false,
  showSubtitle = false,
  showMark = true,
  width = 180,
  className = '',
}: AltrixsLogoProps) {
  const uid = useId().replace(/:/g, '');
  // Spec: dark = white text on dark bg; light = navy text on light bg
  const onDarkBg = variant === 'dark';
  const textColor = onDarkBg ? '#FFFFFF' : '#1B1F3B';
  const dotColor = onDarkBg ? '#B0AAEE' : '#7B70D0';
  const taglineColor = onDarkBg ? '#9A96D8' : '#7068B8';

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`} style={{ maxWidth: width }}>
        {showMark ? <Lettermark size={30} uid={uid} /> : null}
        <div
          className="relative inline-block font-extrabold leading-none"
          style={{
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: 15,
            letterSpacing: '-0.4px',
            color: textColor,
          }}
        >
          <span>Altr</span>
          <span className="relative inline-block">
            ı
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 rounded-full"
              style={{ top: -1, width: 3.5, height: 3.5, background: dotColor }}
            />
          </span>
          <span>xs</span>
        </div>
      </div>
    );
  }

  const markSize = width * 0.42;
  const wordSize = width * 0.165;

  return (
    <div
      className={`inline-flex flex-col items-center gap-2 ${className}`}
      style={{ width, maxWidth: width }}
    >
      {showMark ? <Lettermark size={markSize} uid={uid} /> : null}
      <div className="min-w-0 text-center leading-none">
        <div
          className="relative inline-block font-extrabold"
          style={{
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: wordSize,
            letterSpacing: '-0.4px',
            color: textColor,
          }}
        >
          <span>Altr</span>
          <span className="relative inline-block">
            ı
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 rounded-full"
              style={{ top: -2, width: 5, height: 5, background: dotColor }}
            />
          </span>
          <span>xs</span>
        </div>
        {showSubtitle ? (
          <p
            className="mt-2 text-[11px] font-semibold uppercase"
            style={{ letterSpacing: '0.1em', color: taglineColor }}
          >
            — BETTER MINDS. BETTER CARE. TOGETHER. —
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default AltrixsLogo;
