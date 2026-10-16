# Changelog
All notable changes to this project will be documented in this file.

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

