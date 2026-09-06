import { describe, expect, it } from "vitest";

import { optionalText } from "../common";
import { saveRegisterSchema } from "../attendance";

describe("optionalText", () => {
  const schema = optionalText(50);

  it("accepts text and trims it", () => {
    expect(schema.parse("  hello  ")).toBe("hello");
  });

  it("treats a missing value and an explicitly empty one alike", () => {
    /*
      The two arrive from different places and mean the same thing: a control
      that was never filled in sends undefined, a row read back from the
      database and sent up again sends null. Both are "no text".
    */
    expect(schema.parse(undefined)).toBeNull();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse("")).toBeNull();
    expect(schema.parse("   ")).toBeNull();
  });

  it("still refuses text that is too long", () => {
    expect(schema.safeParse("x".repeat(51)).success).toBe(false);
  });
});

describe("a register sheet with nothing written on it", () => {
  it("saves", () => {
    /*
      The regression this exists for: every line the coach has not typed a note
      on sends `note: null`, which used to fail with a type message on
      `lines.N.note` — a path no input maps to, so the form said "check the
      highlighted fields" and highlighted nothing.
    */
    const result = saveRegisterSchema.safeParse({
      registerId: "11111111-1111-4111-8111-111111111111",
      state: "RECORDED",
      lines: [
        {
          athleteId: "22222222-2222-4222-8222-222222222222",
          state: "PRESENT",
          reason: null,
          minutesLate: null,
          calledUp: true,
          started: false,
          benchReason: null,
          note: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
