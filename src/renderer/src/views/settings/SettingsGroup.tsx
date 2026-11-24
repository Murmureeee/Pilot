// @env browser
import type { JSX, ReactNode } from "react";

export function SettingsGroup({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground mt-0.5 text-xs leading-5">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function SettingsItem({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="settings-row">
      <div className="min-w-0 flex-1 basis-52">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && (
          <p className="text-muted-foreground mt-0.5 text-xs leading-5 wrap-anywhere">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
