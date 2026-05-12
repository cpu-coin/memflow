import type { MemoryEntry } from "../types/memory.js";

export interface ProvenanceSignature {
  signerId: string;
  signature: string;
  timestamp: string;
  algorithm: string;
}

/**
 * Interface for optional high-trust provenance anchoring.
 * Enables zero-trust environments to verify the origin and chain-of-custody
 * of any shared AI memory or prompt pattern block.
 */
export interface MemFlowProvenanceAdapter {
  /**
   * Cryptographically signs a memory entry and its metadata
   */
  signEntry(entry: MemoryEntry): Promise<ProvenanceSignature>;

  /**
   * Verifies the authenticity and integrity of a signed memory entry
   */
  verifySignature(entry: MemoryEntry, signature: ProvenanceSignature): Promise<boolean>;

  /**
   * (Optional) Anchors an event chain to a public ledger or transparency log
   */
  anchorChain(entries: MemoryEntry[]): Promise<string>;
}
