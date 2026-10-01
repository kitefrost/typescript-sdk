/**
 * Lockstep version stamp for the shared core (D-PPI-SDK-BUNDLING / D-PPI-SDK-GENERATED).
 *
 * Every per-pack SDK pins this exact value in lockstep with the backend
 * contract release. The per-pack codegen (STREAM-003 TASK-003) reads
 * CORE_VERSION to emit a compatible dependency range and to assert that the
 * installed core matches the contract version it was generated against.
 */
export const CORE_VERSION = '1.2.0-alpha.3';

/**
 * Assert that an installed core version satisfies the major version a per-pack
 * SDK was generated against. Lockstep versioning forbids cross-major mixing
 * (a Python-venv-style fatal skew); same-major is treated as compatible.
 */
export function assertCoreVersionCompatible(requiredMajor: number): void {
  const installedMajor = Number.parseInt(CORE_VERSION.split('.')[0] ?? '0', 10);
  if (installedMajor !== requiredMajor) {
    throw new Error(
      `@kitefrost/core version skew: installed ${CORE_VERSION} (major ${installedMajor}) ` +
        `but a pack SDK requires core major ${requiredMajor}. ` +
        'Per-pack SDKs and the core publish in lockstep; align their versions.',
    );
  }
}
