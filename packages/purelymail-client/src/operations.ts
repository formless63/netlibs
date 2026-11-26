/**
 * Every Purelymail API operation. The API is RPC-shaped: each operation is a
 * `POST` to `/api/v0/<name>` with a JSON object body; there are no path
 * parameters, query strings or other verbs. A wrong name answers HTTP 404 with
 * an HTML page.
 *
 * Transcribed from the provider's OpenAPI document (`info.version` "0.0.1",
 * nineteen paths), loaded by the API reference at
 * https://news.purelymail.com/api/index.html. Keys are this package's labels,
 * used as `operation` on errors; values are the provider's names. Operations
 * the client does not call are listed so that the surface is complete.
 */
export const PURELYMAIL_OPERATIONS = {
  'domain.add': 'addDomain',
  /** Takes `{}`: the code belongs to the account, not to a domain. */
  'domain.ownershipCode': 'getOwnershipCode',
  'domain.list': 'listDomains',
  /** The one operation whose domain field is `name`, not `domainName`. */
  'domain.updateSettings': 'updateDomainSettings',
  'domain.delete': 'deleteDomain',
  /** `userName` is the local part here, and the full address everywhere else. */
  'user.create': 'createUser',
  'user.delete': 'deleteUser',
  /** Singular, unlike the other list operations. At most 1000 users, no paging. */
  'user.list': 'listUser',
  'user.modify': 'modifyUser',
  'user.get': 'getUser',
  'passwordReset.upsert': 'upsertPasswordReset',
  'passwordReset.delete': 'deletePasswordReset',
  'passwordReset.list': 'listPasswordReset',
  'routing.create': 'createRoutingRule',
  'routing.delete': 'deleteRoutingRule',
  'routing.list': 'listRoutingRules',
  /** Returns a credential. Not called by this client. */
  'appPassword.create': 'createAppPassword',
  'appPassword.delete': 'deleteAppPassword',
  /** Returns `{credit}` as a string. The cheapest authenticated read. */
  'account.credit': 'checkAccountCredit'
} as const;

export type PurelymailOperation = keyof typeof PURELYMAIL_OPERATIONS;

export const PURELYMAIL_API_PREFIX = '/api/v0';

/** `/api/v0/<name>` for an operation label. */
export function purelymailPath(operation: PurelymailOperation): string {
  return `${PURELYMAIL_API_PREFIX}/${PURELYMAIL_OPERATIONS[operation]}`;
}
