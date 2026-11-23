/** Outils de normalisation du texte. */

/** Retire les accents et décompose les ligatures (« œufs » → « oeufs »). */
export function stripAccents(s: string): string {
  return s
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Unifie les apostrophes typographiques (’ ‘ ` ´) en apostrophe droite. */
export function normalizeApostrophes(s: string): string {
  return s.replace(/[’‘`´]/g, "'");
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Clé de comparaison : minuscules, sans accents, espaces normalisés. */
export function toKey(s: string): string {
  return collapseSpaces(stripAccents(s.toLowerCase()));
}

/**
 * Expression régulière délimitée par des frontières de MOT compatibles avec les
 * lettres accentuées (le `\b` natif de JavaScript ne gère que l'ASCII).
 */
export function wordRegex(pattern: string, flags = "giu"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
}

/**
 * Découpe en mots. Sépare le symbole « € » (« 4€99 » → « 4 € 99 ») et les élisions
 * (« d'essence » → « d' essence »), sans toucher aux mots comme « aujourd'hui ».
 */
export function tokenize(s: string): string[] {
  const spaced = s.replace(/€/g, " € ").replace(/(?<![\p{L}])(qu|[ldjcmnst])'/giu, "$1' ");
  return collapseSpaces(spaced).split(" ").filter(Boolean);
}

/** Recolle les élisions après découpage (« d' eau » → « d'eau »). */
export function joinTokens(tokens: string[]): string {
  return tokens.join(" ").replace(/' /g, "'");
}

/** Première lettre en majuscule. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ponctuation retirée (décimales protégées) et « vingt et un » recollé en « vingt-et-un ». */
export function prepareInput(input: string): string {
  const cleaned = normalizeApostrophes(input)
    .replace(/[?!:«»"()]/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/(vingt|trente|quarante|cinquante|soixante)\s+et\s+(un|une|onze)/giu, "$1-et-$2");
  return collapseSpaces(cleaned);
}
