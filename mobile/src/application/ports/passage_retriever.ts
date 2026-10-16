import { Passage } from '../../domain/types.js';

export interface RetrievedPassage {
  passage: Passage;
  strategy: 'linked' | 'fts5';
  rank?: number;
  confidence?: string;
}

export interface PassageRetriever {
  retrieveForQuestion(
    questionId: string,
    stem: string,
    limit?: number
  ): Promise<RetrievedPassage[]>;
  searchPassages(query: string, limit?: number): Promise<RetrievedPassage[]>;
}

