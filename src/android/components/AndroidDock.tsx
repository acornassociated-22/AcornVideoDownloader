import {
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PageId } from "../../types";

const BAR_H = 86;
const BUBBLE_D = 54;
const BUBBLE_R = BUBBLE_D / 2;
const BUBBLE_TOP = 6;
const DIP_DEPTH = BUBBLE_D + 4;
const CURVE_W = BUBBLE_R * 3;

/** Build Hejar-style concave dock SVG path for bubble center `cx`. */
function buildPath(cx: number, w: number, h: number): string {
  const d = DIP_DEPTH;
  const hw = CURVE_W;
  const lx = cx - hw;
  const rx = cx + hw;
  const cp = hw * 0.55;
  return [
    `M 0 0`,
    `L ${lx} 0`,
    `C ${lx + cp} 0 ${cx - cp} ${d} ${cx} ${d}`,
    `C ${cx + cp} ${d} ${rx - cp} 0 ${rx} 0`,
    `L ${w} 0`,
    `L ${w} ${h}`,
    `L 0 ${h}`,
    `Z`,
  ].join(" ");
}

type DockTab = {
  id: PageId;
  icon: string;
  label: string;
};

/** Hejar MagicTabBar: instant snap — bubble always matches active tab. */
export function AndroidDock({
  tabs,
  activeIndex,
  queueBadge,
  ariaLabel,
  onNavigate,
}: {
  tabs: DockTab[];
  activeIndex: number;
  queueBadge: boolean;
  ariaLabel: string;
  onNavigate: (id: PageId) => void;
}) {
  const wrapRef = useRef<HTMLElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  const [barW, setBarW] = useState(360);
  const [activeIcon, setActiveIcon] = useState(tabs[activeIndex]?.icon ?? "");
  const [activeLabel, setActiveLabel] = useState(tabs[activeIndex]?.label ?? "");

  const tabCount = Math.max(tabs.length, 1);
  const tabW = barW / tabCount;
  const safeIndex = Math.min(Math.max(activeIndex, 0), tabCount - 1);

  /** Center X of tab index. */
  function centerOf(i: number) {
    return tabW * i + tabW / 2;
  }

  /** Paint bubble/path/label from current refs — translateX only. */
  function paint(cx: number) {
    const d = buildPath(cx, barW, BAR_H);
    pathRef.current?.setAttribute("d", d);
    strokeRef.current?.setAttribute("d", d);
    if (bubbleRef.current) {
      bubbleRef.current.style.transform = `translateX(${cx - BUBBLE_R}px)`;
    }
    if (labelRef.current) {
      labelRef.current.style.transform = `translateX(${cx - 36}px)`;
    }
  }

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    /** Measure dock width for SVG geometry. */
    function measure() {
      const w = el!.getBoundingClientRect().width;
      if (w > 0) setBarW(w);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (barW <= 0) return;
    const cx = centerOf(safeIndex);
    paint(cx);
    setActiveIcon(tabs[safeIndex]?.icon ?? "");
    setActiveLabel(tabs[safeIndex]?.label ?? "");
  }, [safeIndex, barW, tabW, tabs]);

  return (
    <nav className="a-dock" ref={wrapRef} aria-label={ariaLabel}>
      <div className="a-dock-shadow" aria-hidden="true" />
      <svg
        className="a-dock-svg"
        width={barW}
        height={BAR_H}
        viewBox={`0 0 ${barW} ${BAR_H}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="aDockFillDark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3d435f" />
            <stop offset="45%" stopColor="#2e324a" />
            <stop offset="100%" stopColor="#232636" />
          </linearGradient>
          <linearGradient id="aDockFillLight" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9aa6d4" />
            <stop offset="40%" stopColor="#6b7bb8" />
            <stop offset="100%" stopColor="#5a679e" />
          </linearGradient>
        </defs>
        <path ref={pathRef} className="a-dock-path" d={buildPath(centerOf(safeIndex), barW, BAR_H)} />
        <path
          ref={strokeRef}
          className="a-dock-path-stroke"
          d={buildPath(centerOf(safeIndex), barW, BAR_H)}
          fill="none"
          strokeWidth={1}
        />
      </svg>

      <div
        ref={bubbleRef}
        className="a-dock-bubble"
        style={{ top: BUBBLE_TOP }}
        aria-hidden="true"
      >
        <span className="a-dock-bubble-inner">
          <span className="material-symbols-rounded">{activeIcon}</span>
          {queueBadge && tabs[safeIndex]?.id === "queue" ? (
            <span className="a-dock-badge" />
          ) : null}
        </span>
      </div>

      <span
        ref={labelRef}
        className="a-dock-active-label is-on"
        style={{ top: BUBBLE_TOP + BUBBLE_D + 4 }}
        aria-hidden="true"
      >
        {activeLabel}
      </span>

      <div className="a-dock-row">
        {tabs.map((tab, index) => {
          const focused = index === safeIndex;
          return (
            <button
              key={tab.id}
              type="button"
              className={`a-dock-tab ${focused ? "is-active" : ""}`}
              onClick={() => onNavigate(tab.id)}
              aria-current={focused ? "page" : undefined}
              aria-label={tab.label}
            >
              {!focused ? (
                <span className="a-dock-tab-inner">
                  <span className="material-symbols-rounded">{tab.icon}</span>
                  <span className="a-dock-label">{tab.label}</span>
                  {tab.id === "queue" && queueBadge ? (
                    <span className="a-dock-badge" aria-hidden="true" />
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
