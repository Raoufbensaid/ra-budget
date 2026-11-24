import type { TFunction } from "i18next";

/** Codes d'erreur renvoyés par les fonctions Team de la base. */
const KNOWN = [
  "forbidden",
  "invalid_name",
  "invalid_email",
  "team_locked",
  "too_many_invitations",
  "already_member",
  "cannot_remove_owner",
  "owner_cannot_leave",
  "team_has_expenses",
] as const;

type TeamErrorCode = (typeof KNOWN)[number];

function codeOf(error: unknown): TeamErrorCode | null {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return (KNOWN as readonly string[]).includes(message) ? (message as TeamErrorCode) : null;
}

/** Texte à afficher pour une erreur d'une action sur une Team. */
export function teamErrorMessage(error: unknown, t: TFunction): string {
  const code = codeOf(error);
  return code ? t(`teams.errors.${code}`) : t("teams.errors.generic");
}
