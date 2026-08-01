import React from "react";

/** Minimal design-system primitives on the Phase A tokens (FAV-106/1107). */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50",
    secondary: "border border-border-token bg-bg-elevated hover:bg-bg-subtle disabled:opacity-50",
    danger: "bg-danger text-white hover:opacity-90 disabled:opacity-50",
    ghost: "hover:bg-bg-subtle text-text-muted hover:text-text"
  }[variant];
  return (
    <button
      className={cn(
        "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        styles,
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border-token bg-bg-elevated p-5", className)}
      {...props}
    />
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-bg-subtle text-text-muted",
  queued: "bg-warning/15 text-warning",
  generating: "bg-accent/15 text-accent",
  rendering: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  canceled: "bg-bg-subtle text-text-muted"
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_COLORS[status] ?? "bg-bg-subtle text-text-muted"
      )}
    >
      {(status === "generating" || status === "rendering" || status === "queued") && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </span>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border-token bg-bg px-3 py-2 text-sm outline-none placeholder:text-text-muted focus:border-accent",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-border-token bg-bg px-3 py-2 text-sm outline-none placeholder:text-text-muted focus:border-accent",
        className
      )}
      {...props}
    />
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="text-text-muted">{label}</span>
          <span className="font-medium">{percent}%</span>
        </div>
      ) : null}
      <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
        <div
          className="h-full rounded-full bg-accent transition-all duration-700"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-bg-subtle", className)} />;
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-token py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-text-muted">{description}</p>
      {action}
    </div>
  );
}

/** Option pill group used across the wizard. */
export function PillGroup<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            value === opt.value
              ? "border-accent bg-accent/10 text-accent"
              : "border-border-token bg-bg-elevated text-text-muted hover:text-text"
          )}
          title={opt.hint}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
