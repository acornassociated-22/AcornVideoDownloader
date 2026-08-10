import type { CSSProperties, ReactNode } from "react";

/** Surface container for interactive mobile groups. */
export function AndroidCard({
  children,
  className = "",
  large = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  large?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={["a-card", large ? "a-card-lg" : "", className].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </div>
  );
}
