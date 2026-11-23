/**
 * Catégories de dépenses du MVP. Liste volontairement plate (pas de sous-catégories)
 * pour garder la catégorisation automatique fiable. Les identifiants sont stables :
 * ils sont stockés en base, ne jamais les renommer.
 */
export const CATEGORY_IDS = [
  "alimentation",
  "boissons",
  "restauration",
  "hygiene_beaute",
  "entretien_maison",
  "sante",
  "transport",
  "logement",
  "energie",
  "abonnements",
  "loisirs",
  "habillement",
  "enfants",
  "animaux",
  "high_tech",
  "education",
  "cadeaux",
  "autre",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CATEGORY_LABELS: Record<CategoryId, { fr: string; en: string }> = {
  alimentation: { fr: "Alimentation", en: "Groceries" },
  boissons: { fr: "Boissons", en: "Drinks" },
  restauration: { fr: "Restauration", en: "Eating out" },
  hygiene_beaute: { fr: "Hygiène & beauté", en: "Personal care" },
  entretien_maison: { fr: "Entretien & maison", en: "Household" },
  sante: { fr: "Santé", en: "Health" },
  transport: { fr: "Transport", en: "Transport" },
  logement: { fr: "Logement", en: "Housing" },
  energie: { fr: "Énergie", en: "Utilities" },
  abonnements: { fr: "Abonnements", en: "Subscriptions" },
  loisirs: { fr: "Loisirs", en: "Leisure" },
  habillement: { fr: "Habillement", en: "Clothing" },
  enfants: { fr: "Enfants", en: "Children" },
  animaux: { fr: "Animaux", en: "Pets" },
  high_tech: { fr: "High-tech", en: "Electronics" },
  education: { fr: "Éducation", en: "Education" },
  cadeaux: { fr: "Cadeaux", en: "Gifts" },
  autre: { fr: "Autre", en: "Other" },
};
