/**
 * Wire protocol version, sent by both sides in the handshake.
 *
 * Must match `protocol::PROTOCOL_VERSION` in the runtime. Additive changes
 * (new optional fields, new message variants) do not bump this — receivers
 * ignore unknown fields and reject unknown message types without closing the
 * socket. Breaking changes bump it.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Sample rate of every audio frame on the voice socket, in both directions.
 *
 * Must match `protocol::VOICE_SAMPLE_RATE` in the runtime, which
 * scripts/sync-protocol.sh checks. It is the provider's native rate, so
 * agreeing on it here is what keeps a resampler out of a latency-critical
 * path — and disagreeing does not error, it just plays the assistant at the
 * wrong pitch, which is why the check exists.
 */
export const VOICE_SAMPLE_RATE = 24000;
