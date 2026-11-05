/**
 * Build the lazy-loaded Latin-name subset from the GBIF Backbone Taxonomy.
 *
 * Subset: accepted genera that have at least one accepted species, excluding viruses
 * and names already in WordNet. Genus names are single Latin words, which is what the
 * one-hand filter matches; species epithets repeat across genera ("vulgaris") and
 * binomials are two words. Ranked by accepted-species count, so large, well-known
 * genera come first. Each genus also gets a WordNet "X genus" synset as its category
 * parent, so the category filter can reach Latin names too.
 *
 * Input:  data/raw/gbif/backbone.zip (GBIF Backbone Taxonomy, 2023-08-28, CC BY 4.0)
 * Output: data/build/latin.json
 * Needs:  `unzip` on PATH (Git Bash, macOS and Linux ship it).
 */
import { join } from "node:path";
import { Taxonomy, type SensesFile, type WordsFile } from "../src/engine/lexicon";

const ROOT = join(import.meta.dir, "..");
const ZIP = join(ROOT, "data/raw/gbif/backbone.zip");

const senses = new Taxonomy((await Bun.file(join(ROOT, "data/build/senses.json")).json()) as SensesFile);
const wordnet = new Set(((await Bun.file(join(ROOT, "data/build/words.json")).json()) as WordsFile).words.toLowerCase().split("\n"));

/** WordNet synset ids for the "X genus" categories. */
const WN = {
  genus: "08125938-n",
  bacteria: "01355215-n",
  protoctist: "01390771-n",
  fish: "01435158-n",
  chordate: "01469637-n",
  bird: "01509816-n",
  amphibian: "01629241-n",
  reptile: "01660364-n",
  arthropod: "01765166-n",
  mammal: "01867348-n",
  sponge: "01909675-n",
  coelenterate: "01911056-n",
  ctenophore: "01920793-n",
  worm: "01924528-n",
  mollusk: "01942239-n",
  echinoderm: "02318832-n",
  moss: "11558337-n",
  gymnosperm: "11574626-n",
  monocot: "11577308-n",
  dicot: "11587862-n",
  fungus: "11612597-n",
  plant: "11765328-n",
  fern: "13187976-n",
} as const;
for (const [k, id] of Object.entries(WN)) if (senses.indexOf(id) === undefined) throw new Error(`missing WordNet synset ${k} ${id}`);

const FISH = new Set(["Actinopterygii", "Elasmobranchii", "Holocephali", "Sarcopterygii", "Myxini", "Petromyzonti", "Cephalaspidomorphi", "Coelacanthi", "Dipneusti"]);
const REPTILE = new Set(["Reptilia", "Squamata", "Testudines", "Crocodylia", "Sphenodontia"]);
const WORM = new Set(["Annelida", "Nematoda", "Platyhelminthes", "Nemertea", "Acanthocephala", "Sipuncula", "Nematomorpha", "Chaetognatha"]);
const MOSS = new Set(["Bryophyta", "Marchantiophyta", "Anthocerotophyta"]);
const FERN = new Set(["Polypodiopsida", "Lycopodiopsida"]);
const GYMNO = new Set(["Pinopsida", "Cycadopsida", "Ginkgoopsida", "Gnetopsida"]);

function category(kingdom: string, phylum: string, cls: string): keyof typeof WN {
  switch (kingdom) {
    case "Bacteria":
    case "Archaea":
      return "bacteria";
    case "Chromista":
    case "Protozoa":
      return "protoctist";
    case "Fungi":
      return "fungus";
    case "Plantae":
      if (MOSS.has(phylum)) return "moss";
      if (FERN.has(cls)) return "fern";
      if (GYMNO.has(cls)) return "gymnosperm";
      if (cls === "Liliopsida") return "monocot";
      if (cls === "Magnoliopsida") return "dicot";
      return "plant";
    case "Animalia":
      if (cls === "Mammalia") return "mammal";
      if (cls === "Aves") return "bird";
      if (REPTILE.has(cls)) return "reptile";
      if (cls === "Amphibia") return "amphibian";
      if (FISH.has(cls)) return "fish";
      if (phylum === "Chordata") return "chordate";
      if (phylum === "Arthropoda") return "arthropod";
      if (phylum === "Mollusca") return "mollusk";
      if (phylum === "Porifera") return "sponge";
      if (phylum === "Cnidaria") return "coelenterate";
      if (phylum === "Ctenophora") return "ctenophore";
      if (phylum === "Echinodermata") return "echinoderm";
      if (WORM.has(phylum)) return "worm";
      return "genus";
    default:
      return "genus";
  }
}

interface Genus {
  name: string;
  /** "Family · Order · Class · Phylum · Kingdom", skipping blanks. */
  lineage: string;
  cat: keyof typeof WN;
}

const genera = new Map<string, Genus>();
const species = new Map<string, number>();
// Columns: taxonID datasetID parentNameUsageID acceptedNameUsageID originalNameUsageID scientificName
// scientificNameAuthorship canonicalName genericName specificEpithet infraspecificEpithet taxonRank
// nameAccordingTo namePublishedIn taxonomicStatus nomenclaturalStatus taxonRemarks kingdom phylum class order family genus
const proc = Bun.spawn(["unzip", "-p", ZIP, "Taxon.tsv"], { stdout: "pipe" });
const decoder = new TextDecoder();
let rest = "";
let header = true;
for await (const chunk of proc.stdout) {
  const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
  rest = lines.pop()!;
  for (const line of lines) {
    if (header) {
      header = false;
      continue;
    }
    const c = line.split("\t");
    if (c[14] !== "accepted") continue;
    const rank = c[11];
    if (rank === "species") {
      const g = c[8]!;
      species.set(g, (species.get(g) ?? 0) + 1);
    } else if (rank === "genus") {
      const name = c[7]!;
      const [kingdom, phylum, cls, order, family] = [c[17]!, c[18]!, c[19]!, c[20]!, c[21]!];
      if (kingdom === "Viruses" || !/^[A-Z][a-z]+$/.test(name)) continue;
      const g: Genus = { name, lineage: [family, order, cls, phylum, kingdom].filter(Boolean).join(" · "), cat: category(kingdom, phylum, cls) };
      // Homonyms across kingdoms (Morus the gannet, Morus the mulberry): keep the first, note the other.
      const prev = genera.get(name);
      if (!prev) genera.set(name, g);
      else if (!prev.lineage.includes(" / ")) prev.lineage += ` / ${g.lineage}`;
    }
  }
}
await proc.exited;

const kept = [...genera.values()]
  .filter((g) => (species.get(g.name) ?? 0) > 0 && !wordnet.has(g.name.toLowerCase()))
  .sort((a, b) => species.get(b.name)! - species.get(a.name)! || (a.name < b.name ? -1 : 1));

// Lineages repeat a lot (one per family), so store each once and point at it.
// A lineage fixes the category, so the category is stored per lineage.
const lineages: string[] = [];
const lineageCat: number[] = [];
const lineageIndex = new Map<string, number>();
const cats = Object.keys(WN) as (keyof typeof WN)[];
const lineageOf = kept.map((g) => {
  let li = lineageIndex.get(g.lineage);
  if (li === undefined) {
    lineageIndex.set(g.lineage, (li = lineages.push(g.lineage) - 1));
    lineageCat.push(cats.indexOf(g.cat));
  }
  return li;
});

await Bun.write(
  join(ROOT, "data/build/latin.json"),
  JSON.stringify({
    source: "GBIF Backbone Taxonomy 2023-08-28 (CC BY 4.0): accepted genera with at least one accepted species",
    names: kept.map((g) => g.name).join("\n"),
    species: kept.map((g) => species.get(g.name)!),
    lineage: lineageOf,
    lineages,
    lineageCat,
    /** WordNet synset id per category index. */
    categories: cats.map((k) => WN[k]),
  }),
);
console.log(`genera ${genera.size}, kept ${kept.length}, lineages ${lineages.length}`);
