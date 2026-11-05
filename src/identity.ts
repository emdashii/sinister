/** Everything that changes when the hand changes: name, title, icon, copy. */
import type { Hand } from "./engine/keys";

export interface Identity {
  name: string;
  title: string;
  tagline: string;
  icon: string;
  etymology: string;
}

export const IDENTITY: Record<Hand, Identity> = {
  left: {
    name: "Sinister",
    title: "Sinister: words you can type with your left hand",
    tagline: "Words you can type with your left hand alone.",
    icon: "/icon-sinister.svg",
    etymology:
      "<p><em>Sinister</em> and <em>dexter</em> are Latin for left and right.</p>" +
      "<p>Sinister came to mean “evil” from an old superstition about the left hand. The site is named for the hand you type with: switch to the right hand and it becomes Dexter.</p>",
  },
  right: {
    name: "Dexter",
    title: "Dexter: words you can type with your right hand",
    tagline: "Words you can type with your right hand alone.",
    icon: "/icon-dexter.svg",
    etymology:
      "<p><em>Dexter</em> and <em>sinister</em> are Latin for right and left.</p>" +
      "<p>Dexter gave English “dexterous”, while sinister came to mean “evil” from an old superstition about the left hand. The site is named for the hand you type with: switch to the left hand and it becomes Sinister.</p>",
  },
};
