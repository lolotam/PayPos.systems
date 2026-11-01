/**
 * سكربت Redis: تسوية بند الجولة الأمامية أو طلب في خريطة الإعادة.
 *
 * تسوية صفحة بتشيل البند المطابق بس. طلب فضل مجدول بعد ما اتحاول بيدخل خريطة
 * الإعادة من غير تكرار، والإعادة اللي موجودة بتخلي تذكرتها واستحقاقها زي ما
 * هم. لو الخريطة امتلأت — بالعدد أو بالحجم المرمّز — الفيضان بيتسجل والنداء
 * بيرجع OVERFLOW بدل ما يوهم إن الطلب اتسجّل؛ البند بيتشال من الجولة على أي
 * حال عشان الجولة ما تقفش. تسوية إعادة بتشيل الطلب أو بتعيده لآخر الطابور،
 * والنتيجة المجهولة عمر ما بتتحول لنهائية.
 *
 * السكربت مستقل بذاته لأن Redis مفيش فيه استيراد لسكربت تاني.
 */
export const RATING_CLAIM_STATE_SETTLE = `
local SCHEMA = 1
local MAX_SAFE = 9007199254740991

local function now_ms()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end

local function reply(code, version, value)
  local out = { code = code, version = version }
  if value ~= nil then out.value = value end
  return cjson.encode(out)
end

local function load(raw, companyId)
  if not raw then return nil, 'MISSING' end
  local ok, state = pcall(cjson.decode, raw)
  if not ok or type(state) ~= 'table' then return nil, 'CORRUPT' end
  if state['schema'] ~= SCHEMA then return nil, 'CORRUPT' end
  if state['companyId'] ~= companyId then return nil, 'CORRUPT' end
  if type(state['version']) ~= 'number' then return nil, 'CORRUPT' end
  if type(state['retries']) ~= 'table' then return nil, 'CORRUPT' end
  return state, nil
end

local function store(key, state, maxBytes)
  local encoded = cjson.encode(state)
  if #encoded > maxBytes then return false end
  redis.call('SET', key, encoded)
  return true
end

local function bump(state)
  local version = state['version']
  if type(version) ~= 'number' or version >= MAX_SAFE then return nil end
  state['version'] = version + 1
  return state['version']
end

-- The eligibility window: the cap is the longest wait, and the stored due time
-- only pulls it earlier, never past the moment the request is actually due.
local function eligible_at(now, dueAt, backoffMs)
  local cap = now + backoffMs
  if type(dueAt) ~= 'number' then return cap end
  if dueAt <= now then return cap end
  if dueAt < cap then return dueAt end
  return cap
end

local function count_entries(retries)
  local total = 0
  for _ in pairs(retries) do total = total + 1 end
  return total
end

-- The overflow evidence: the count grows, the first moment is kept, and the
-- sweep is marked for reconciliation until a clean sweep completes.
local function record_overflow(state, now)
  state['overflowCount'] = state['overflowCount'] + 1
  if state['overflowSince'] == nil then state['overflowSince'] = now end
  state['reconcileRequired'] = true
  state['sweepOverflowCount'] = (state['sweepOverflowCount'] or 0) + 1
end

local ok, env = pcall(cjson.decode, ARGV[1])
if not ok or type(env) ~= 'table' then return reply('CORRUPT', 0) end
local companyId = env['companyId']
local now = now_ms()
local state, problem = load(redis.call('GET', KEYS[1]), companyId)
if state == nil then
  if problem == 'CORRUPT' then return reply('CORRUPT', 0) end
  return reply('MISSING', 0)
end

local version = state['version']
if state['incarnation'] ~= env['incarnation'] then return reply('STALE', version) end
if state['version'] ~= env['version'] then return reply('STALE', version) end
if state['ownerToken'] ~= env['ownerToken'] then return reply('BUSY', version) end
local leaseUntil = state['leaseUntil']
if type(leaseUntil) ~= 'number' or leaseUntil <= now then return reply('BUSY', version) end

local settlement = env['settlement']
if settlement ~= 'TERMINAL' and settlement ~= 'ABSENT' and settlement ~= 'FUTURE_UNATTEMPTED'
  and settlement ~= 'RETRY' and settlement ~= 'DELEGATED' then
  return reply('STALE', version)
end
local retries = state['retries']

if env['action'] == 'settlePage' then
  local page = state['page']
  if type(page) ~= 'table' or page['pageId'] ~= env['pageId'] then return reply('STALE', version) end
  local entries = page['entries']
  if type(entries) ~= 'table' then return reply('STALE', version) end
  local found = nil
  local requestId = nil
  for position, entry in ipairs(entries) do
    if entry['workToken'] == env['workToken'] then
      found = position
      requestId = entry['requestId']
    end
  end
  if found == nil then return reply('STALE', version) end
  if settlement == 'DELEGATED' and retries[requestId] == nil then return reply('STALE', version) end
  local kept = {}
  for position, entry in ipairs(entries) do
    if position ~= found then
      table.insert(kept, { requestId = entry['requestId'], workToken = entry['workToken'] })
    end
  end
  page['entries'] = kept
  local limit = env['maxBytes'] - env['reserveBytes']
  local overflowed = false
  local inserted = nil
  if settlement == 'RETRY' and retries[requestId] == nil then
    if count_entries(retries) >= env['capacity'] then
      overflowed = true
    else
      local ticket = state['nextTicket']
      if type(ticket) ~= 'number' or ticket >= MAX_SAFE then return reply('LIMIT', version) end
      inserted = {
        eligibleAt = eligible_at(now, env['storedDueAt'], env['backoffMs']),
        ticket = ticket,
        workToken = nil,
        ownerToken = nil,
        leaseUntil = nil
      }
      retries[requestId] = inserted
      state['nextTicket'] = ticket + 1
    end
  end
  if overflowed then record_overflow(state, now) end
  if bump(state) == nil then return reply('LIMIT', version) end
  -- A retry that does not fit the encoded state is not admitted: the item goes
  -- back to the full sweep and the overflow is recorded, so the journal still
  -- drains instead of staying open for ever.
  if inserted ~= nil and #cjson.encode(state) > limit then
    retries[requestId] = nil
    state['nextTicket'] = inserted['ticket']
    overflowed = true
    record_overflow(state, now)
  end
  if overflowed then
    if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
    return reply('OVERFLOW', state['version'], state)
  end
  -- A settlement that only removes an entry never grows the state, so it gets the
  -- full byte cap; a settlement that adds a retry must leave the page reserve free.
  local storeLimit = inserted == nil and env['maxBytes'] or limit
  if not store(KEYS[1], state, storeLimit) then return reply('LIMIT', version) end
  return reply('OK', state['version'], state)
end

local requestId = env['requestId']
if type(requestId) ~= 'string' or requestId == '' then return reply('STALE', version) end
local entry = retries[requestId]
if type(entry) ~= 'table' then return reply('STALE', version) end
if entry['workToken'] ~= env['workToken'] then return reply('STALE', version) end
if entry['ownerToken'] ~= env['ownerToken'] then return reply('BUSY', version) end
local entryLease = entry['leaseUntil']
if type(entryLease) ~= 'number' or entryLease <= now then return reply('BUSY', version) end
if settlement == 'TERMINAL' or settlement == 'ABSENT' then
  retries[requestId] = nil
elseif settlement == 'RETRY' then
  local ticket = state['nextTicket']
  if type(ticket) ~= 'number' or ticket >= MAX_SAFE then return reply('LIMIT', version) end
  entry['eligibleAt'] = eligible_at(now, env['storedDueAt'], env['backoffMs'])
  entry['ticket'] = ticket
  entry['workToken'] = nil
  entry['ownerToken'] = nil
  entry['leaseUntil'] = nil
  state['nextTicket'] = ticket + 1
else
  return reply('STALE', version)
end
if bump(state) == nil then return reply('LIMIT', version) end
-- A settlement that removes the request never grows the state, so it gets the
-- full byte cap; a requeue must leave the page reserve free for the next page.
local removal = settlement == 'TERMINAL' or settlement == 'ABSENT'
local limit = removal and env['maxBytes'] or env['maxBytes'] - env['reserveBytes']
if not store(KEYS[1], state, limit) then return reply('LIMIT', version) end
return reply('OK', state['version'], state)
`;
