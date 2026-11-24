import type { TFunction } from "i18next";

const KNOWN = [
  "forbidden",
  "team_locked",
  "invalid_member",
  "invalid_shares",
  "invalid_expense",
  "expense_cancelled",
  "stale_version",
  "not_concerned",
  "reason_required",
  "invalid_receipt",
] as const;

/** Texte à afficher pour une erreur d'une action sur une dépense de Team. */
export function expenseErrorMessage(error: unknown, t: TFunction): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return (KNOWN as readonly string[]).includes(message)
    ? t(`teamExpenses.errors.${message}`)
    : t("teamExpenses.errors.generic");
}
