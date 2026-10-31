// Shared event limits for browser forms, API validation and AI prompts.
export const MAX_VOLUNTEERS = 80;
export const MAX_SHIFTS = 24;
export const MAX_PEOPLE_PER_SHIFT = 8;
export const MAX_ASSIGNMENTS = MAX_SHIFTS * MAX_PEOPLE_PER_SHIFT;
export const MAX_CHANGES = MAX_ASSIGNMENTS * 2;
export const MAX_EVENT_BYTES = 512 * 1024;
export const MAX_EVENT_REQUEST_BYTES = 1024 * 1024;
export const MAX_PROPOSAL_CHARACTERS = 1000000;
export const MAX_SETUP_TEXT = 32000;
export const MAX_SETUP_OUTPUT_TOKENS = 16384;
