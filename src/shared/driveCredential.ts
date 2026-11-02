export type DriveCredentialProbeResult =
  | { state: 'missing' }
  | { state: 'unsupported' }
  | { state: 'valid'; checkedAt: number }
  | { state: 'invalid'; checkedAt: number }
  | { state: 'unknown'; checkedAt: number };
