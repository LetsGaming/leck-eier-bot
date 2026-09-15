/** One API token's metadata — never the raw value, except on `POST /api/api-tokens`'s response (`ApiTokenCreated`). See `src/db/apiTokensRepository.ts`. */
export interface ApiToken {
  id: number;
  label: string;
  createdByUserId: string;
  createdByUsername: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** `POST /api/api-tokens`'s response — the one and only time `rawToken` is ever sent to a client. */
export interface ApiTokenCreated extends ApiToken {
  rawToken: string;
}
