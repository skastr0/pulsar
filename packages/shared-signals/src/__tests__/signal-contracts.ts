import { pendingSignalContract, type SignalContract } from "./signal-contract.js"

export const SHARED_SIGNAL_CONTRACTS: ReadonlyArray<SignalContract> = [
  pendingSignalContract("SHARED-CHURN-01-recent-churn"),
  pendingSignalContract("SHARED-CHURN-02-recency-weighted-churn"),
  pendingSignalContract("SHARED-COCHANGE-01-logical-coupling"),
  pendingSignalContract("SHARED-02-bus-factor"),
  pendingSignalContract("SHARED-03-churn-rate"),
  pendingSignalContract("SHARED-05-suppression-governance"),
  pendingSignalContract("SHARED-06-pr-dependency-delta"),
  pendingSignalContract("SHARED-07-machine-feedback-coverage"),
  pendingSignalContract("SHARED-09-contract-freshness"),
  pendingSignalContract("SHARED-10-domain-construction-control"),
  pendingSignalContract("SHARED-11-theory-encoding-index"),
  pendingSignalContract("SHARED-COV-01-coverage-facts"),
]
