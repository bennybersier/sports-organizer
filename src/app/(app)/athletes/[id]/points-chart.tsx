"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import type { AthleteMatchLine } from "@/server/services/match-service";

/**
 * Points scored, match by match.
 *
 * ## Why this one is safe to plot
 *
 * Points are the one box-score figure both sources agree on. A game sheet
 * records no attempts, rebounds or minutes — which is why the athlete page
 * hides those for referto-sourced matches — but it does record every basket,
 * so a points line is honest across a season that mixes the two. Nothing else
 * in the box score could be charted this way without mixing a measured number
 * with a structural zero.
 *
 * ## Form and colour
 *
 * One series, trend over time, so: a line, and **no legend** — the title says
 * what is plotted and a box with one swatch would only restate it. The club's
 * design system is deliberately monochrome (every `--chart-*` token is chroma
 * zero), so the mark wears the foreground ink rather than a hue invented for
 * the occasion. With a single series there is no identity to encode and
 * nothing for colour to do.
 *
 * The outcome of each match is deliberately *not* coloured into the markers.
 * Win and loss are status, and status colour may never be the only carrier of
 * a fact — it lives in the tooltip and in the table underneath, where it is
 * written down.
 *
 * Built as inline SVG at measured pixel width rather than a scaled viewBox, so
 * a 2px stroke is 2px and 11px text is 11px at every container size.
 */

/** Plot height in CSS pixels. Axis chrome sits inside the margins below. */
const HEIGHT = 190;
const M = { top: 16, right: 40, bottom: 26, left: 30 };
/** Marker radius; the surface ring and hit target are built out from it. */
const R = 4.5;
/** Pointer/focus target per point, comfortably larger than the mark. */
const HIT = 24;

export function PointsChart({ matches }: { matches: AthleteMatchLine[] }) {
  const t = useTranslations("attendance");
  const format = useFormatter();

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  // Measured rather than assumed: the card is fluid and the chart sits in a
  // grid that changes at the sm breakpoint.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* Oldest first: a time axis reads left to right, and the service hands these
     back most-recent-first for the table. */
  const series = useMemo(
    () => matches.slice().reverse(),
    [matches],
  );

  const scale = useMemo(() => {
    const innerW = Math.max(width - M.left - M.right, 10);
    const innerH = HEIGHT - M.top - M.bottom;
    const peak = Math.max(...series.map((m) => m.points), 1);
    /*
      Always from zero: a points axis that starts anywhere else exaggerates the
      difference between a quiet night and a good one.

      Rounded up to a multiple of ten so the midpoint tick is a whole number.
      Stepping by five looks tighter but puts "12.5 points" on the axis, and a
      half-point is not a thing basketball can produce.
    */
    const top = Math.max(10, Math.ceil(peak / 10) * 10);
    const x = (i: number) =>
      M.left + (series.length === 1 ? innerW / 2 : (innerW * i) / (series.length - 1));
    const y = (value: number) => M.top + innerH - (innerH * value) / top;
    return { x, y, top, innerW, innerH };
  }, [series, width]);

  if (series.length < 2) return null;

  const total = series.reduce((sum, m) => sum + m.points, 0);
  const mean = total / series.length;
  const path = series.map((m, i) => `${i === 0 ? "M" : "L"}${scale.x(i)},${scale.y(m.points)}`).join(" ");
  const last = series.length - 1;
  const shown = active ?? last;
  const current = series[shown];

  /** Ticks at 0, a middle value and the top — enough to read, not a ladder. */
  const ticks = [0, scale.top / 2, scale.top];

  function nearest(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const local = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < series.length; i += 1) {
      if (Math.abs(scale.x(i) - local) < Math.abs(scale.x(best) - local)) best = i;
    }
    setActive(best);
  }

  return (
    <figure className="space-y-1">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("stats.pointsPerMatch")}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("stats.averagePoints", { value: mean.toFixed(1) })}
        </span>
      </figcaption>

      <div ref={box} className="relative w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t("stats.pointsChartLabel", {
              matches: series.length,
              average: mean.toFixed(1),
            })}
            className="touch-none select-none"
            tabIndex={0}
            onPointerMove={(event) => nearest(event.clientX)}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              // Same readout on the keyboard as under the pointer.
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setActive(Math.min((active ?? last) + 1, last));
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                setActive(Math.max((active ?? last) - 1, 0));
              }
            }}
          >
            {/* Gridlines: hairline, solid, one step off the surface. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={M.left}
                  x2={width - M.right}
                  y1={scale.y(tick)}
                  y2={scale.y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={M.left - 6}
                  y={scale.y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {tick}
                </text>
              </g>
            ))}

            {/*
              The season average. Labelled in words so it cannot be mistaken
              for one more gridline, which is the only thing it looks like.
            */}
            <line
              x1={M.left}
              x2={width - M.right}
              y1={scale.y(mean)}
              y2={scale.y(mean)}
              className="stroke-muted-foreground/50"
              strokeWidth={1}
              strokeDasharray="3 3"
            />

            {/* Crosshair, snapped to the nearest match. */}
            {active !== null ? (
              <line
                x1={scale.x(active)}
                x2={scale.x(active)}
                y1={M.top}
                y2={HEIGHT - M.bottom}
                className="stroke-muted-foreground/40"
                strokeWidth={1}
              />
            ) : null}

            <path
              d={path}
              fill="none"
              className="stroke-foreground"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {series.map((match, i) => (
              <g key={`${match.eventId}:${match.teamId}`}>
                {/* 2px ring in the surface colour keeps a marker legible where
                    it sits on the line. */}
                <circle
                  cx={scale.x(i)}
                  cy={scale.y(match.points)}
                  r={R + 2}
                  className="fill-card"
                />
                <circle
                  cx={scale.x(i)}
                  cy={scale.y(match.points)}
                  r={i === shown ? R + 1 : R}
                  className="fill-foreground"
                />
                {/* Hit target, bigger than the mark and invisible. */}
                <rect
                  x={scale.x(i) - HIT / 2}
                  y={M.top}
                  width={HIT}
                  height={scale.innerH}
                  fill="transparent"
                />
              </g>
            ))}

            {/* One direct label, at the end, per the line rule. */}
            <text
              x={scale.x(last) + 8}
              y={scale.y(series[last].points)}
              dominantBaseline="middle"
              className="fill-foreground text-[11px] font-semibold tabular-nums"
            >
              {series[last].points}
            </text>

            {/* First and last dates only — the tooltip carries the rest. */}
            {[0, last].map((i) => (
              <text
                key={i}
                x={scale.x(i)}
                y={HEIGHT - 8}
                textAnchor={i === 0 ? "start" : "end"}
                className="fill-muted-foreground text-[10px]"
              >
                {format.dateTime(new Date(series[i].startsAt), {
                  day: "numeric",
                  month: "short",
                })}
              </text>
            ))}
          </svg>
        ) : null}

        {/* Readout: the value leads, the match follows. */}
        {active !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-sm"
            style={{
              left: Math.min(Math.max(scale.x(active) - 60, 0), Math.max(width - 130, 0)),
            }}
          >
            <p className="font-semibold tabular-nums">
              {t("stats.pointsValue", { points: current.points })}
            </p>
            <p className="text-muted-foreground">{current.opponent}</p>
            <p className="text-muted-foreground tabular-nums">
              {format.dateTime(new Date(current.startsAt), { day: "numeric", month: "short" })}
              {current.result
                ? ` · ${current.result.ourScore}–${current.result.theirScore}`
                : ""}
            </p>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
