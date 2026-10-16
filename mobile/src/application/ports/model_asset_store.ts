export interface VerifiedModelAsset {
  manifestId: string;
  modelName: string;
  modelPath: string;
  sha256: string;
  isBundled: boolean;
  fileSizeBytes: number;
}

export interface ModelAssetStore {
  resolveModelAsset(manifestId?: string): Promise<VerifiedModelAsset | null>;
  verifyChecksum(filePath: string, expectedSha256: string): Promise<boolean>;
}

