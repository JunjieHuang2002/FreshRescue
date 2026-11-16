/**
 * The JSON document that the store holds, as the read gateway returns it and before SnapshotParser
 * has checked its shape. Its keys are the `Snapshot` list keys plus `settings` and `counters`. Its
 * values are whatever was stored, so each one is `unknown` until it has been parsed.
 */
export type RawStore = Readonly<Record<string, unknown>>;
