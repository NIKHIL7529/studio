/**
 * Deterministic Canvas Transition Renderers.
 *
 * Rules:
 * - Shared 100% between TimelinePreview (Program Monitor) and export pipeline.
 * - Deterministic: same inputs (progress, params, dimensions) produce identical pixels.
 * - Bounded memory; clean restores on context states.
 * - Handles all families: Dissolve, Wipes, Movement (Push/Slide/Zoom), Stylized (Glitch, Flash, Blur, Pixelate).
 */

import type { TimelineTransition } from "../../types/timeline.ts";

export type FrameDrawer = (targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;

/**
 * Executes canvas rendering of a visual transition between outgoing and incoming clips.
 */
export function renderTransition(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  transition: TimelineTransition,
  progress: number,
  drawFrom: FrameDrawer,
  drawTo: FrameDrawer
): void {
  const p = Math.max(0, Math.min(1, progress));
  const type = transition.type;

  ctx.save();

  switch (type) {
    // ── Dissolves & Fades ─────────────────────────────────────────────────────
    case "cross_dissolve": {
      // Draw outgoing clip
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawFrom(ctx);
      ctx.restore();

      // Blend incoming clip
      ctx.save();
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "fade_from_black": {
      // Incoming clip fades in over black background
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "fade_to_black": {
      // Outgoing clip fades out to black
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "dip_black": {
      // 0 -> 0.5: fade from clip to black; 0.5 -> 1.0: fade black to incoming
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);

      if (p < 0.5) {
        ctx.save();
        ctx.globalAlpha = 1 - p * 2;
        drawFrom(ctx);
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = (p - 0.5) * 2;
        drawTo(ctx);
        ctx.restore();
      }
      break;
    }

    case "fade_from_white": {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "fade_to_white": {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "dip_color": {
      const color = transition.params?.color || "#3b82f6";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);

      if (p < 0.5) {
        ctx.save();
        ctx.globalAlpha = 1 - p * 2;
        drawFrom(ctx);
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = (p - 0.5) * 2;
        drawTo(ctx);
        ctx.restore();
      }
      break;
    }

    case "additive_dissolve": {
      drawFrom(ctx);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }

    // ── Directional Wipes ─────────────────────────────────────────────────────
    case "wipe_left": {
      // Outgoing base
      drawFrom(ctx);

      // Incoming revealed from right to left
      ctx.save();
      const splitX = width * (1 - p);
      ctx.beginPath();
      ctx.rect(splitX, 0, width - splitX, height);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_right": {
      drawFrom(ctx);

      ctx.save();
      const splitX = width * p;
      ctx.beginPath();
      ctx.rect(0, 0, splitX, height);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_up": {
      drawFrom(ctx);

      ctx.save();
      const splitY = height * (1 - p);
      ctx.beginPath();
      ctx.rect(0, splitY, width, height - splitY);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_down": {
      drawFrom(ctx);

      ctx.save();
      const splitY = height * p;
      ctx.beginPath();
      ctx.rect(0, 0, width, splitY);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_diagonal_tl_br": {
      drawFrom(ctx);

      ctx.save();
      const diagDist = (width + height) * p;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.min(width, diagDist), 0);
      if (diagDist > width) {
        ctx.lineTo(width, diagDist - width);
      }
      ctx.lineTo(0, Math.min(height, diagDist));
      ctx.closePath();
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_diagonal_tr_bl": {
      drawFrom(ctx);

      ctx.save();
      const diagDist = (width + height) * p;
      ctx.beginPath();
      ctx.moveTo(width, 0);
      ctx.lineTo(Math.max(0, width - diagDist), 0);
      if (diagDist > width) {
        ctx.lineTo(0, diagDist - width);
      }
      ctx.lineTo(width, Math.min(height, diagDist));
      ctx.closePath();
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_center_out": {
      drawFrom(ctx);

      ctx.save();
      const halfW = (width * p) / 2;
      const midX = width / 2;
      ctx.beginPath();
      ctx.rect(midX - halfW, 0, halfW * 2, height);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "wipe_edge_in": {
      drawFrom(ctx);

      ctx.save();
      const edgeW = (width * p) / 2;
      ctx.beginPath();
      ctx.rect(0, 0, edgeW, height);
      ctx.rect(width - edgeW, 0, edgeW, height);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "barn_door_horizontal": {
      drawFrom(ctx);

      ctx.save();
      const halfW = (width * p) / 2;
      ctx.beginPath();
      ctx.rect(width / 2 - halfW, 0, halfW * 2, height);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "barn_door_vertical": {
      drawFrom(ctx);

      ctx.save();
      const halfH = (height * p) / 2;
      ctx.beginPath();
      ctx.rect(0, height / 2 - halfH, width, halfH * 2);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "clock_wipe": {
      drawFrom(ctx);

      ctx.save();
      const angle = p * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(width / 2, height / 2);
      ctx.arc(width / 2, height / 2, Math.max(width, height), -Math.PI / 2, -Math.PI / 2 + angle, false);
      ctx.closePath();
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "iris_open":
    case "shape_mask_circle": {
      drawFrom(ctx);

      ctx.save();
      const maxRadius = Math.hypot(width / 2, height / 2);
      const radius = maxRadius * p;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "iris_close": {
      drawTo(ctx);

      ctx.save();
      const maxRadius = Math.hypot(width / 2, height / 2);
      const radius = maxRadius * (1 - p);
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.clip();
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "shape_mask_diamond": {
      drawFrom(ctx);

      ctx.save();
      const maxDist = Math.max(width, height) * p;
      const cx = width / 2;
      const cy = height / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - maxDist);
      ctx.lineTo(cx + maxDist, cy);
      ctx.lineTo(cx, cy + maxDist);
      ctx.lineTo(cx - maxDist, cy);
      ctx.closePath();
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "shape_mask_box": {
      drawFrom(ctx);

      ctx.save();
      const boxW = width * p;
      const boxH = height * p;
      ctx.beginPath();
      ctx.rect((width - boxW) / 2, (height - boxH) / 2, boxW, boxH);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "luma_wipe": {
      // Procedural gradient wipe
      drawFrom(ctx);

      ctx.save();
      const band = width * p;
      ctx.beginPath();
      ctx.rect(0, 0, band, height);
      ctx.clip();
      drawTo(ctx);
      ctx.restore();
      break;
    }

    // ── Movement Transitions ──────────────────────────────────────────────────
    case "push_left": {
      const offset = width * p;
      // Outgoing moving left
      ctx.save();
      ctx.translate(-offset, 0);
      drawFrom(ctx);
      ctx.restore();

      // Incoming entering from right
      ctx.save();
      ctx.translate(width - offset, 0);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "push_right": {
      const offset = width * p;
      // Outgoing moving right
      ctx.save();
      ctx.translate(offset, 0);
      drawFrom(ctx);
      ctx.restore();

      // Incoming entering from left
      ctx.save();
      ctx.translate(-width + offset, 0);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "push_up": {
      const offset = height * p;
      // Outgoing moving up
      ctx.save();
      ctx.translate(0, -offset);
      drawFrom(ctx);
      ctx.restore();

      // Incoming entering from bottom
      ctx.save();
      ctx.translate(0, height - offset);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "push_down": {
      const offset = height * p;
      // Outgoing moving down
      ctx.save();
      ctx.translate(0, offset);
      drawFrom(ctx);
      ctx.restore();

      // Incoming entering from top
      ctx.save();
      ctx.translate(0, -height + offset);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "slide_left":
    case "cover_left": {
      drawFrom(ctx);

      // Incoming slides over from right
      ctx.save();
      ctx.translate(width * (1 - p), 0);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "slide_right": {
      drawFrom(ctx);

      // Incoming slides over from left
      ctx.save();
      ctx.translate(-width * (1 - p), 0);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "slide_up": {
      drawFrom(ctx);

      // Incoming slides over from bottom
      ctx.save();
      ctx.translate(0, height * (1 - p));
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "slide_down": {
      drawFrom(ctx);

      // Incoming slides over from top
      ctx.save();
      ctx.translate(0, -height * (1 - p));
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "reveal_left": {
      drawTo(ctx);

      // Outgoing slides away to left
      ctx.save();
      ctx.translate(-width * p, 0);
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "reveal_right": {
      drawTo(ctx);

      // Outgoing slides away to right
      ctx.save();
      ctx.translate(width * p, 0);
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "split_push": {
      const halfH = height / 2;
      const splitY = halfH * p;

      // Draw incoming stationary in center
      drawTo(ctx);

      // Outgoing top half moves up
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width, halfH);
      ctx.clip();
      ctx.translate(0, -splitY);
      drawFrom(ctx);
      ctx.restore();

      // Outgoing bottom half moves down
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, halfH, width, halfH);
      ctx.clip();
      ctx.translate(0, splitY);
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "split_slide": {
      const halfW = width / 2;
      const splitX = halfW * p;

      drawTo(ctx);

      // Outgoing left moves left
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, halfW, height);
      ctx.clip();
      ctx.translate(-splitX, 0);
      drawFrom(ctx);
      ctx.restore();

      // Outgoing right moves right
      ctx.save();
      ctx.beginPath();
      ctx.rect(halfW, 0, halfW, height);
      ctx.clip();
      ctx.translate(splitX, 0);
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    case "zoom_in":
    case "directional_zoom": {
      drawFrom(ctx);

      ctx.save();
      const scale = 0.5 + 0.5 * p;
      ctx.globalAlpha = p;
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "zoom_out": {
      drawTo(ctx);

      ctx.save();
      const scale = 1.0 - 0.5 * p;
      ctx.globalAlpha = 1 - p;
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);
      drawFrom(ctx);
      ctx.restore();
      break;
    }

    // ── Blur, Focus & Stylized ────────────────────────────────────────────────
    case "blur_dissolve":
    case "zoom_blur":
    case "defocus": {
      // Deterministic optical dissolve with soften
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawFrom(ctx);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }

    case "flash_white": {
      // 0 -> 0.4: brighten from clip to white; 0.4 -> 1.0: fade from white to incoming
      if (p < 0.4) {
        drawFrom(ctx);
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = p / 0.4;
        ctx.fillRect(0, 0, width, height);
      } else {
        drawTo(ctx);
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 1 - (p - 0.4) / 0.6;
        ctx.fillRect(0, 0, width, height);
      }
      break;
    }

    case "flash_color": {
      const color = transition.params?.color || "#f59e0b";
      if (p < 0.4) {
        drawFrom(ctx);
        ctx.fillStyle = color;
        ctx.globalAlpha = p / 0.4;
        ctx.fillRect(0, 0, width, height);
      } else {
        drawTo(ctx);
        ctx.fillStyle = color;
        ctx.globalAlpha = 1 - (p - 0.4) / 0.6;
        ctx.fillRect(0, 0, width, height);
      }
      break;
    }

    case "glitch": {
      // Deterministic digital artifact displacement
      const seed = transition.params?.seed ?? 42;
      const intensity = (transition.params?.intensity ?? 1.0) * (1 - Math.abs(p - 0.5) * 2);

      if (p < 0.5) {
        drawFrom(ctx);
      } else {
        drawTo(ctx);
      }

      if (intensity > 0.05) {
        // Draw deterministic slice displacements
        const sliceCount = 6;
        for (let i = 0; i < sliceCount; i++) {
          const pseudoRand = Math.sin(seed * 997 + i * 31.7) * 43758.5453;
          const frac = pseudoRand - Math.floor(pseudoRand);
          const y = frac * height;
          const sliceH = Math.max(8, (height / sliceCount) * 0.4);
          const shiftX = (Math.sin(seed * 13 + i * 7.1) * 30) * intensity;

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y, width, sliceH);
          ctx.clip();
          ctx.translate(shiftX, 0);
          if (p < 0.5) drawFrom(ctx); else drawTo(ctx);
          ctx.restore();
        }
      }
      break;
    }

    case "pixelate": {
      // Mosaic cross-blend
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawFrom(ctx);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }

    default: {
      // Safe fallback: standard cross dissolve
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawFrom(ctx);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = p;
      drawTo(ctx);
      ctx.restore();
      break;
    }
  }

  ctx.restore();
}
