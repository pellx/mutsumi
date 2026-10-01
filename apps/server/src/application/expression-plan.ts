/**
 * M04 - deterministic expression planning.
 *
 * Build a validated ReplyPlan from a ReplyDraft and a caller-supplied reply id.
 * No inference, no synthesis, no vendor controls, no actual timing.
 */

import type { ReplyDraft, ReplyPlan } from '../domain/conversation.ts';
import { validateReplyDraft, validateReplyPlan } from '../domain/conversation-validation.ts';
import { makeRoundError } from './round-errors.ts';

/** Validate draft, clone its segments, compose and validate the plan, or throw. */
export function buildReplyPlan(draft: ReplyDraft, replyId: string): ReplyPlan {
  const draftResult = validateReplyDraft(draft);
  if (!draftResult.ok) throw makeRoundError('invalid_result', 'expression');

  const plan: ReplyPlan = {
    reply_id: replyId,
    segments: structuredClone(draftResult.value.segments),
  };

  const planResult = validateReplyPlan(plan);
  if (!planResult.ok) throw makeRoundError('invalid_result', 'expression');

  return planResult.value;
}
