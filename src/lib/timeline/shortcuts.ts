/**
 * Keyboard Shortcuts Registry and Action Dispatcher.
 *
 * Rules:
 * - Centralized, discoverable registry for all editor keyboard shortcuts.
 * - Categorized by editing role (Transport, Edit, Tools, Navigation, Markers).
 * - Safe: Never triggers when user is typing in inputs or contentEditable elements.
 */

export interface KeyboardShortcutDefinition {
  id: string;
  name: string;
  description: string;
  category: "Transport" | "Editing" | "Tools" | "Navigation" | "Project";
  keys: string;
  macKeys?: string;
  actionId: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcutDefinition[] = [
  // ─── Transport ──────────────────────────────────────────────────────────────
  {
    id: "transport.play_pause",
    name: "Play / Pause",
    description: "Start or stop timeline and preview playback",
    category: "Transport",
    keys: "Space",
    actionId: "playPause",
  },
  {
    id: "transport.shuttle_reverse",
    name: "Shuttle Reverse",
    description: "Reverse playback or decrease playback speed",
    category: "Transport",
    keys: "J",
    actionId: "shuttleReverse",
  },
  {
    id: "transport.shuttle_stop",
    name: "Pause / Stop",
    description: "Stop playback",
    category: "Transport",
    keys: "K",
    actionId: "shuttleStop",
  },
  {
    id: "transport.shuttle_forward",
    name: "Shuttle Forward",
    description: "Play forward or increase playback speed",
    category: "Transport",
    keys: "L",
    actionId: "shuttleForward",
  },
  {
    id: "transport.step_back_frame",
    name: "Step 1 Frame Back",
    description: "Move playhead backward by exactly one frame",
    category: "Transport",
    keys: "Left",
    actionId: "stepBackFrame",
  },
  {
    id: "transport.step_forward_frame",
    name: "Step 1 Frame Forward",
    description: "Move playhead forward by exactly one frame",
    category: "Transport",
    keys: "Right",
    actionId: "stepForwardFrame",
  },
  {
    id: "transport.step_back_second",
    name: "Step 1 Second Back",
    description: "Move playhead backward by 1 second (or 30 frames)",
    category: "Transport",
    keys: "Shift+Left",
    actionId: "stepBackSecond",
  },
  {
    id: "transport.step_forward_second",
    name: "Step 1 Second Forward",
    description: "Move playhead forward by 1 second (or 30 frames)",
    category: "Transport",
    keys: "Shift+Right",
    actionId: "stepForwardSecond",
  },
  {
    id: "transport.go_to_start",
    name: "Go to Sequence Start",
    description: "Jump playhead to timeline origin (00:00:00:00)",
    category: "Transport",
    keys: "Home",
    actionId: "goToStart",
  },
  {
    id: "transport.go_to_end",
    name: "Go to Sequence End",
    description: "Jump playhead to the end of the timeline",
    category: "Transport",
    keys: "End",
    actionId: "goToEnd",
  },

  // ─── Editing ────────────────────────────────────────────────────────────────
  {
    id: "edit.split_at_playhead",
    name: "Split at Playhead",
    description: "Split selected clip or all active clips at the playhead position",
    category: "Editing",
    keys: "S",
    actionId: "splitAtPlayhead",
  },
  {
    id: "edit.lift_delete",
    name: "Lift / Delete",
    description: "Remove selected clip(s) leaving the gap intact",
    category: "Editing",
    keys: "Delete / Backspace",
    actionId: "liftDelete",
  },
  {
    id: "edit.ripple_delete",
    name: "Ripple Delete",
    description: "Remove selected clip(s) and ripple close the gap",
    category: "Editing",
    keys: "Shift+Delete",
    actionId: "rippleDelete",
  },
  {
    id: "edit.insert",
    name: "Insert Edit",
    description: "Insert source clip at playhead, shifting subsequent clips",
    category: "Editing",
    keys: ",",
    actionId: "insertEdit",
  },
  {
    id: "edit.overwrite",
    name: "Overwrite Edit",
    description: "Overwrite timeline from playhead without shifting clips",
    category: "Editing",
    keys: ".",
    actionId: "overwriteEdit",
  },
  {
    id: "edit.mark_in",
    name: "Mark In",
    description: "Set In-point at the current playhead time",
    category: "Editing",
    keys: "I",
    actionId: "markIn",
  },
  {
    id: "edit.mark_out",
    name: "Mark Out",
    description: "Set Out-point at the current playhead time",
    category: "Editing",
    keys: "O",
    actionId: "markOut",
  },
  {
    id: "edit.clear_in_out",
    name: "Clear In / Out",
    description: "Clear sequence In and Out boundaries",
    category: "Editing",
    keys: "Alt+X",
    actionId: "clearInOut",
  },

  // ─── Tools ──────────────────────────────────────────────────────────────────
  {
    id: "tools.selection",
    name: "Selection Tool",
    description: "Default tool to select, move, and trim clips",
    category: "Tools",
    keys: "V",
    actionId: "toolSelection",
  },
  {
    id: "tools.razor",
    name: "Razor / Blade Tool",
    description: "Cut clips directly on the timeline with a click",
    category: "Tools",
    keys: "C",
    actionId: "toolRazor",
  },
  {
    id: "tools.ripple_edit",
    name: "Ripple Edit Tool",
    description: "Trim clip edges while automatically rippling adjacent clips",
    category: "Tools",
    keys: "B",
    actionId: "toolRipple",
  },
  {
    id: "tools.slip",
    name: "Slip Tool",
    description: "Slip clip source media without changing its timeline position",
    category: "Tools",
    keys: "Y",
    actionId: "toolSlip",
  },
  {
    id: "tools.slide",
    name: "Slide Tool",
    description: "Slide clip position while adjusting adjacent edit points",
    category: "Tools",
    keys: "U",
    actionId: "toolSlide",
  },

  // ─── Markers & Navigation ────────────────────────────────────────────────────
  {
    id: "markers.add",
    name: "Add Marker",
    description: "Add a marker at the playhead position",
    category: "Navigation",
    keys: "M",
    actionId: "addMarker",
  },
  {
    id: "markers.next",
    name: "Next Marker",
    description: "Jump playhead to the next marker",
    category: "Navigation",
    keys: "Shift+M",
    actionId: "nextMarker",
  },
  {
    id: "markers.prev",
    name: "Previous Marker",
    description: "Jump playhead to the previous marker",
    category: "Navigation",
    keys: "Alt+M",
    actionId: "prevMarker",
  },
  {
    id: "nav.zoom_in",
    name: "Zoom In",
    description: "Magnify timeline zoom",
    category: "Navigation",
    keys: "= / +",
    actionId: "zoomIn",
  },
  {
    id: "nav.zoom_out",
    name: "Zoom Out",
    description: "Reduce timeline zoom",
    category: "Navigation",
    keys: "-",
    actionId: "zoomOut",
  },
  {
    id: "nav.zoom_to_fit",
    name: "Zoom to Fit",
    description: "Fit the entire timeline duration in view",
    category: "Navigation",
    keys: "Shift+Z",
    actionId: "zoomToFit",
  },

  // ─── Project & History ───────────────────────────────────────────────────────
  {
    id: "project.undo",
    name: "Undo",
    description: "Undo the last editing operation",
    category: "Project",
    keys: "Ctrl+Z",
    macKeys: "Cmd+Z",
    actionId: "undo",
  },
  {
    id: "project.redo",
    name: "Redo",
    description: "Redo the previously undone operation",
    category: "Project",
    keys: "Ctrl+Y / Ctrl+Shift+Z",
    macKeys: "Cmd+Shift+Z",
    actionId: "redo",
  },
  {
    id: "project.copy",
    name: "Copy",
    description: "Copy selected clips to clipboard",
    category: "Project",
    keys: "Ctrl+C",
    macKeys: "Cmd+C",
    actionId: "copy",
  },
  {
    id: "project.paste",
    name: "Paste",
    description: "Paste copied clips at playhead",
    category: "Project",
    keys: "Ctrl+V",
    macKeys: "Cmd+V",
    actionId: "paste",
  },
  {
    id: "project.duplicate",
    name: "Duplicate",
    description: "Duplicate selected clip immediately after itself",
    category: "Project",
    keys: "Ctrl+D",
    macKeys: "Cmd+D",
    actionId: "duplicate",
  },
];
