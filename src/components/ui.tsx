import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  accent: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-hover text-text hover:bg-active",
  ghost: "text-text-muted hover:bg-hover hover:text-text",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  const sizing = size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/** A square icon-only button; `label` doubles as tooltip and accessible name. */
export function IconButton({ label, className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
  embedded = false,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Inside a tab of another page: the title is that page's, so only read out. */
  embedded?: boolean;
}) {
  return (
    <header className={`${embedded ? "mb-6" : "mb-8"} flex items-start gap-4`}>
      <div className="min-w-0 flex-1">
        <h1
          className={embedded ? "sr-only" : "text-fs-20 leading-tight font-semibold tracking-tight"}
        >
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset aria-label={label} className="inline-flex rounded-md bg-sunken p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`h-6 rounded px-2.5 text-xs font-medium transition-colors ${
              selected ? "bg-active text-text" : "text-text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-border-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

/** A titled group of settings rows: a heading and the rows, no box around them. */
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <SectionTitle className="px-4">{title}</SectionTitle>}
      <div>{children}</div>
    </section>
  );
}

/** The small heading over a group of things. */
export function SectionTitle({
  children,
  className = "",
  actions,
}: {
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`mb-1.5 flex items-center gap-2 ${className}`}>
      <h2 className="min-w-0 flex-1 truncate text-fs-11 font-medium tracking-wide text-text-subtle">
        {children}
      </h2>
      {actions}
    </div>
  );
}

export function Row({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-md px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-0.5 text-xs text-text-muted">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/** Text tabs over a page's sections; the chosen one is marked by a short bar. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(o.value)}
            className={`relative pb-2 text-sm transition-colors ${
              selected ? "font-medium text-text" : "text-text-muted hover:text-text"
            }`}
          >
            {o.label}
            {selected && (
              <span className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
