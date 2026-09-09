import { describe, expect, it } from "vitest";

import { slugForFile, toCsv, type CsvColumn } from "../csv";

interface Row {
  club: string;
  note: string | null;
  matchday: number;
}

const columns: CsvColumn<Row>[] = [
  { header: "Club", value: (row) => row.club },
  { header: "Matchday", value: (row) => row.matchday },
  { header: "Note", value: (row) => row.note },
];

const body = (csv: string) => csv.replace("﻿", "").split("\r\n");

describe("toCsv", () => {
  it("leads with a byte-order mark so Excel reads it as UTF-8", () => {
    // Without this, Cantù opens as CantÃ¹ and somebody retypes the whole list.
    const csv = toCsv([{ club: "Cantù", note: null, matchday: 1 }], columns);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Cantù");
  });

  it("separates with semicolons, which is what Excel expects in Europe", () => {
    expect(body(toCsv([{ club: "Pavia", note: null, matchday: 3 }], columns))[1]).toBe(
      "Pavia;3;",
    );
  });

  it("quotes a field containing the delimiter", () => {
    const csv = toCsv([{ club: "Rovello; Porro", note: null, matchday: 1 }], columns);
    expect(body(csv)[1]).toBe('"Rovello; Porro";1;');
  });

  it("doubles quotes rather than escaping them", () => {
    // The escape CSV actually defines. A backslash would arrive literally.
    const csv = toCsv([{ club: 'The "Old" Hall', note: null, matchday: 1 }], columns);
    expect(body(csv)[1]).toBe('"The ""Old"" Hall";1;');
  });

  it("keeps a newline inside one cell rather than breaking the row", () => {
    const csv = toCsv([{ club: "A", note: "line one\nline two", matchday: 1 }], columns);
    expect(csv).toContain('"line one\nline two"');
  });

  it("writes an empty cell for a missing value", () => {
    expect(body(toCsv([{ club: "A", note: null, matchday: 0 }], columns))[1]).toBe("A;0;");
  });

  it("writes the header even when there is nothing to export", () => {
    expect(body(toCsv([], columns))).toEqual(["Club;Matchday;Note"]);
  });
});

describe("slugForFile", () => {
  it("strips accents and punctuation", () => {
    expect(slugForFile("Under 19 Eccellenza — girone A")).toBe("under-19-eccellenza-girone-a");
    expect(slugForFile("Sant'Angelo Lodigiano")).toBe("sant-angelo-lodigiano");
  });
});
