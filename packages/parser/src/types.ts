import type { DraftIssueCode, DraftItem } from "@ra/core";
import type { Remark } from "./remarks";

/** Ce que l'extracteur renvoie pour une phrase de l'utilisateur. */
export type ParsedUtterance =
  | AddUtterance
  | CorrectUtterance
  | RemoveUtterance
  | TotalUtterance
  | UnknownUtterance;

/** « J'ai acheté une baguette à 1,20 € chez Lidl hier » */
export interface AddUtterance {
  kind: "add";
  items: ParsedItem[];
  merchant: string | null;
  /** AAAA-MM-JJ, ou null si aucune date n'est mentionnée (l'app prendra aujourd'hui). */
  date: string | null;
  /** Prix global de plusieurs articles (« une baguette et deux croissants pour 3,40 »). */
  totalPaidCents: number | null;
  issues: ParsedIssue[];
  /** Commentaire libre (« elle est trop chère »), auquel l'assistant répond. */
  remark: Remark | null;
}

/** « Non, la baguette c'était 1,10 » / « En fait, c'était trois croissants » */
export interface CorrectUtterance {
  kind: "correct";
  /** Nom normalisé du produit visé. */
  target: string;
  changes: {
    priceCents?: number;
    quantity?: number;
  };
}

/** « Enlève les tomates » */
export interface RemoveUtterance {
  kind: "remove";
  target: string;
}

/** « J'ai payé 23,45 € en tout » */
export interface TotalUtterance {
  kind: "total";
  totalPaidCents: number;
}

/** Phrase hors sujet ou incompréhensible. */
export interface UnknownUtterance {
  kind: "unknown";
}

export type ParsedItem = Pick<
  DraftItem,
  | "rawLabel"
  | "name"
  | "quantity"
  | "unit"
  | "unitPriceCents"
  | "totalPriceCents"
  | "categoryId"
  | "confidence"
>;

export interface ParsedIssue {
  code: DraftIssueCode;
  itemIndex?: number;
}

export interface ParseOptions {
  /** Date de référence pour « hier », « samedi »… (injectée pour des tests déterministes). */
  now: Date;
}
