"use client";

import { useTranslations } from "next-intl";
import { Maximize2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Region } from "@/domain/referto/transcription";

/**
 * The part of the photograph a question is about, enlarged.
 *
 * A referto is A4 of three-millimetre handwriting. Shown whole at thumbnail
 * size it is a grey texture, so a question like "who scored to reach 6?" had
 * the reader squinting at the wrong column — there are two ladders on that
 * page and both have a row 6. Showing the centimetre in question, at a size
 * you can read, is the difference between answering and guessing.
 *
 * Implemented as a background image rather than a clipped `<img>`: the maths
 * is the browser's own, it scales with whatever box the caller gives it, and
 * there is no second element to keep in step.
 *
 * Falls back to the whole photograph when the reading has no regions — sheets
 * read before the model was asked for them, and any box it could not find.
 */
export function SheetCrop({
  imageUrl,
  region,
  className,
}: {
  imageUrl: string | null;
  /** `[yMin, xMin, yMax, xMax]` in thousandths. Null shows the whole sheet. */
  region: Region | null;
  className?: string;
}) {
  const t = useTranslations("matches");
  if (!imageUrl) return null;

  const crop = region ? cropStyle(region) : { backgroundSize: "contain" as const };

  return (
    <a
      href={imageUrl}
      target="_blank"
      rel="noreferrer"
      title={t("openFullSize")}
      className={cn(
        "group relative block overflow-hidden rounded-md border bg-muted",
        className,
      )}
    >
      <span
        aria-hidden
        className="block size-full bg-no-repeat transition-transform duration-200 group-hover:scale-105"
        style={{
          backgroundImage: `url(${imageUrl})`,
          backgroundPosition: "center",
          ...crop,
        }}
      />
      <span className="absolute right-1 bottom-1 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <Maximize2 className="size-3" aria-hidden />
      </span>
    </a>
  );
}

/**
 * A little air around the box.
 *
 * A crop pared exactly to the mark is disorienting — you cannot tell a struck
 * 6 from a struck 46 without the column heading or the rows above it. The
 * padding is in thousandths of the whole image, so it stays visually constant
 * whatever the box's size.
 */
const PADDING = 12;

function cropStyle(region: Region): React.CSSProperties {
  const [yMin, xMin, yMax, xMax] = region;

  const top = clamp(Math.min(yMin, yMax) - PADDING);
  const left = clamp(Math.min(xMin, xMax) - PADDING);
  const bottom = clamp(Math.max(yMin, yMax) + PADDING);
  const right = clamp(Math.max(xMin, xMax) + PADDING);

  /*
    A degenerate box — the two corners equal, or the model returning the whole
    page — would divide by zero or zoom to nothing. Floor the fractions rather
    than refuse: a crop that is merely too wide still shows the right part.
  */
  const width = Math.max((right - left) / 1000, 0.03);
  const height = Math.max((bottom - top) / 1000, 0.03);

  /*
    The percentage form of `background-position` aligns the same percentage of
    the image with that percentage of the box, so the offset is the crop's
    start as a fraction of the room it has to move in — not of the image.
  */
  const positionX = width >= 1 ? 50 : (left / 1000 / (1 - width)) * 100;
  const positionY = height >= 1 ? 50 : (top / 1000 / (1 - height)) * 100;

  return {
    backgroundSize: `${100 / width}% ${100 / height}%`,
    backgroundPosition: `${clampPercent(positionX)}% ${clampPercent(positionY)}%`,
  };
}

const clamp = (value: number) => Math.min(1000, Math.max(0, value));
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * The strip of the ladder holding one rung.
 *
 * The four printed blocks are forty rows each, evenly spaced, so a total maps
 * to a row by arithmetic rather than by anything the model has to report. A
 * few rows either side come too: the point is to show the reader *this* rung
 * among its neighbours, which is how you tell you are in the right column.
 */
export function ladderRowRegion(
  regions: (Region | null)[] | null | undefined,
  total: number,
  rowsEitherSide = 3,
): Region | null {
  const block = Math.floor((total - 1) / 40);
  const region = regions?.[block] ?? null;
  if (!region) return null;

  const [yMin, xMin, yMax, xMax] = region;
  const top = Math.min(yMin, yMax);
  const height = Math.abs(yMax - yMin);
  if (height <= 0) return region;

  /*
    The block's box includes the printed A/B heading above the first row, so
    the rows occupy the part below it. The fraction is the heading's share of
    one of these blocks on a FIP sheet; being a little out costs a row of
    context at the edge of the crop and nothing else.
  */
  const headingShare = 0.06;
  const rowsTop = top + height * headingShare;
  const rowHeight = (height * (1 - headingShare)) / 40;

  const row = (total - 1) % 40;
  const from = rowsTop + rowHeight * Math.max(0, row - rowsEitherSide);
  const to = rowsTop + rowHeight * Math.min(40, row + rowsEitherSide + 1);

  /*
    Wider than the block the model reported. It boxes the printed totals, but
    the scorers' numbers are written in the columns on either side of them —
    and those numbers are the whole question. A third of the block's width
    each way picks them up without reaching the next block.
  */
  const left = Math.min(xMin, xMax);
  const right = Math.max(xMin, xMax);
  const bleed = (right - left) * 0.35;

  return [from, clamp(left - bleed), to, clamp(right + bleed)];
}
