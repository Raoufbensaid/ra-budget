/**
 * Choix « Continuer sans compte », gardé pendant que l'application est ouverte.
 * Sans ce choix, une personne non connectée arrive sur l'écran de connexion.
 */
let chosen = false;

export function chooseGuest(): void {
  chosen = true;
}

export function guestChosen(): boolean {
  return chosen;
}
