import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: 36,
          background: '#0A0A0A',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 32 32" width="120" height="120">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10EFD8" />
              <stop offset="100%" stopColor="#0EA5E9" />
            </linearGradient>
          </defs>
          <path d="M18.5 3L8 18h6.5L13 29l11-15h-7z" fill="url(#g)" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
