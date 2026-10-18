// Public surface of the protocol package.
//
// Everything under `generated/` is produced from the Rust `protocol` crate by
// scripts/sync-protocol.sh. Hand-written helpers live here, beside it.

export * from "./generated/index";
export { PROTOCOL_VERSION, VOICE_SAMPLE_RATE } from "./version";
