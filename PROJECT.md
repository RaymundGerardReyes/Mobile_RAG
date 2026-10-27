# Project: Probabilistic RAG UI & Consensus Showcase

## Architecture
- **Layered Mobile Architecture**:
  - **Domain / Ports Layer (`mobile/src/application/ports/`)**: Contracts for repositories, passage retrievers, and LLM ports.
  - **Use Case Layer (`mobile/src/application/use_cases/`)**: Application orchestrations including `InterpretFreeAnswer.execute()` and `InterpretFreeAnswer.executeConsensus()`.
  - **AI Runtime / Evaluation Layer (`mobile/src/ai/`)**: Output validator (`output_validator.ts`), prompt builder (`prompt_builder.ts`), and local LLM runtime (`local_llm_service.ts`).
  - **Data Layer (`mobile/src/data/`)**: SQLite storage, FTS5 BM25 search, and 3-tier progressive passage retriever (`sqlite_passage_retriever.ts`).
  - **Presentation Layer (`mobile/src/components/`, `mobile/src/features/`)**: Reusable UI primitives (`ProbabilisticRagPrimitives.tsx`), screen controllers, and `QuizReviewScreen.tsx`.
  - **Test Suite (`mobile/tests/`)**: Node.js native `node:test` + strict assertions compiled via `tsc` to ESM in `dist/`.

## Feature Inventory
Every feature identified during the Survey phase:
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `ProbabilisticRagPrimitives` | Reusable component library housing `<RetrievalTierBadge>`, `<BestOfNConsensusCard>`, and `<FollowUpClarificationBar>` | M1 | Survey (UI Explorer) |
| 2 | `<RetrievalTierBadge>` | Status chips mapping 5 retrieval tiers (`tier1_direct`, `tier2_strict_and`, `tier3_broad_or`, `linked`, `fts5`) to WCAG-compliant styling with indicator dot | M1 | Survey (UI Explorer, Spec Miner) |
| 3 | WCAG AA/AAA Contrast Verification | Mathematical verification that all tier badge text/surface combinations exceed 4.5:1 (AA) and up to 15.06:1 (AAA) | M1 | Survey (UI Explorer, Spec Miner) |
| 4 | `<BestOfNConsensusCard>` | Visual card rendering proportional voting distribution bar for N=3, average confidence meter, and 4-tier guardrail matrix | M1 | Survey (UI Explorer) |
| 5 | `<FollowUpClarificationBar>` | Interactive distractor quick-ask chips ("Why is Choice X wrong?") and HIG 44pt custom query input triggering iterative RAG | M1 | Survey (UI Explorer) |
| 6 | `ConsensusEvaluationBreakdown` Model | Data interface capturing `runId`, `numSamples`, `samples`, `verdictDistribution`, `winningVerdict`, `agreementRate`, `averageConfidence`, `winningEvaluation`, and `guardrailSummary` | M1 | Survey (Use Case Explorer) |
| 7 | `InterpretFreeAnswer.executeConsensus()` | Use case method performing sequential stochastic sampling ($N=3$, $T=0.7$) satisfying single-active LLM generation invariant, with aggregate confidence tie-breaking | M1 | Survey (Use Case Explorer, Spec Miner) |
| 8 | `PassageRetriever` Interface Alignment | Update `PassageRetriever` port and `RetrievedPassage` with optional `tier` and `retrieveIterativeEvidence` | M1 | Survey (Use Case Explorer) |
| 9 | `QuizReviewScreen` Evidence Badge Mount | Mount `<RetrievalTierBadge>` on supporting evidence passages (`supportingPassages`) | M1 | Survey (UI Explorer) |
| 10 | `QuizReviewScreen` Clarification Bar Mount | Mount `<FollowUpClarificationBar>` on AI tutor explanation card (`aiExplanation` / `streamingAiText`) | M1 | Survey (UI Explorer) |
| 11 | `QuizReviewScreen` Consensus Card Mount | Mount `<BestOfNConsensusCard>` on free answer rubric evaluation (`freeAnswerEvaluation`) | M1 | Survey (UI Explorer) |
| 12 | Automated Consensus Unit Tests | Unit tests in `mobile/tests/ai/probabilistic_consensus.test.ts` verifying `executeConsensus` sampling, voting distribution, tie-breaking, confidence averaging, and guardrail summaries | M1 | Survey (Spec Miner) |
| 13 | Automated Tier Badge Mapping Tests | Unit tests in `mobile/tests/ai/probabilistic_consensus.test.ts` verifying 5 tier badge mappings, indicator dots, and WCAG contrast compliance | M1 | Survey (Spec Miner) |
| 14 | 5-Tier Mobile Verification Pipeline | Validation across Expo Doctor (20 checks), Type Check (`tsc --noEmit`), Build (`tsc`), Test Suite (`npm test`), and Metro Hermes Export (`npx expo export`) | M1 | Survey (Spec Miner) |

## Milestones
| # | Name | Scope | Dependencies | Status | Outputs |
|---|------|-------|-------------|--------|---------|
| 1 | Full Probabilistic Consensus Capability Showcase | Implementation of R1 (`ProbabilisticRagPrimitives.tsx`), R2 (`interpret_free_answer.ts`), R3 (`QuizReviewScreen.tsx`), R4 (`probabilistic_consensus.test.ts`), and 5-Tier Mobile Verification | none | DONE | `ProbabilisticRagPrimitives.tsx`, `interpret_free_answer.ts`, `passage_retriever.ts`, `QuizReviewScreen.tsx`, `probabilistic_consensus.test.ts`, `adversarial_consensus.test.ts` (110/110 tests pass, 20/20 expo-doctor checks pass) |

## Interface Contracts

### 1. `mobile/src/components/ProbabilisticRagPrimitives.tsx`
```typescript
export type RetrievalTier =
  | 'tier1_direct'
  | 'tier2_strict_and'
  | 'tier3_broad_or'
  | 'linked'
  | 'fts5';

export interface RetrievalTierBadgeProps {
  tier: RetrievalTier;
  showDot?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export interface BestOfNConsensusCardProps {
  breakdown: ConsensusEvaluationBreakdown;
  style?: StyleProp<ViewStyle>;
}

export interface FollowUpClarificationBarProps {
  choices?: Choice[];
  canonicalChoiceId?: string | null;
  selectedChoiceId?: string | null;
  isLoading?: boolean;
  onAskDistractor: (choice: Choice) => void;
  onCustomQuerySubmit: (query: string) => void;
  style?: StyleProp<ViewStyle>;
}
```

### 2. `mobile/src/application/use_cases/interpret_free_answer.ts`
```typescript
export interface ConsensusGuardrailSummary {
  malformedJsonCount: number;
  hallucinatedEvidenceCount: number;
  lowConfidenceCount: number;
  passedCount: number;
  allPassed: boolean;
}

export interface ConsensusEvaluationBreakdown {
  runId: string;
  questionId: string;
  studentAnswer: string;
  numSamples: number;
  samples: ValidatedVerdictResult[];
  verdictDistribution: Record<FreeAnswerVerdictType, number>;
  winningVerdict: FreeAnswerVerdictType;
  averageConfidence: number;
  agreementRate: number;
  winningEvaluation: ValidatedVerdictResult;
  guardrailSummary: ConsensusGuardrailSummary;
  durationMs: number;
}

// Added to InterpretFreeAnswer class:
executeConsensus(
  questionId: string,
  studentAnswer: string,
  numSamples?: number,
  signal?: AbortSignal
): Promise<ConsensusEvaluationBreakdown>;
```

## Code Layout
- Exclusive Write Ownership:
  - `mobile/src/components/ProbabilisticRagPrimitives.tsx`: Worker owns creation of the 3 UI primitives and `RETRIEVAL_TIER_CONFIG`.
  - `mobile/src/application/use_cases/interpret_free_answer.ts`: Worker owns implementation of `executeConsensus` and consensus types.
  - `mobile/src/application/ports/passage_retriever.ts`: Worker owns addition of `RetrievalTierType` and `IterativeEvidenceResult` declarations.
  - `mobile/src/features/quiz/QuizReviewScreen.tsx`: Worker owns mounting of the 3 primitives into their designated sections.
  - `mobile/tests/ai/probabilistic_consensus.test.ts`: Worker / Test Writer owns creation of automated unit tests.
