/* Draft PR #209: offline SQL design only.
 * NEVER import this module in a Worker, migration runner, or live workflow.
 * The copy is deliberately NOT in migrations/; do not deploy or apply.
 * Copying alone is unsafe while old/new Workers still write different tables:
 * require a separately approved, verified quiescence / traffic-freeze plan.
 */
export const LEGACY_TO_CANONICAL_COPY_SQL = `
INSERT INTO revoked_session_tokens (token_hash, expires_at, revoked_at)
SELECT legacy.token_hash, legacy.expires_at, '1970-01-01T00:00:00.000Z'
FROM revoked_sessions AS legacy
WHERE 1
ON CONFLICT(token_hash) DO UPDATE SET
  expires_at = MAX(revoked_session_tokens.expires_at, excluded.expires_at)
`.trim();

export const VERIFY_NO_MISSING_OR_SHORTENED_REVOCATIONS_SQL = `
SELECT COUNT(*) AS missing_or_shortened
FROM revoked_sessions AS legacy
LEFT JOIN revoked_session_tokens AS canonical
  ON canonical.token_hash = legacy.token_hash
WHERE canonical.token_hash IS NULL
   OR canonical.expires_at < legacy.expires_at
`.trim();

// A check with no result rows returned is insufficient. Query yields one aggregate
// count and must be zero; the SQL never projects a token_hash or a user record.
export function assessOfflineCopyEligibility(schemaReport) {
  if(!schemaReport || !['production_db','preview_db','synthetic'].includes(schemaReport.environment))
    throw Error('Explicit known-environment schema report required');
  const legacy=schemaReport.tables?.revoked_sessions;
  const canonical=schemaReport.tables?.revoked_session_tokens;
  if(!legacy || !canonical)throw Error('Both revocation table reports are required');
  const errors=[];
  if(!legacy.exists)errors.push('LEGACY_TABLE_ABSENT');
  if(!canonical.exists)errors.push('CANONICAL_TABLE_ABSENT');
  if(legacy.exists && legacy.columnsCompatible!==true)errors.push('LEGACY_SCHEMA_MISMATCH');
  if(canonical.exists && canonical.columnsCompatible!==true)errors.push('CANONICAL_SCHEMA_MISMATCH');
  return {
    analysis:'OFFLINE_ONLY_NO_CLOUDFLARE_ACCESS',
    eligibleForCopySimulation:errors.length===0,
    blockers:errors,
    releaseAuthorized:false,
    sourceTableWillBePreserved:true,
    trafficQuiescenceVerified:false,
    postCopyVerified:false,
    // These are reference SQL statements, never executable commands issued by this function.
    proposedSql:errors.length===0?{
      copy:LEGACY_TO_CANONICAL_COPY_SQL,
      verifyAggregate:VERIFY_NO_MISSING_OR_SHORTENED_REVOCATIONS_SQL
    }:null
  };
}
