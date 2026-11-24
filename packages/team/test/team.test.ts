import { describe, expect, it } from "vitest";
import {
  approvalState,
  type Balance,
  buildShares,
  canConfirm,
  computeBalances,
  planRepayments,
  repaymentProgress,
  requiredApprovers,
  splitEqual,
  type TeamExpense,
  type Transfer,
  validateShares,
} from "../src";

let seq = 0;
function expense(
  paidBy: string,
  totalCents: number,
  beneficiaries: string[],
  status: TeamExpense["status"] = "validated",
): TeamExpense {
  seq++;
  return {
    id: `e${seq}`,
    paidBy,
    totalCents,
    shares: splitEqual(totalCents, beneficiaries),
    status,
  };
}

/** Applique les virements aux soldes et renvoie les soldes restants. */
function applyTransfers(balances: Balance[], transfers: Transfer[]): Map<string, number> {
  const left = new Map(balances.map((b) => [b.memberId, b.balanceCents]));
  for (const t of transfers) {
    left.set(t.from, (left.get(t.from) ?? 0) + t.amountCents);
    left.set(t.to, (left.get(t.to) ?? 0) - t.amountCents);
  }
  return left;
}

describe("partage égal", () => {
  it("divise 12 € entre deux personnes", () => {
    expect(splitEqual(1200, ["A", "B"])).toEqual([
      { memberId: "A", cents: 600 },
      { memberId: "B", cents: 600 },
    ]);
  });

  it("donne les centimes restants aux premiers, dans l'ordre", () => {
    expect(splitEqual(1000, ["A", "B", "C"]).map((s) => s.cents)).toEqual([334, 333, 333]);
  });

  it("gère 1 centime et un total nul", () => {
    expect(splitEqual(1, ["A", "B", "C"]).map((s) => s.cents)).toEqual([1, 0, 0]);
    expect(splitEqual(0, ["A"]).map((s) => s.cents)).toEqual([0]);
  });
});

describe("parts personnalisées", () => {
  it("accepte des parts qui font le total", () => {
    expect(
      validateShares(1200, [
        { memberId: "A", cents: 400 },
        { memberId: "B", cents: 800 },
      ]),
    ).toBeNull();
  });

  it("refuse des parts qui ne font pas le total", () => {
    expect(
      validateShares(1200, [
        { memberId: "A", cents: 400 },
        { memberId: "B", cents: 700 },
      ]),
    ).toBe("sum_mismatch");
  });

  it("refuse les parts négatives, non entières, en double ou absentes", () => {
    expect(
      validateShares(0, [
        { memberId: "A", cents: -1 },
        { memberId: "B", cents: 1 },
      ]),
    ).toBe("negative");
    expect(validateShares(150, [{ memberId: "A", cents: 1.5 }])).toBe("not_integer");
    expect(
      validateShares(200, [
        { memberId: "A", cents: 100 },
        { memberId: "A", cents: 100 },
      ]),
    ).toBe("duplicate");
    expect(validateShares(0, [])).toBe("empty");
  });
});

describe("soldes", () => {
  it("exemple des gâteaux : B paie 12 € pour A et B", () => {
    const balances = computeBalances(["A", "B", "C"], [expense("B", 1200, ["A", "B"])]);
    expect(balances).toEqual([
      { memberId: "A", paidCents: 0, shareCents: 600, balanceCents: -600 },
      { memberId: "B", paidCents: 1200, shareCents: 600, balanceCents: 600 },
      { memberId: "C", paidCents: 0, shareCents: 0, balanceCents: 0 },
    ]);
    expect(planRepayments(balances)).toEqual([{ from: "A", to: "B", amountCents: 600 }]);
  });

  it("exemple du voyage : 300 / 180 / 120 €", () => {
    const all = ["A", "B", "C"];
    const balances = computeBalances(all, [
      expense("A", 30000, all),
      expense("B", 18000, all),
      expense("C", 12000, all),
    ]);
    expect(balances.map((b) => b.balanceCents)).toEqual([10000, -2000, -8000]);
    expect(planRepayments(balances)).toEqual([
      { from: "C", to: "A", amountCents: 8000 },
      { from: "B", to: "A", amountCents: 2000 },
    ]);
  });

  it("ignore les dépenses non validées", () => {
    const balances = computeBalances(
      ["A", "B"],
      [
        expense("A", 1000, ["A", "B"], "pending"),
        expense("A", 1000, ["A", "B"], "disputed"),
        expense("A", 1000, ["A", "B"], "cancelled"),
      ],
    );
    expect(balances.every((b) => b.balanceCents === 0 && b.paidCents === 0)).toBe(true);
  });

  it("équilibre toujours les comptes avec au plus n − 1 virements", () => {
    const members = ["A", "B", "C", "D", "E"];
    const expenses = [
      expense("A", 4999, ["A", "B", "C"]),
      expense("B", 1001, ["B", "D"]),
      expense("C", 333, members),
      expense("D", 12000, ["A", "E"]),
      expense("E", 7, ["C"]),
    ];
    const balances = computeBalances(members, expenses);
    expect(balances.reduce((s, b) => s + b.balanceCents, 0)).toBe(0);
    const transfers = planRepayments(balances);
    expect([...applyTransfers(balances, transfers).values()].every((v) => v === 0)).toBe(true);
    const nonZero = balances.filter((b) => b.balanceCents !== 0).length;
    expect(transfers.length).toBeLessThanOrEqual(nonZero - 1);
    expect(transfers.every((t) => t.amountCents > 0)).toBe(true);
  });
});

describe("suivi d'un remboursement de 200 €", () => {
  it("passe par les états attendu, déclaré, partiel puis confirmé", () => {
    expect(repaymentProgress(20000, [])).toMatchObject({
      status: "pending",
      remainingCents: 20000,
    });
    expect(repaymentProgress(20000, [{ kind: "declared", amountCents: 20000 }])).toMatchObject({
      status: "declared",
      declaredCents: 20000,
      confirmedCents: 0,
    });
    expect(repaymentProgress(20000, [{ kind: "confirmed", amountCents: 8000 }])).toMatchObject({
      status: "partial",
      remainingCents: 12000,
    });
    expect(
      repaymentProgress(20000, [
        { kind: "confirmed", amountCents: 8000 },
        { kind: "confirmed", amountCents: 12000 },
      ]),
    ).toMatchObject({ status: "confirmed", remainingCents: 0 });
  });

  it("n'autorise pas à confirmer plus que le reste", () => {
    const events = [{ kind: "confirmed" as const, amountCents: 8000 }];
    expect(canConfirm(20000, events, 12000)).toBe(true);
    expect(canConfirm(20000, events, 12001)).toBe(false);
    expect(canConfirm(20000, events, 0)).toBe(false);
  });
});

describe("buildShares (formulaire de dépense)", () => {
  it("partage à parts égales dans l'ordre des bénéficiaires", () => {
    expect(buildShares(1000, ["A", "B", "C"], "equal")).toEqual({
      shares: [
        { memberId: "A", cents: 334 },
        { memberId: "B", cents: 333 },
        { memberId: "C", cents: 333 },
      ],
    });
  });

  it("reprend des parts personnalisées valables", () => {
    expect(buildShares(1200, ["A", "B"], "custom", { A: 400, B: 800 })).toEqual({
      shares: [
        { memberId: "A", cents: 400 },
        { memberId: "B", cents: 800 },
      ],
    });
  });

  it("refuse des parts personnalisées qui ne font pas le total", () => {
    expect(buildShares(1200, ["A", "B"], "custom", { A: 400, B: 700 })).toEqual({
      error: "sum_mismatch",
    });
  });

  it("refuse un total nul ou une liste vide", () => {
    expect(buildShares(0, ["A"], "equal")).toEqual({ error: "invalid_total" });
    expect(buildShares(500, [], "equal")).toEqual({ error: "empty" });
  });
});

describe("validations", () => {
  it("met le payeur en premier, sans doublon", () => {
    expect(requiredApprovers("B", ["A", "B"])).toEqual(["B", "A"]);
    expect(requiredApprovers("C", ["A", "B"])).toEqual(["C", "A", "B"]);
  });

  it("est en attente tant que tout le monde n'a pas validé", () => {
    expect(approvalState(["B", "A"], [{ memberId: "B", decision: "approved" }])).toEqual({
      status: "pending",
      approved: ["B"],
      waiting: ["A"],
      refused: [],
    });
  });

  it("est validée quand tout le monde a validé", () => {
    expect(
      approvalState(
        ["B", "A"],
        [
          { memberId: "A", decision: "approved" },
          { memberId: "B", decision: "approved" },
        ],
      ).status,
    ).toBe("validated");
  });

  it("est contestée dès qu'une personne refuse", () => {
    const state = approvalState(
      ["B", "A"],
      [
        { memberId: "B", decision: "approved" },
        { memberId: "A", decision: "refused" },
      ],
    );
    expect(state.status).toBe("disputed");
    expect(state.refused).toEqual(["A"]);
  });

  it("ignore la décision d'une personne non concernée", () => {
    expect(
      approvalState(
        ["A"],
        [
          { memberId: "A", decision: "approved" },
          { memberId: "Z", decision: "refused" },
        ],
      ).status,
    ).toBe("validated");
  });
});
