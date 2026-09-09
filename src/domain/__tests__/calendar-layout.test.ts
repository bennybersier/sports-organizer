import { describe, expect, it } from "vitest";

import { bucketByHour, rowDepths, type TimeSpan } from "../calendar-layout";

/** `18:00-20:00` reads like a calendar; minutes-since-midnight does not. */
const at = (start: string, end: string): TimeSpan & { id: string } => {
  const minutes = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  return { id: `${start}-${end}`, startMinutes: minutes(start), endMinutes: minutes(end) };
};

const ids = (items: (TimeSpan & { id: string })[] | undefined) => (items ?? []).map((i) => i.id);

describe("bucketByHour", () => {
  it("files a session under the hour it starts in", () => {
    const buckets = bucketByHour([at("16:30", "18:00")], 15, 23);
    expect(ids(buckets.get(16))).toEqual(["16:30-18:00"]);
  });

  it("does not repeat a long session in every hour it spans", () => {
    // Repeating it would double every long session and make "how many are on
    // at once" meaningless.
    const buckets = bucketByHour([at("19:00", "21:00")], 15, 23);
    expect(ids(buckets.get(19))).toEqual(["19:00-21:00"]);
    expect(buckets.get(20)).toBeUndefined();
    expect(buckets.get(21)).toBeUndefined();
  });

  it("keeps an hour's sessions in time order", () => {
    const buckets = bucketByHour([at("16:45", "18:00"), at("16:00", "17:30")], 15, 23);
    expect(ids(buckets.get(16))).toEqual(["16:00-17:30", "16:45-18:00"]);
  });

  it("shows a session starting before the grid rather than dropping it", () => {
    const buckets = bucketByHour([at("06:00", "08:00")], 15, 23);
    expect(ids(buckets.get(15))).toEqual(["06:00-08:00"]);
  });

  it("clamps a session starting after the last row into it", () => {
    const buckets = bucketByHour([at("23:30", "23:59")], 15, 23);
    expect(ids(buckets.get(22))).toEqual(["23:30-23:59"]);
  });

  it("returns nothing for an empty day", () => {
    expect(bucketByHour([], 15, 23).size).toBe(0);
  });
});

describe("rowDepths", () => {
  it("makes an hour as deep as its busiest day", () => {
    const depths = rowDepths(
      [
        { date: "2026-09-14", items: [at("16:30", "18:00"), at("16:00", "17:00")] },
        { date: "2026-09-15", items: [at("16:30", "18:00")] },
      ],
      15,
      18,
    );
    expect(depths.get(16)).toBe(2);
  });

  it("gives every hour the same depth across the week, so a row reads straight", () => {
    const depths = rowDepths(
      [
        { date: "a", items: [at("16:00", "17:00")] },
        { date: "b", items: [at("17:00", "18:00"), at("17:30", "18:30"), at("17:45", "19:00")] },
      ],
      16,
      18,
    );
    expect(depths.get(16)).toBe(1);
    expect(depths.get(17)).toBe(3);
  });

  it("keeps an empty hour one row deep so the scale survives", () => {
    const depths = rowDepths([{ date: "a", items: [] }], 15, 18);
    expect([...depths.values()]).toEqual([1, 1, 1]);
  });

  it("covers the club's worst evening without hiding anything", () => {
    const evening = [
      at("16:00", "18:00"), at("16:30", "18:00"), at("16:30", "18:30"),
      at("16:30", "18:00"), at("17:00", "19:00"), at("17:30", "19:00"),
      at("19:00", "21:00"), at("20:00", "22:00"), at("20:30", "22:00"),
    ];
    const depths = rowDepths([{ date: "a", items: evening }], 15, 23);

    // Four start in the 16:00 hour, so that row is four cards deep — every one
    // of them at full width.
    expect(depths.get(16)).toBe(4);
    const total = [...depths.values()].reduce((sum, depth) => sum + depth, 0);
    // Nothing is dropped: every session has a card somewhere.
    const placed = [...rowDepths([{ date: "a", items: evening }], 15, 23).keys()].reduce(
      (count, hour) => count + (bucketByHour(evening, 15, 23).get(hour)?.length ?? 0),
      0,
    );
    expect(placed).toBe(evening.length);
    expect(total).toBeGreaterThanOrEqual(evening.length);
  });
});
