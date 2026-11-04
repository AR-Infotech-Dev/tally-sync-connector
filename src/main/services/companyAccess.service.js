import { createTallyConnectorEngine } from "../utils/tally-connector-engine/client.js";
import { companyGuid, openCompanyTarget, companyError } from "../utils/companyIdentity.js";

export function createCompanyAccess(config, { discover } = {}) {
  async function list() {
    const result = await (
      discover ||
      (() =>
        createTallyConnectorEngine().testConnection({
          url: config.tallyUrl,
          timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000,
        }))
    )();
    if (!result.ok) throw new Error("Could not read open companies from Tally.");
    return (result.companies || []).map((row) => ({ ...row, guid: companyGuid(row.guid) }));
  }
  const resolve = async (reference) => openCompanyTarget(await list(), reference);
  async function assertTarget(target) {
    const current = await resolve(target);
    if (current.company !== target.company)
      throw companyError(
        "COMPANY_CHANGED",
        "The Tally company name changed during this request. Retry with the same company_id.",
      );
    return current;
  }
  return { list, resolve, assertTarget };
}
