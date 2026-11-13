/**
 * Content Studio application logo.
 * SVG-based so it scales cleanly at any size, has no external dependencies
 * and needs no image optimisation pipeline.
 */

import * as React from "react";

interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 24, className = "" }: AppLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Outer rounded rectangle — represents a video frame / monitor */}
      <rect
        x="1.5"
        y="3"
        width="21"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-cs-accent"
      />
      {/* Play triangle — centred inside the frame */}
      <path
        d="M9.5 8.5l5 3.5-5 3.5V8.5z"
        fill="currentColor"
        className="text-cs-accent"
        strokeLinejoin="round"
      />
      {/* Timeline bar below — represents the editing timeline */}
      <rect
        x="4"
        y="20"
        width="16"
        height="1.5"
        rx="0.75"
        fill="currentColor"
        className="text-cs-border-strong"
      />
      {/* Playhead on timeline */}
      <rect
        x="9"
        y="19.5"
        width="1.5"
        height="2.5"
        rx="0.5"
        fill="currentColor"
        className="text-cs-accent"
      />
    </svg>
  );
}

