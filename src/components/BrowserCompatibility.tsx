"use client";

/**
 * BrowserCompatibility — displays a compact capability status panel.
 *
 * Uses the capability detection module. Detection runs on the client.
 * Does not request permissions, open pickers, write files, or make
 * network requests.
 */

import { useSyncExternalStore } from "react";
import {
  detectCapabilities,
  hasCoreCapabilities,
  CAPABILITY_LABELS,
  CAPABILITY_OPTIONAL,
  type CapabilitySnapshot,
} from "@/lib/capabilities";
import { Badge, Panel, PanelHeader } from "@/components/ui";

const emptySubscribe = () => () => {};
let cachedCapabilities: CapabilitySnapshot | null = null;
function getClientSnapshot(): CapabilitySnapshot {
  if (!cachedCapabilities) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}
function getServerSnapshot(): CapabilitySnapshot | null {
  return null;
}

type CapabilityKey = keyof Omit<CapabilitySnapshot, "isBrowser">;

const CAPABILITY_KEYS: CapabilityKey[] = [
  "fileSystemAccess",
  "webCodecs",
  "webWorkers",
  "webAudio",
  "indexedDb",
  "offscreenCanvas",
  "opfs",
  "webGpu",
];

function CapabilityRow({
  capKey,
  snapshot,
}: {
  capKey: CapabilityKey;
  snapshot: CapabilitySnapshot;
}) {
  const entry = snapshot[capKey];
  const optional = CAPABILITY_OPTIONAL[capKey];
  const label = CAPABILITY_LABELS[capKey];

  return (
    <li className="flex items-start gap-3 py-2 px-4 border-b border-cs-border-subtle last:border-0">
      {/* Status dot */}
      <span
        className={[
          "mt-0.5 w-2 h-2 rounded-full shrink-0",
          entry.available
            ? "bg-cs-success"
            : optional
              ? "bg-cs-warning"
              : "bg-cs-error",
        ].join(" ")}
        aria-hidden="true"
      />

      {/* Label + note */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-cs-text-primary">{label}</span>
          {optional && (
            <Badge variant="muted">optional</Badge>
          )}
        </div>
        {!entry.available && entry.note && (
          <p className="mt-0.5 text-xs text-cs-text-secondary leading-relaxed">{entry.note}</p>
        )}
      </div>

      {/* Status badge */}
      <span className="shrink-0">
        {entry.available ? (
          <Badge variant="success">Available</Badge>
        ) : optional ? (
          <Badge variant="warning">Unavailable</Badge>
        ) : (
          <Badge variant="error">Not supported</Badge>
        )}
      </span>
    </li>
  );
}

export function BrowserCompatibility() {
  const snapshot = useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot
  );

  if (!snapshot) {
    // SSR or pending — render placeholder
    return (
      <Panel>
        <PanelHeader title="Browser compatibility" />
        <div className="px-4 py-6 text-xs text-cs-text-tertiary">
          Checking browser capabilities…
        </div>
      </Panel>
    );
  }

  const allCore = hasCoreCapabilities(snapshot);

  return (
    <Panel>
      <PanelHeader
        title="Browser compatibility"
        description={
          allCore
            ? "All required capabilities are available."
            : "Some required capabilities are missing. Full editing may not be available."
        }
        actions={
          allCore ? (
            <Badge variant="success">Ready</Badge>
          ) : (
            <Badge variant="warning">Limited</Badge>
          )
        }
      />

      <ul role="list" aria-label="Browser capability list">
        {CAPABILITY_KEYS.map((key) => (
          <CapabilityRow key={key} capKey={key} snapshot={snapshot} />
        ))}
      </ul>

      <div className="px-4 py-3 border-t border-cs-border-subtle">
        <p className="text-xs text-cs-text-tertiary leading-relaxed">
          Content Studio currently targets Chrome and Edge on desktop for the best experience.
          Optional capabilities enhance performance but are not required for core editing.
        </p>
      </div>
    </Panel>
  );
}

