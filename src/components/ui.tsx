import * as React from "react";

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render button as full-width block */
  block?: boolean;
  children: React.ReactNode;
}

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-cs-accent text-white hover:bg-cs-accent-hover active:opacity-90 focus-visible:ring-2 focus-visible:ring-cs-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-cs-bg-surface",
  secondary:
    "bg-cs-bg-elevated border border-cs-border-default text-cs-text-primary hover:bg-cs-bg-hover active:bg-cs-bg-active",
  ghost:
    "bg-transparent text-cs-text-secondary hover:bg-cs-bg-hover hover:text-cs-text-primary active:bg-cs-bg-active",
  danger:
    "bg-cs-error/10 border border-cs-error/30 text-cs-error hover:bg-cs-error/20 active:bg-cs-error/30",
};

const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center rounded font-medium",
        "transition-colors duration-150 cursor-pointer",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-border-focus focus-visible:ring-offset-1 focus-visible:ring-offset-cs-bg-surface",
        buttonVariantClasses[variant],
        buttonSizeClasses[size],
        block ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: ButtonSize;
  children: React.ReactNode;
}

export function IconButton({
  label,
  size = "md",
  className = "",
  children,
  ...props
}: IconButtonProps) {
  const sizeClass: Record<ButtonSize, string> = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={[
        "inline-flex items-center justify-center rounded",
        "text-cs-text-secondary hover:text-cs-text-primary",
        "hover:bg-cs-bg-hover active:bg-cs-bg-active",
        "transition-colors duration-150 cursor-pointer",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-border-focus",
        sizeClass[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "muted";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  title?: string;
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  default: "bg-cs-accent/15 text-cs-accent",
  success: "bg-cs-success/15 text-cs-success",
  warning: "bg-cs-warning/15 text-cs-warning",
  error: "bg-cs-error/15 text-cs-error",
  info: "bg-cs-info/15 text-cs-info",
  muted: "bg-cs-bg-elevated text-cs-text-tertiary",
};

export function Badge({ variant = "default", children, className = "", title }: BadgeProps) {
  return (
    <span
      title={title}
      className={[
        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium",
        badgeVariantClasses[variant],
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

export function Divider({ className = "" }: { className?: string }) {
  return <hr className={["border-0 border-t border-cs-border-subtle", className].join(" ")} />;
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-4 py-16 px-6 text-center",
        className,
      ].join(" ")}
    >
      {icon && (
        <div className="text-cs-text-tertiary opacity-60" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5 max-w-sm">
        <p className="text-sm font-medium text-cs-text-primary">{title}</p>
        {description && (
          <p className="text-xs text-cs-text-secondary leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}

export function Panel({ children, className = "", as: Tag = "div" }: PanelProps) {
  return (
    <Tag
      className={[
        "bg-cs-bg-surface border border-cs-border-subtle rounded-lg overflow-hidden",
        className,
      ].join(" ")}
    >
      {children}
    </Tag>
  );
}

// ─── PanelHeader ─────────────────────────────────────────────────────────────

interface PanelHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PanelHeader({ title, description, actions, className = "" }: PanelHeaderProps) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-4 px-4 py-3",
        "border-b border-cs-border-subtle",
        className,
      ].join(" ")}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-semibold tracking-wide uppercase text-cs-text-secondary">
          {title}
        </span>
        {description && <span className="text-xs text-cs-text-tertiary truncate">{description}</span>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
// Antigravity UI components use native `title` and `aria-label` attributes for accessibility.

// ─── StatusIndicator ─────────────────────────────────────────────────────────

type StatusLevel = "ok" | "warning" | "error" | "unknown";

interface StatusIndicatorProps {
  level: StatusLevel;
  label: string;
  className?: string;
}

const statusDotClasses: Record<StatusLevel, string> = {
  ok: "bg-cs-success",
  warning: "bg-cs-warning",
  error: "bg-cs-error",
  unknown: "bg-cs-text-tertiary",
};

export function StatusIndicator({ level, label, className = "" }: StatusIndicatorProps) {
  return (
    <span className={["inline-flex items-center gap-1.5", className].join(" ")}>
      <span
        className={["w-1.5 h-1.5 rounded-full shrink-0", statusDotClasses[level]].join(" ")}
        aria-hidden="true"
      />
      <span className="text-xs text-cs-text-secondary">{label}</span>
    </span>
  );
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

export function SectionLabel({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <span
      id={id}
      className={[
        "text-xs font-semibold uppercase tracking-widest text-cs-text-tertiary",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

// ─── KeyboardShortcut ─────────────────────────────────────────────────────────

export function KeyboardShortcut({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-mono bg-cs-bg-elevated border border-cs-border-default text-cs-text-tertiary"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  description?: string;
}

export function Input({
  label,
  error,
  description,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-cs-text-primary">
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        className={[
          "h-9 px-3 text-sm rounded bg-cs-bg-base border",
          error
            ? "border-cs-error text-cs-text-primary focus:border-cs-error focus:ring-1 focus:ring-cs-error"
            : "border-cs-border-default text-cs-text-primary placeholder:text-cs-text-tertiary focus:border-cs-accent focus:ring-1 focus:ring-cs-accent",
          "focus:outline-none transition-colors duration-150",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      {description && !error && (
        <span className="text-[11px] text-cs-text-tertiary">{description}</span>
      )}
      {error && <span className="text-[11px] text-cs-error font-medium">{error}</span>}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl";
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = "md",
}: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidthClass = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }[maxWidth];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
    >
      {/* Backdrop click */}
      <div
        className="fixed inset-0"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div
        className={[
          "relative w-full rounded-lg bg-cs-bg-surface border border-cs-border-default shadow-xl overflow-hidden",
          maxWidthClass,
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-4 border-b border-cs-border-subtle">
          <div className="flex flex-col gap-0.5">
            <h2 id="modal-title" className="text-sm font-semibold text-cs-text-primary">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-cs-text-secondary leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close dialog" size="sm" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </div>

        {/* Body */}
        <div className="p-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 bg-cs-bg-elevated/50 border-t border-cs-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
