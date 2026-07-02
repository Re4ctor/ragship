export type MarkdownDocument = {
  id: string;
  title: string;
  content: string;
  filePath: string;
  relativePath: string;
  source: string;
  space?: string;
  page?: string;
  section?: string;
  contentHash?: string;
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  title: string;
  relativePath: string;
  section?: string;
  content: string;
  chunkIndex: number;
  tokenEstimate: number;
};

export type SimilarChunk = {
  id: string;
  content: string;
  section: string | null;
  title: string;
  relativePath: string;
  distance: number;
  score: number;
};

export type RagSource = {
  title: string;
  section: string | null;
  relativePath: string;
  score: number;
};

export type RagAnswer = {
  answer: string;
  sources: RagSource[];
  chunks: SimilarChunk[];
};
