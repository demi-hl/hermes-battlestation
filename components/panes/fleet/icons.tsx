// Extra stroke icons for the Fleet surfaces. Same house style as
// components/shell/icons.tsx (24 viewBox, currentColor, round caps).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function base(props: P) {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export const ServerIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="7" rx="1.6" />
    <rect x="3" y="13" width="18" height="7" rx="1.6" />
    <path d="M6.5 7.5h.01M6.5 16.5h.01" />
  </svg>
);

export const LaptopIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="16" height="11" rx="1.6" />
    <path d="M2 20h20" />
  </svg>
);

export const BotIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="16" height="11" rx="2.5" />
    <path d="M12 4v4M8 13h.01M16 13h.01M9 16.5h6" />
  </svg>
);

export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
  </svg>
);

export const AdvanceIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 4v16l7-5 7 5V4" opacity="0" />
    <path d="m6 4 8 8-8 8M14 4l4 4-4 4" />
  </svg>
);

export const LayersIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

export const GitCommitIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M3 12h5.8M15.2 12H21" />
  </svg>
);
