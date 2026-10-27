import { Passage } from '../../domain/types.js';
import { colors } from '../../theme/tokens.js';

export type RetrievalTier =
  | 'tier1_direct'
  | 'tier2_strict_and'
  | 'tier3_broad_or'
  | 'linked'
  | 'fts5';

export type RetrievalTierType = RetrievalTier;

export interface RetrievalTierConfig {
  label: string;
  shortLabel: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  dotColor: string;
  description: string;
}

export const RETRIEVAL_TIER_CONFIG: Record<RetrievalTier, RetrievalTierConfig> = {
  tier1_direct: {
    label: 'Tier 1: Direct Link',
    shortLabel: 'T1 Direct',
    textColor: colors.semantic.correct.text,
    backgroundColor: colors.semantic.correct.surface,
    borderColor: colors.semantic.correct.border,
    dotColor: colors.semantic.correct.text,
    description: 'Direct verified provenance link',
  },
  tier2_strict_and: {
    label: 'Tier 2: Strict AND',
    shortLabel: 'T2 Strict',
    textColor: colors.brand.primary,
    backgroundColor: colors.brand.tint,
    borderColor: colors.brand.border,
    dotColor: colors.brand.primary,
    description: 'Strict full-text search with conjunction of key terms',
  },
  tier3_broad_or: {
    label: 'Tier 3: Broad OR',
    shortLabel: 'T3 Broad',
    textColor: colors.semantic.warning.text,
    backgroundColor: colors.semantic.warning.surface,
    borderColor: colors.semantic.warning.border,
    dotColor: colors.semantic.warning.text,
    description: 'Broad fallback search with distractor awareness',
  },
  linked: {
    label: 'Verified Link',
    shortLabel: 'Linked',
    textColor: colors.semantic.correct.text,
    backgroundColor: colors.semantic.correct.surface,
    borderColor: colors.semantic.correct.border,
    dotColor: colors.semantic.correct.text,
    description: 'Verified curriculum database link',
  },
  fts5: {
    label: 'FTS5 BM25',
    shortLabel: 'FTS5',
    textColor: colors.neutral.textPrimary,
    backgroundColor: colors.neutral.surfaceMuted,
    borderColor: colors.neutral.borderStrong,
    dotColor: colors.neutral.textSecondary,
    description: 'Full-text BM25 statistical search ranking',
  },
};

export interface RetrievedPassage {
  passage: Passage;
  strategy: 'linked' | 'fts5';
  tier?: RetrievalTierType;
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
  retrieveIterativeEvidence?(
    questionId: string,
    stem: string,
    canonicalAnswer?: string,
    distractorText?: string,
    limit?: number
  ): Promise<{
    passages: RetrievedPassage[];
    tierUsed: 'tier1_direct' | 'tier2_strict_and' | 'tier3_broad_or' | 'none';
    iterationsRun: string[];
  }>;
}

