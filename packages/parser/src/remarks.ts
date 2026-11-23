/**
 * Commentaires libres sur un achat (« elle est trop chère », « c'était délicieux ») :
 * l'assistant y répond pour que la conversation reste naturelle.
 */
import { prepareInput, toKey, wordRegex } from "./text";

export type Remark = "expensive" | "cheap" | "liked" | "disliked" | "regret";

/** Ordre important : « pas cher » doit passer avant « cher ». */
const PATTERNS: [Remark, string][] = [
  [
    "cheap",
    "pas (?:tres |trop |si )?cher(?:e|s|es)?|bon marche|bonne affaire|bon prix|en promo|en promotion|en solde|en soldes|une affaire",
  ],
  [
    "expensive",
    "cher(?:e|s|es)?|hors de prix|pas donnee?s?|ruineu(?:x|se)|abuse|arnaque|excessif|ca pique|du vol|trop paye",
  ],
  [
    "disliked",
    "pas bon(?:ne|s|nes)?|pas terrible|decu|decue|degueu(?:lasse)?|immangeable|nul(?:le)?|bof",
  ],
  [
    "liked",
    "delicieu(?:x|se)|trop bon(?:ne)?s?|super bon(?:ne)?s?|tres bon(?:ne)?s?|excellent(?:e)?s?|j'adore|un regal|un delice|parfait(?:e)?",
  ],
  [
    "regret",
    "j'aurais pas du|je n'aurais pas du|j'ai craque|pas besoin|pas necessaire|achat impulsif|sur un coup de tete",
  ],
];

const COMPILED = PATTERNS.map(([remark, pattern]) => [remark, wordRegex(pattern, "iu")] as const);

export function detectRemark(input: string): Remark | null {
  const key = toKey(prepareInput(input));
  for (const [remark, regex] of COMPILED) {
    if (regex.test(key)) return remark;
  }
  return null;
}
