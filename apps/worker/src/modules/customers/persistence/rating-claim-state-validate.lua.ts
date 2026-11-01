/**
 * فحص سلامة حالة الجدولة، مشترك بين سكربتات الحالة.
 *
 * Redis مفيش فيه استيراد لسكربت تاني، فالفحص مكتوب هنا مرة واحدة وبتترجمه
 * السكربتات نفسها جوّه نصها وقت البناء. الفحص بيتأكد إن حقول السور والمجلة
 * ومدخلات الإعادة كلها سليمة قبل أي كتابة، فالحالة المتضررة بتترفض CORRUPT
 * والمفتاح بيفضل زي ما هو بالبايت.
 */
export const RATING_CLAIM_STATE_VALIDATE = `
-- A damaged state is never written over: the fence fields, the journal and every
-- retry entry are checked before any command touches the state.
local function validate_state(state)
  if type(state['incarnation']) ~= 'string' then return false end
  if type(state['nextTicket']) ~= 'number' then return false end
  if state['phase'] ~= 'IDLE' and state['phase'] ~= 'SWEEP' then return false end
  local owner = state['ownerToken']
  local lease = state['leaseUntil']
  if owner ~= nil and type(owner) ~= 'string' then return false end
  if lease ~= nil and type(lease) ~= 'number' then return false end
  if (owner == nil) ~= (lease == nil) then return false end
  local turnStartedAt = state['turnStartedAt']
  if turnStartedAt ~= nil and type(turnStartedAt) ~= 'number' then return false end
  local page = state['page']
  if page ~= nil then
    if type(page) ~= 'table' then return false end
    if type(page['pageId']) ~= 'string' or page['pageId'] == '' then return false end
    if type(page['sweepId']) ~= 'string' or page['sweepId'] == '' then return false end
    if type(page['exhausted']) ~= 'boolean' then return false end
    local entries = page['entries']
    if type(entries) ~= 'table' then return false end
    for _, entry in pairs(entries) do
      if type(entry) ~= 'table' then return false end
      if type(entry['requestId']) ~= 'string' or entry['requestId'] == '' then return false end
      if type(entry['workToken']) ~= 'string' or entry['workToken'] == '' then return false end
    end
  end
  for _, entry in pairs(state['retries']) do
    if type(entry) ~= 'table' then return false end
    if type(entry['ticket']) ~= 'number' then return false end
    if type(entry['eligibleAt']) ~= 'number' then return false end
    local entryOwner = entry['ownerToken']
    local entryLease = entry['leaseUntil']
    if entryOwner ~= nil and type(entryOwner) ~= 'string' then return false end
    if entryLease ~= nil and type(entryLease) ~= 'number' then return false end
    if (entryOwner == nil) ~= (entryLease == nil) then return false end
    local workToken = entry['workToken']
    if workToken ~= nil and type(workToken) ~= 'string' then return false end
  end
  return true
end
`;
