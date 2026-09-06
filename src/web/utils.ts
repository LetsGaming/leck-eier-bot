import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

/**
 * Removes undefined values from a partial object.
 * Returns a new object containing only the keys whose values are not undefined.
 */
export function pickDefined<T extends object>(patch: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([_, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * The FastifyInstance type as returned by `Fastify(...).withTypeProvider<ZodTypeProvider>()`
 * in web/server.ts. Route-registration functions that attach a zod `schema`
 * (body/params/querystring) must type their `app` parameter as this — not
 * plain `FastifyInstance` — for `request.body`/`params`/`query` to be typed
 * from the schema instead of falling back to `unknown`.
 */
export type ZodFastifyInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  ZodTypeProvider
>;
