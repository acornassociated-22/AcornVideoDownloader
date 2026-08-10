import { useEffect, useState, type ReactNode } from "react";
import type { PageId } from "../types";
import { Sidebar } from "./Sidebar";
import { SocialLinks } from "./SocialLinks";

const COLLAPSE_KEY = "acorn-sidebar-collapsed";
const SOCIAL_COLLAPSE_KEY = "acorn-social-collapsed";

/** App chrome with collapsible sidebar, social rail, and main content. */
export function Layout({
  page,
  onNavigate,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      return stored === null ? true : stored === "1";
    } catch {
      return true;
    }
  });

  const [socialCollapsed, setSocialCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(SOCIAL_COLLAPSE_KEY);
      return stored === null ? true : stored === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(SOCIAL_COLLAPSE_KEY, socialCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [socialCollapsed]);

  return (
    <div
      className={[
        "app-shell",
        collapsed ? "sidebar-collapsed" : "",
        socialCollapsed ? "social-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Sidebar
        page={page}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
      <div className="main-column">
        <main className="main">{children}</main>
      </div>
      <SocialLinks
        collapsed={socialCollapsed}
        onToggleCollapsed={() => setSocialCollapsed((v) => !v)}
      />
    </div>
  );
}
