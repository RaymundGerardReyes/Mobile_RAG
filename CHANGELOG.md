# Changelog
All notable changes to this project will be documented in this file.

## [app v0.3.0] - 2026-10-16

### Added
- **CSC Design System Motion & Tactile Tokens (`mobile/src/theme/tokens.ts`)**:
  - Refined motion tokens with exact CSC spring parameters (`stiffness: 300, damping: 22, mass: 0.7`).
  - Added subtle/standard/pronounced distance tokens (`6pt`, `10pt`, `16pt`) and press opacity feedback (`0.88`).
  - Enhanced color tokens with WCAG AA compliance documentation.
- **Enhanced Animated Core Primitives (`mobile/src/components/CorePrimitives.tsx`)**:
  - `CSCButton`: Dual spring scale (`0.98`) and 120ms opacity (`0.88`) press feedback with 120ms cross-fade fallback for Reduce Motion.
  - `ContentCard`: 6pt vertical entrance animation with `Easing.out(Easing.cubic)`.
  - `CSCChipBadge`: Accessible 8pt radius badge supporting neutral, brand blue, and 5% CSC Red dot/border accent paired with high-contrast dark text (`#191D2E`) achieving 100% WCAG AA compliance (>12:1 contrast ratio).
  - `AnimatedChoiceRow` / `AnimatedChoiceCard`: Tactile 12pt radius multiple-choice row with 120ms press feedback and semantic grading states.
  - `AnimatedProgressBar`: Smooth 200ms ease-out progress bar using `useNativeDriver: true`.
- **Upgraded Quiz Review Screen (`mobile/src/features/quiz/QuizReviewScreen.tsx`)**:
  - Aligned props and state directly with `ReviewSessionController` (supporting both Feature A `ExplainMore` and Feature B `InterpretFreeAnswer`).
  - Integrated `AnimatedProgressBar` and `AnimatedChoiceRow` with staggered entrance.
  - Implemented focused state on free-text `TextInput`.
  - Added semantic rubric evaluation display (matched/missing concept badges, confidence score, and guardrail alerts).
  - Added celebration Session Complete Summary Card.
  - Exported `ConnectedQuizReviewScreen` (alias `QuizSessionContainer`) matching architectural Pattern C.
- **Reviewer Home Dashboard (`mobile/src/features/review/ReviewHomeScreen.tsx`)**:
  - Main dashboard displaying topic progress summaries, study mode selection (`All`, `Unanswered`, `Weak Areas`), and offline AI model readiness pill.
  - Exported `ConnectedReviewHomeScreen` (alias `HomeDashboardScreen`).
- **Test Suites**:
  - Added unit test suites verifying token contrast math, CorePrimitives exports, and screen container contracts.

## [app v0.2.0] - 2026-10-16

### Added
- **CSC Anniversary Design System & Motion Tokens (`mobile/src/theme/tokens.ts`)**:
  - Pure TypeScript tokens implementing strict 80/15/5 visual weight distribution.
  - 4pt base grid spacing, concentric border radii, iOS SF Pro typography, and spring animation parameters.
- **Composition Root Controller (`mobile/src/app/review_session_controller.ts`)**:
  - State management coordinating all 9 use cases (session progression, deterministic scoring, textbook context retrieval, streaming AI explanation, and abortable semantic grading).
  - Reactive `subscribe()` mechanism and integrated `AbortController` generation cancellation.
- **Expo SQLite Driver (`mobile/src/data/sqlite/expo_sqlite_database.ts`)**:
  - Adapter connecting native `expo-sqlite` (v14+ / SDK 51+) to the pure application port `SqliteDatabase`.
- **Core UI Primitives (`mobile/src/components/CorePrimitives.tsx`)**:
  - `CSCButton`: Apple HIG tactile button with $\ge 44\text{pt}$ touch targets and spring press feedback.
  - `ContentCard`: 16pt border radius container with hairline border.
  - `useReducedMotion`: Dynamic accessibility hook respecting system Reduce Motion settings.
- **Quiz Review Screen (`mobile/src/features/quiz/QuizReviewScreen.tsx`)**:
  - Full review screen with multiple-choice radio rows, identification inputs, deterministic score banners, textbook passage pills (`[Page 25]`), and bilingual on-device AI elaboration.
- **Defense-in-Depth Schema Migration Safeguard**:
  - Added `score REAL NOT NULL DEFAULT 0.0` natively to `training/src/ai_tutor_training/content_pack.py` DDL.
  - Added dynamic `ALTER TABLE answer_attempts ADD COLUMN score ...` check in `mobile/src/application/use_cases/initialize_app.ts`.
- **Test Suites**:
  - 13 new unit tests covering controller lifecycle, legacy DB migration, and Expo SQLite adapter (123 total tests passing).
