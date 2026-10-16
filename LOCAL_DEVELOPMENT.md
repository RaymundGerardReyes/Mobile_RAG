# Local Development Runbook — Windows

This runbook assumes the scaffold exists. First inspect its real layout and reuse its declared dependencies rather than blindly replacing versions.

## 1. Inspect before installing

Run from the repository root in PowerShell:

```powershell
Get-ChildItem -Force
Get-ChildItem .\training -Recurse -Depth 3
Get-ChildItem .\mobile -Recurse -Depth 3
Get-Content .\mobile\package.json
nvidia-smi
python --version
node --version
npm --version
```

Record the actual Expo SDK, React Native version, `llama.rn` version and package manager. Native dependencies must be compatible; do not upgrade Expo/RN independently of its native modules.

## 2. Python training environment

Use a separate virtual environment:

```powershell
cd training
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

Install pinned dependencies from the scaffold's `pyproject.toml`/lock file if present. If none exists, establish a verified PyTorch build for your installed NVIDIA driver, then add the specific libraries used by implemented stages. Verify GPU availability:

```powershell
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

Do not treat a successful `pip install` as proof that CUDA is working. Do not install the whole `llama.cpp` CUDA source build until you know which conversion/inference tasks need it.

## 3. Run data stages one by one

The exact flags should be defined by each stage's `--help`; avoid hidden working-directory assumptions.

```powershell
python -m ai_tutor_training.stages.extract_textbook --help
python -m ai_tutor_training.stages.link_qa_pairs --help
python -m ai_tutor_training.stages.build_passages --help
```

Then run each with explicit input, output and config paths. Validate the output contract before running the next stage. Do not run `train` until linkage, content quality and held-out evaluation are established. Embeddings are optional until query embeddings can run on the phone.

## 4. Validate model artifacts

For a chosen, license-compatible base model:

1. Pin the model revision and retain its license.
2. Run the baseline against a fixed evaluation prompt suite.
3. Optionally fine-tune; record dataset revision, config and checkpoint provenance.
4. Convert/quantize using the version of `llama.cpp` that supports the architecture.
5. Test the GGUF on Windows using the same tokenizer/chat template and representative prompts.
6. Calculate SHA-256 and write the model manifest.
7. Run the same eval suite on the converted/quantized artifact; record quality and latency deltas.

## 5. Mobile dependency workflow

From `mobile/`, inspect `package.json` and the supported Expo SDK. Use `npx expo install` for Expo-managed native packages so package versions match the project SDK. Integrate `llama.rn` following the official repository's current Expo config/plugin guidance. `npx expo prebuild` produces native project files; the app cannot run this native module inside Expo Go unless that native module already exists in that Expo Go binary.

Use an Expo development build for physical iPhone native-runtime testing. EAS may compile iOS remotely from Windows, but device signing/provisioning is a distinct step; validate the intended free signing workflow early, before implementing every feature.

## 6. Debugging order

When a feature fails, locate the boundary:

1. **Data:** inspect stage manifest, schema validation and content-link report.
2. **Database:** validate migrations, pack version, counts, foreign keys and FTS availability.
3. **Retrieval:** inspect retrieved passage IDs and page links before blaming the model.
4. **Prompt/validation:** test prompt builder and response parser with a fake LLM.
5. **Native runtime:** inspect model hash, path, architecture compatibility, init status, memory and native logs.
6. **Release:** verify build id, signature/install workflow, packaged model policy and Airplane Mode test.

Never dump whole source books, complete prompts or free-text learner answers into ordinary logs. Use synthetic test fixtures where possible.
