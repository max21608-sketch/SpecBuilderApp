# Found in use

A running record of things that need fixing, written down as they are found so
they stop being fixed one at a time out of order.

**This file plans nothing.** Each entry says what was seen, where, and what is
actually wrong — enough that somebody can later group these into a plan without
re-diagnosing them. No entry is a design, and no entry is a promise about how it
gets fixed. Nothing here is fixed unless its own line says so.

Asked for on 2026-09-18: "I just end up fixing this little thing, this little
thing, this little thing, and I have so many agents going and so many people
working on the project."

**How to add one.** Newest section at the top, one `###` per finding, dated by
when it was SEEN. Say what was on the screen, not what you think the cause is —
and where you do name a cause, say so separately, because a wrong diagnosis
written as fact is what sends the fix to the wrong file. Never delete an entry;
mark it FIXED with the date and the commit.

---

## 2026-09-18

### A gate's count folds "nowhere to record it" into "outstanding"

**Status: open.** Seen on a record screen (screenshot), Armchair, lounge @ suite
living area — `Uph · Armchairs Benches Stools Sofas`, level Simple.

The pill reads **`TGQ 2 outstanding`**. Reading the list underneath it, exactly
one row is work anybody can do:

| Row | Badge |
|---|---|
| Product code | Nowhere to record it |
| Spec notes | Outstanding |
| Swivel mechanism | N/A |
| the other nine TGQ rows | Settled |

So the 2 is **Spec notes + Product code**, and a reviewer looking for two
questions to answer finds one.

**N/A is NOT the cause**, and this is worth stating because it was the first
suspicion. `outstanding()` in `src/components/records/GatePanel.tsx` is
`counts.blocking + counts.unknown + counts.unanswerable` — `not_applicable` is
already excluded, and Swivel mechanism is correctly contributing nothing.

What is happening is that `unanswerable` — *the app has nowhere to record this,
the fix is a seed or a migration and no reviewer can help* — is counted in the
same number as `blocking`, under the same word. The panel ALREADY breaks that
split out in words, but **only for a predecessor gate**: the "TG0 · TGQ first"
line renders "n to answer" beside "n nowhere to record" (`GatePanel.tsx`, the
comment at the `c.unanswerable > 0` branch). The gate whose turn it actually is
gets the folded number.

`src/lib/gates.ts` is not wrong here and should not be the first place anybody
looks: `unanswerable` counting against a gate is deliberate and documented —
folding it into `satisfied` would pass a gate over fields nobody can record.
The question is what the COUNT ON THE PILL says, not whether the gate is met.

Related and not the same thing: `Product code` is `unanswerable` on all 179
sandbox records that have a matrix view, so this reads on nearly every record,
not just this one.

### There is nowhere to record Product code

**Status: open.** The same screenshot, first row of TGQ: *"On Matthew's matrix
with no BWS field and no home in this app yet."*

One of the ten id-less rows in Matthew's matrix of 2026-09-17. Because the gates
chain, a TGQ nobody can satisfy means **no record in the sandbox can reach TG0
or TG1** — measured 2026-09-18, all 179 records with a matrix view. Every gate
tick in the sandbox is gone, correctly.

Asked for directly on 2026-09-18: **build the Product code field in the app.**

Two things a later plan has to settle rather than assume, both already written
down elsewhere:

- Matthew's own matrix says the product code is *"derived automatically: if MF1
  or MF2 is populated"* — the with-Metalwork / Simple pair — which is why
  `spec_field_gates` carries no palette key for it. Whether it is a field
  somebody answers, or a derivation off `bws_boilerplates` (0031) that the gate
  reads, is the actual decision.
- `src/lib/quote-lines.ts` already derives a boilerplate and **deliberately
  derives nothing when the code is ambiguous** — our
  `armchairs-benches-stools-sofas` is one sheet receiving three of Matthew's
  nine codes. Whatever records a product code has to behave the same way there.

Do NOT close this by weakening the gate chain to get the ticks back.
