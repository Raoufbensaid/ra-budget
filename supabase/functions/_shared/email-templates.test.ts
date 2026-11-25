import { describe, expect, it } from "vitest";
import { formatEuros, renderEmail } from "./email-templates.ts";

const site = "https://ra-budget.pages.dev/";

describe("formatEuros", () => {
  it("écrit les montants à la française", () => {
    expect(formatEuros(1200)).toBe("12,00 €");
    expect(formatEuros(123456)).toBe("1 234,56 €");
    expect(formatEuros(5)).toBe("0,05 €");
  });
});

describe("renderEmail", () => {
  it("invitation : lien /invite/<jeton> et nom de la Team", () => {
    const m = renderEmail(
      {
        kind: "team_invitation",
        payload: { token: "abc_-1", team_name: "Voyage", inviter: "Raouf" },
      },
      site,
    );
    expect(m.subject).toContain("Voyage");
    expect(m.html).toContain("https://ra-budget.pages.dev/invite/abc_-1");
    expect(m.text).toContain("https://ra-budget.pages.dev/invite/abc_-1");
    expect(m.text).toContain("Raouf");
  });

  it("validation d'un invité : lien /t/<jeton>, total et part", () => {
    const m = renderEmail(
      {
        kind: "approve_expense",
        payload: {
          token: "tok",
          team_name: "Voyage",
          title: "Courses",
          total_cents: 1200,
          share_cents: 400,
          payer: "Raouf",
          name: "Eve",
          corrected: false,
        },
      },
      site,
    );
    expect(m.subject).toBe("Valide la dépense « Courses » (Voyage)");
    expect(m.html).toContain("https://ra-budget.pages.dev/t/tok");
    expect(m.html).toContain("12,00 €");
    expect(m.html).toContain("4,00 €");
    expect(m.text).toContain("7 jours");
  });

  it("dépense corrigée : le dit dans le texte", () => {
    const m = renderEmail(
      {
        kind: "approve_expense",
        payload: {
          token: "t",
          team_name: "V",
          title: "C",
          total_cents: 1,
          share_cents: 1,
          corrected: true,
        },
      },
      site,
    );
    expect(m.text).toContain("a été corrigée");
  });

  it("membre inscrit : lien vers la dépense dans l'application, sans jeton", () => {
    const m = renderEmail(
      {
        kind: "approval_requested",
        payload: {
          team_id: "t1",
          expense_id: "e1",
          team_name: "Voyage",
          title: "Courses",
          total_cents: 1200,
          share_cents: 600,
        },
      },
      site,
    );
    expect(m.html).toContain("https://ra-budget.pages.dev/teams/t1/expenses/e1");
    expect(m.html).not.toContain("/t/");
  });

  it("échappe les textes saisis par les membres", () => {
    const m = renderEmail(
      {
        kind: "team_invitation",
        payload: { token: "x", team_name: '<script>alert("x")</script>', inviter: "A & B" },
      },
      site,
    );
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("A &amp; B");
  });

  it("refuse un type inconnu ou un lien manquant", () => {
    expect(() => renderEmail({ kind: "spam", payload: {} }, site)).toThrow("unknown_kind");
    expect(() => renderEmail({ kind: "approve_expense", payload: { title: "C" } }, site)).toThrow(
      "missing_token",
    );
  });
});
