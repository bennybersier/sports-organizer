# Reading a FIP referto

How to turn a photographed Italian game sheet into rows in this database, and
how to know when you have read it wrong.

Written for whoever builds the game-sheet upload. It is a specification of the
document, not of the UI.

The worked example throughout is **gara 9714**, Future Basket Lodigiano vs
Brescia Academy, Under 13 Gold, 18 October 2026 — imported by hand to prove the
rules below hold.

---

## 1. What the document is

The *referto ufficiale di gara* is the scorer's sheet, filled in by hand during
the match and signed by the referees. One A4 side holds the whole game. It
arrives as a phone photograph, usually at an angle, often at a resolution where
a 6 and an 8 are the same shape.

That last point decides the design. **Every field must be validated against
another field on the same sheet**, because optical confidence is not available
and a plausible misreading is indistinguishable from a correct one. Section 5
is the important part of this document.

---

## 2. Header

| Field | Where | Example |
|---|---|---|
| Game number | `GARA N.` top left | 9714 |
| Clubs | `Denominazione Sociale`, A then B | Future Basket Lodigiano / ASD Brescia Academy |
| Competition | `Campionato` + `Girone` | Under 13 Gold, girone C |
| Date, time | `Data`, `Ore` | 18-10-2026, 11:00 |
| Venue | `Campo` | Palazzetto dello Sport Codogno |
| Referees | `1° Arbitro`, `2° Arbitro` | Mascia Leonardo |

**Squadra A is the home side.** Shirt colours are given (`COLORE MAGLIA`), which
is how you tell the two roster blocks apart if the photo is cropped.

Bottom right carries the period scores and the final:

```
1º Quarto A 16  B 12        RISULTATO FINALE
2º Quarto A 20  B 13          FBL           67
3º Quarto A 15  B 19          ASD BRESCIA   59
4º Quarto A 16  B 15
```

These are the checksums. Read them first.

---

## 3. Roster block

One block per team, twelve rows, columns:

```
ANNO NASC | Cognome | Nome | N. | E/N. | FALLI 1 2 3 4 5
```

- **ANNO NASC** is the last two digits of the birth year (`14` → 2014). It is a
  registration year, not a date of birth — do not invent one.
- **Nome** is usually an initial only (`E.`, `K.D.`). Store what is written;
  the club can fill in full names later.
- **N.** is the shirt number. This is the key that the progressive score refers
  to, so a misread here corrupts everything downstream.
- **E/N.** carries an `X` for every player who took part.
  **A circled or struck-through `X` marks a starter.** There must be exactly
  five.
- **FALLI** records each personal foul in sequence, left to right.

### Foul notation

| Mark | Meaning |
|---|---|
| `P` | Personal foul, no free throws |
| `P1` `P2` `P3` | Personal foul awarding 1, 2 or 3 free throws |
| `T` | Technical |
| `U` | Unsportsmanlike |
| `D` | Disqualifying |

The digit is **free throws awarded to the opponent**, not the foul's sequence
number — the sequence is the column it sits in. A player with `P P2 P3` has
committed three fouls, not six.

Gara 9714, squadra A:

| # | Player | Starter | Fouls |
|---|---|---|---|
| 1 | Doko E. | ● | |
| 4 | Magistrali L. | | |
| 5 | Perin A. | ● | |
| 6 | Sotgia L. | | P1 P2 |
| 7 | Bersier L. | ● | P1 P2 |
| 8 | Sanarica S. | | |
| 9 | Rossi T. | ● | P P2 P3 |
| 13 | Russano K.D. | | |
| 14 | Scarpetta L. (cap) | ● | P P |
| 23 | Sampietro F. | | P2 |
| 33 | Guglielmetti F. | | P1 |
| 34 | Rosso A. | | |

---

## 4. Progressive score — the only hard part

`PUNTEGGIO PROGRESSIVO` is a pre-printed ladder of running totals from 1 to
160, in four blocks of forty. Each block is four columns:

```
[ A scorer ] [ A total ] [ B total ] [ B scorer ]
```

The scorer does **not** write the points a basket was worth. They strike
through the running total the team has *reached* and write the scorer's shirt
number beside it.

So the value of a basket is a **difference**:

> points = this struck total − the previous struck total for the same team

A two-pointer from 5 to 7 strikes `7` and leaves `6` untouched. A free throw
from 7 to 8 strikes `8`.

Two annotations modify this:

- **Circled scorer number** → the basket was a three-pointer. Redundant with
  the arithmetic, and therefore a free check: if the difference is 3 the number
  should be circled, and if the number is circled the difference should be 3.
- **Circled total with a line under it** → end of a period. The total is the
  team's cumulative score at that buzzer.

Do not confuse the two circles. One is in the scorer column, one in the total
column, and only the period marker is underlined.

### Worked example

Squadra A's ladder, gara 9714, read as `total → scorer → derived points`:

```
 2→7 (2)    3→7 (1)    5→9 (2)    7→7 (2)    9→14 (2)   11→9 (2)
13→34 (2)  15→14 (2)  ⟨16⟩→33 (1)            ← end Q1, 16
18→33 (2)  20→23 (2)  22→7 (2)   24→14 (2)  26→13 (2)  28→13 (2)
30→9 (2)   32→6 (2)   34→23 (2)  ⟨36⟩→14 (2)           ← end Q2, 36 (= 16+20)
38→9 (2)   40→9 (2)   42→14 (2)  44→34 (2)  46→9 (2)
49→(34) (3)                                            ← circled scorer: a three
⟨51⟩→33 (2)                                            ← end Q3, 51 (= 36+15)
53→34 (2)  54→9 (1)   55→9 (1)   57→9 (2)   59→33 (2)
60→14 (1)  61→14 (1)  63→34 (2)  65→9 (2)   66→34 (1)
⟨67⟩→34 (1)                                            ← final, 67 (= 51+16)
```

Totals:

| # | Player | 2pt | 3pt | FT | Points |
|---|---|---|---|---|---|
| 6 | Sotgia | 1 | | | 2 |
| 7 | Bersier | 3 | | 1 | 7 |
| 9 | Rossi | 8 | | 2 | **18** |
| 13 | Russano | 2 | | | 4 |
| 14 | Scarpetta | 5 | | 2 | 12 |
| 23 | Sampietro | 2 | | | 4 |
| 33 | Guglielmetti | 3 | | 1 | 7 |
| 34 | Rosso | 4 | 1 | 2 | **13** |
| | | | | | **67** |

---

## 5. Validation — refuse the import rather than guess

Each of these caught, or could have caught, a misreading of gara 9714. An
importer that does not run them will produce confident nonsense.

**Hard — reject the import**

1. **Points reconcile.** Per-player points must sum to that team's final score.
   This is the strongest check available: nearly any single misread digit
   breaks it, because the totals are differences of a chain.
2. **Period checkpoints.** The circled totals must equal the cumulative period
   scores from the box at bottom right. Four independent checks per team, which
   localise an error to a quarter.
3. **Monotonic ladder.** Struck totals must strictly increase, and each
   difference must be 1, 2 or 3. A difference of 4 means a struck total was
   missed.
4. **Known shirts.** Every scorer number must exist in that team's roster block
   **and** carry an `X`. A number that scored but did not play is a misread
   number.
5. **Five starters**, no more, no fewer.
6. **Fouls ≤ 5 per player**, and a sixth would have fouled them out.

**Soft — import, but flag for review**

7. Three-point circles agree with the differences (§4).
8. Team fouls per period are consistent with the `falli di squadra` boxes.
9. Both rosters have twelve or fewer players.

When a hard check fails, **say which one and show the arithmetic**. "Points add
to 65 but the sheet says 67 — the error is in the third quarter, between 36 and
51" is something a secretary can fix in thirty seconds against the paper. "Could
not read the sheet" is not.

---

## 6. What a referto does *not* contain

This matters, because our schema has columns for all of it:

- **No shot attempts.** Only makes are recorded. `*_attempted` therefore cannot
  be known from this document.
- **No rebounds, assists, steals, blocks or turnovers.**
- **No minutes played.** Only who entered the game.

### Consequence for `match_box_scores`

`made <= attempted` is a database constraint, so attempts cannot be left at
zero when a player scored. Set **`attempted = made`** and record that the
source was a referto.

Be aware what that does downstream: shooting percentages become 100% and are
meaningless, and `efficiency` (valutazione) degenerates to
`points − fouls_committed`, because it subtracts missed shots and there are
none recorded. **Neither number should be shown for a referto-sourced match
without a caveat.** If box scores ever arrive from a source that has attempts,
the two must be distinguishable — a `source` column on the box score is the
obvious way, and is not yet there.

---

## 7. Where it lands

| Sheet | Table |
|---|---|
| Roster rows | `athletes`, linked by `athlete_teams.jersey_number` |
| `X` in E/N. | `attendance_records.called_up = true`, `state = 'PRESENT'` |
| Circled `X` | `attendance_records.started = true` |
| FALLI count | `match_box_scores.fouls_committed` |
| Progressive score | `match_box_scores` two/three/free-throw makes |
| Header + final score | `attendance_registers` (`occasion = 'MATCH'`), notes |
| The match itself | `calendar_events`, via `fixtures.calendar_event_id` |

A register must already exist for the fixture — the sheet is evidence about a
match the club has scheduled, never the thing that creates it. Import against
`attendance_registers` for that `event_id` and `team_id`, and refuse if there is
none rather than inventing a match.

Only the club's own squadra is imported. The opponent's roster is on the sheet
and is not ours to keep.
