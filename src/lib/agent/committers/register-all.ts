/**
 * Side-effect import barrel: registers all known per-kind committers by
 * import. Callers that need committers wired up (the agent inbox API,
 * tests for `applyProposal`) should import this module.
 *
 * Add a new line here whenever a new committer file is added.
 */

import "./maintenance-task-create";
import "./funding-application-draft";
import "./booking-noshow-reminder";

export {}; // marker for ESM file with only side-effect imports
