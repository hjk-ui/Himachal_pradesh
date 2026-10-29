/**
 * Waystar inbound + inquiries (server). Public surface for other modules:
 *
 *   runWaystarRetrieval()          pull /Download and apply 999 / 277CA / 277 / 835 / 271 (cron + button)
 *   primaryAdjudication(claimId)   primary payer's posted 835 result for a secondary (COB) 837:
 *                                  { paidAmount (AMT*D), paidDate (DTP*573), adjustments (2320 CAS),
 *                                    lines[] (2430 SVD / CAS, lineNumber = 835 SVC order), payerClaimControlNumber, ... }
 *                                  null until an 835 for that claim has been posted.
 *   payerClaimControlNumberFor(claimId)  CLP07 / 277CA REF*1K (also written to Claim.payerClaimControlNumber)
 *   requestClaimStatus()           276 for submitted claims
 *   listEraReview() / postEraClaimPayment() / dismissEraClaimPayment()  ERA review queue
 *
 * Pure parsers / generators (importable from tests): ./parse835, ./parse271, ./parse277,
 * ./generate, ./eraPosting, ./x12.
 */
import 'server-only';

export { runWaystarRetrieval, outcomeForOrganization, waystarRetrievalAvailable, type RetrievalOutcome } from './retrieval';
export {
  primaryAdjudication,
  payerClaimControlNumberFor,
  listEraReview,
  postEraClaimPayment,
  dismissEraClaimPayment,
  EraPostingError,
  type PrimaryAdjudication,
  type EraReviewItem,
} from './era';
export { requestClaimStatus, type StatusRequestOutcome } from './claimStatus';
export { clearinghouseOverview, type ClearinghouseOverview } from './overview';
