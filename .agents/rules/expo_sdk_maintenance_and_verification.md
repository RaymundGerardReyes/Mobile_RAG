---
name: expo-sdk-maintenance-and-verification
description: Enforces Expo SDK configuration invariants, Metro import conventions, and 5-tier mobile verification (doctor, typecheck, build, test, and export).
trigger: model_decision
---

# Expo SDK Maintenance & Mobile Verification Protocol

Whenever modifying dependencies, updating Expo SDK versions, or touching mobile configurations (`mobile/`):

## 1. Expo Configuration & Schema Invariants
- **Metro Subpath Resolution**: Always import `getDefaultConfig` from `'expo/metro-config'` without a trailing `.js` extension to avoid ESM double-extension resolution errors (`metro-config.js.js`).
- **`app.json` Deprecations (SDK 58+)**:
  - Do NOT specify root `"newArchEnabled": true` (New Architecture is enabled by default in React Native 0.88+).
  - Do NOT use the legacy root `"splash"` object (migrated to `expo-splash-screen` plugin or asset definitions).
- **Tooling Alignment**: Ensure TypeScript conforms to the expected Expo SDK major release (e.g. `typescript: ~6.0.3` for Expo 58).
- **Metro SQLite `.db` Asset Bundling**:
  - Always ensure `config.resolver.assetExts` in `mobile/metro.config.js` includes `'db'` so `mobile/assets/content_pack.db` is bundled for iOS and Android builds.
- **Cross-Runtime SQLite Isolation (`db_factory.ts`)**:
  - `mobile/App.tsx` must initialize data exclusively through `openContentPackDatabase()` (`SqliteQuestionRepository` and `SqlitePassageRetriever`) and never import static JSON packs (`live_content_pack.json`) or `InMemoryQuestionRepository`.
  - When `openContentPackDatabase()` runs in a Node.js test environment without an explicit custom path, it must copy `assets/content_pack.db` to an isolated temporary file before executing `INITIAL_SCHEMA_SQL` or learner mutations so the source asset's SHA-256 digest remains immutable.

## 2. Mandatory Verification Chain
Never consider a mobile change or upgrade complete without executing all 5 validation tiers:
1. **Expo Doctor**: `npx expo-doctor` (must pass 100% of checks with 0 schema warnings).
2. **Type Check**: `npm run typecheck` (`tsc --noEmit`).
3. **Build**: `npm run build` (`tsc`).
4. **Test Suite**: `npm test` (`node --test dist/tests/**/*.test.js`).
5. **Metro Export Verification**: `npx expo export --output-dir temp-export-check` to verify iOS and Android Hermes bytecode compilation.

