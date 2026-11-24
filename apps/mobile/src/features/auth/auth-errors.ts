import type { TFunction } from "i18next";

/** Message lisible pour une erreur d'authentification Supabase. */
export function authErrorMessage(error: unknown, t: TFunction): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : "";

  switch (code) {
    case "invalid_credentials":
      return t("auth.errors.invalidCredentials");
    case "user_already_exists":
    case "email_exists":
      return t("auth.errors.userExists");
    case "weak_password":
      return t("auth.errors.weakPassword");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return t("auth.errors.rateLimit");
    case "otp_expired":
      return t("auth.errors.badCode");
    case "email_address_invalid":
    case "validation_failed":
      return t("auth.errors.invalidEmail");
    case "otp_disabled":
    case "signup_disabled":
      return t("auth.errors.unknownAccount");
  }
  if (/network|fetch/i.test(message)) return t("auth.errors.network");
  return t("auth.errors.generic");
}

export function isEmailNotConfirmed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "email_not_confirmed"
  );
}
