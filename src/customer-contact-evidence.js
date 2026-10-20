/**
 * Shared Customer Service contact evidence reconciliation.
 *
 * A regression in the Production Android/Web board counted only
 * "screened" phone events while older APKs and browser actions recorded
 * valid "call" / "contact" attempts. This function does not mutate records.
 *
 * contact_log is authoritative. history is a recovery source when a prior
 * integration/import replaced or emptied contact_log. A mirrored history
 * event must never increment the count twice.
 */
const clean=value=>String(value??'').trim();
export function parseContactArray(value){
  if(Array.isArray(value))return value;
  try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}
}
const eventTypes=new Set(['contact','contact_attempt','call','call_attempt','phone_call','customer_contact']);
const intents=new Set(['screened','call','contact']);
function evidence(entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
  const type=clean(entry.type).toLowerCase(),channel=clean(entry.channel||entry.kind).toLowerCase();
  const rawIntent=clean(entry.intent).toLowerCase();
  const intent=intents.has(rawIntent)?rawIntent:
    ['call','call_attempt','phone_call'].includes(type)?'call':
    ['contact','contact_attempt','customer_contact'].includes(type)?'contact':'';
  if(!intent||(!eventTypes.has(type)&&!channel))return null;
  // Do not count claim, navigation, chat-message templates, order edits,
  // or ordinary state changes as a contact attempt.
  return {...entry,type:'contact',channel:channel||'phone',intent};
}
const identity=entry=>{
  const id=clean(entry.eventId||entry.event_id||entry.contactEventId);
  if(id)return 'id:'+id;
  const at=clean(entry.at||entry.createdAt||entry.created_at||entry.timestamp);
  if(!at)return '';
  return 'stamp:'+JSON.stringify([at,clean(entry.channel),clean(entry.intent),clean(entry.byUserId||entry.userId||entry.byName||entry.by||'')]);
};
export function recoverOrderContacts(rawLog,rawHistory){
  const log=parseContactArray(rawLog).map(evidence).filter(Boolean);
  const history=parseContactArray(rawHistory).map(evidence).filter(Boolean);
  // Preserve genuinely repeated attempts stored in the canonical log,
  // even if a faulty client reused a timestamp; dedupe ONLY the mirror in
  // order.history using a source-specific multiset.
  const available=new Map();
  for(const e of log){const id=identity(e);if(id)available.set(id,(available.get(id)||0)+1);}
  const recovered=[];
  for(const e of history){
    const id=identity(e),copies=id?(available.get(id)||0):0;
    if(copies>0){available.set(id,copies-1);continue;}
    recovered.push(e);
  }
  const contactLog=[...log,...recovered];
  return {
    contactLog,
    contactCount:contactLog.length,
    screenedContactCount:contactLog.filter(e=>e.channel==='phone'&&e.intent==='screened').length,
    recoveredContactCount:recovered.length,
    contactCountSource:recovered.length?'history_recovered':log.length?'contact_log':'none'
  };
}
