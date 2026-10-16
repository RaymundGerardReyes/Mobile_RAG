# Release Checklist — Offline iPhone Build

## Content pack
- [ ] All schema validations pass.
- [ ] No unresolved question/answer linkage marked as verified.
- [ ] Every canonical answer maps to a valid choice or declared free-response grading rule.
- [ ] Source pages and passage IDs are preserved.
- [ ] Duplicate, empty and anomalous records are reviewed.
- [ ] Pack version, source revision and hashes are recorded.
- [ ] Import is atomic; failed import leaves the previously active pack usable.

## Model artifact
- [ ] Model license and redistribution conditions reviewed.
- [ ] Base revision, tokenizer/chat template, converter revision and quantization recorded.
- [ ] GGUF SHA-256 matches its manifest.
- [ ] Quantized model passed the fixed quality suite.
- [ ] Model size and iPhone memory behavior measured.
- [ ] Runtime initializes the model only after verification.
- [ ] Missing/corrupt model does not prevent quizzes from working.

## Native app
- [ ] Exact dependency lockfile committed.
- [ ] Database migrations and upgrade path tested.
- [ ] `llama.rn` config and required iOS capabilities verified.
- [ ] Unique iOS bundle identifier and app version set.
- [ ] Build artifact and signing method recorded.
- [ ] Installed directly on the physical iPhone 16.
- [ ] Works without Expo Go or a Metro development server.

## Offline acceptance
- [ ] Enable Airplane Mode after provisioning.
- [ ] Cold launch succeeds after force-close.
- [ ] Review questions load and answer scoring is deterministic.
- [ ] Progress persists across app restart.
- [ ] Passage retrieval returns the expected source pages.
- [ ] On-device model generates an explanation.
- [ ] Cancellation and native failure recovery work.
- [ ] Missing evidence results in an explicit limitation rather than invented claims.
- [ ] No network request is required for the above behavior.

## Performance and recovery
- [ ] Cold model load duration measured.
- [ ] Time-to-first-token and total generation duration measured.
- [ ] Peak memory, device thermal behavior and battery impact checked.
- [ ] Long prompt and maximum output are bounded.
- [ ] Repeated load/generate/release cycles succeed.
- [ ] Low-storage and corrupted-asset recovery tested.

## Signing/renewal disclosure
- [ ] The team/user understands whether the selected signing path expires.
- [ ] Renewal instructions and toolchain requirements are documented.
- [ ] No claim of permanent free installation is made unless validated.
