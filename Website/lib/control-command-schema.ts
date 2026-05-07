import { z } from "zod";

const DisplayMode = z.enum([
  "IDLE",
  "TEAM_INTRO",
  "PLAYER_INTRO",
  "MATCH",
  "SPONSOR_ROTATION",
  "GOAL",
  "GOAL_INTRO_VIDEO",
  "GOAL_PLAYER_VIDEO",
  "SUBSTITUTION",
  "CARD",
  "HALFTIME",
  "FULLTIME",
  "SPONSOR",
  "BLACKOUT",
  "CUSTOM",
]);

const MatchStatus = z.enum([
  "SETUP",
  "PREMATCH",
  "FIRST_HALF",
  "HALF_TIME",
  "SECOND_HALF",
  "EXTRA_TIME",
  "FULL_TIME",
  "POST_MATCH",
]);

export const ControlCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("timer:start") }),
  z.object({ type: z.literal("timer:pause") }),
  z.object({ type: z.literal("timer:adjust"), deltaSec: z.number().int() }),
  z.object({ type: z.literal("timer:set"), seconds: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("timer:preset"),
    preset: z.enum(["FIRST_HALF", "SECOND_HALF", "ET1", "ET2"]),
  }),
  z.object({ type: z.literal("match:setActive"), matchId: z.string().nullable() }),
  z.object({ type: z.literal("match:setStatus"), status: MatchStatus }),
  z.object({
    type: z.literal("score:set"),
    homeScore: z.number().int().nonnegative(),
    awayScore: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("score:adjust"), side: z.enum(["home", "away"]), delta: z.number().int() }),
  z.object({ type: z.literal("goal:prepare"), side: z.enum(["home", "away"]) }),
  z.object({ type: z.literal("goal:cancel") }),
  z.object({
    type: z.literal("goal:trigger"),
    side: z.enum(["home", "away"]),
    scorerId: z.string().optional(),
    assistId: z.string().optional(),
  }),
  z.object({
    type: z.literal("sub:trigger"),
    teamId: z.string(),
    playerOutId: z.string(),
    playerInId: z.string(),
  }),
  z.object({
    type: z.literal("sub:triggerBatch"),
    substitutions: z
      .array(z.object({ teamId: z.string(), playerOutId: z.string(), playerInId: z.string() }))
      .min(1),
  }),
  z.object({ type: z.literal("sub:queueAdvance") }),
  z.object({
    type: z.literal("card:trigger"),
    teamId: z.string(),
    playerId: z.string(),
    color: z.enum(["YELLOW", "RED"]),
  }),
  z.object({
    type: z.literal("display:setMode"),
    mode: DisplayMode,
    meta: z
      .object({
        activePlayerId: z.string().nullable().optional(),
        activeMediaId: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal("display:blackout") }),
  z.object({ type: z.literal("display:setExternalCapture"), sourceId: z.string().nullable() }),
  z.object({ type: z.literal("display:setExternalCaptureToDisplay"), enabled: z.boolean() }),
  z.object({ type: z.literal("display:requestSnapshot") }),
  z.object({ type: z.literal("display:setSafeMode"), enabled: z.boolean() }),
  z.object({ type: z.literal("event:undo"), eventId: z.string() }),
]);

