import "./style.css";
import { IDENTITY } from "./identity";

// The About page follows the hand it was opened from.
const hand = document.documentElement.dataset.hand === "right" ? "right" : "left";
const id = IDENTITY[hand];
for (const el of document.querySelectorAll(".site-name")) el.textContent = id.name;
document.title = `About ${id.name}: sources and method`;
(document.getElementById("favicon") as HTMLLinkElement).href = id.icon;
if (hand === "right") (document.getElementById("home") as HTMLAnchorElement).href = "/?hand=right";
