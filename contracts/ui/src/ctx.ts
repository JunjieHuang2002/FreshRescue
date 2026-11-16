import type { DomainError } from '@freshrescue/contract-errors';
import type { Result } from '@freshrescue/contract-primitives';
import type { Envelope, MessageData } from '@freshrescue/contract-messages';
import type { ReferenceDataDto } from '@freshrescue/contract-views';
import type { RenderTree, SlotId } from './render-tree';

/**
 * The services that AppCoordinator hands to a sub-coordinator with every event (blueprint 2.2). A
 * sub-coordinator reaches the network and the page only through these, so it never touches a
 * gateway.
 */
export type Ctx = {
  /**
   * Send one message and read the reply: the data that the message promises, or the error. A
   * transport failure (NETWORK_ERROR, TIMEOUT, BAD_JSON, BAD_RESPONSE, HTTP_STATUS) is an error too.
   */
  readonly callApi: <M extends Envelope>(message: M) => Promise<Result<MessageData[M['type']], DomainError>>;
  /** Paint a tree into a slot. A slot that is missing is reported as a notice, so this never fails. */
  readonly mount: (slot: SlotId, tree: RenderTree) => void;
  /** The reference data of the last successful load, or null before the first one. */
  readonly reference: () => ReferenceDataDto | null;
};
