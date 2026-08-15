import corpusJson from "@/data/msmarco-xi-corpus.json";

export type CorpusEntry = { id: string; text: string };

/** Passages extracted from the ai4bharat/MSMARCO-XI dataset (English passages). */
export const MSMARCO_XI_CORPUS = corpusJson as CorpusEntry[];
