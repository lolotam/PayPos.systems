/**
 * سكربت Redis: حجز إعادات المحاولة المستحقة.
 *
 * بيختار الطلبات المستحقة وغير المحجوزة (أو اللي حجزها انتهى) الأقدم تذكرة
 * الأول، وبيسندلها رموز شغل طازجة مع حجز المالك. الحجز بينسخ التذكرة القديمة
 * ومش بيمسح أي طلب، فالفشل المتكرر بيروح لآخر الطابور بدل ما يبقى أوله.
 *
 * السكربت مستقل بذاته لأن Redis مفيش فيه استيراد لسكربت تاني.
 */
export const RATING_CLAIM_STATE_RESERVE = `
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

local limit = env['limit']
local workTokens = env['workTokens']
if type(limit) ~= 'number' or limit < 1 then return reply('LIMIT', version) end
if type(workTokens) ~= 'table' or #workTokens == 0 then return reply('LIMIT', version) end

local retries = state['retries']
local candidates = {}
for requestId, entry in pairs(retries) do
  local entryLease = entry['leaseUntil']
  local free = type(entryLease) ~= 'number' or entryLease <= now
  local eligibleAt = entry['eligibleAt']
  if free and type(eligibleAt) == 'number' and eligibleAt <= now then
    table.insert(candidates, { requestId = requestId, ticket = entry['ticket'] })
  end
end
table.sort(candidates, function(a, b)
  if a['ticket'] == b['ticket'] then return a['requestId'] < b['requestId'] end
  return a['ticket'] < b['ticket']
end)

local ceiling = nil
local turnStartedAt = state['turnStartedAt']
if type(turnStartedAt) == 'number' then ceiling = turnStartedAt + env['maxTurnMs'] end

local chosen = {}
local count = math.min(limit, #candidates, #workTokens)
for index = 1, count do
  local candidate = candidates[index]
  local workToken = workTokens[index]
  if type(workToken) ~= 'string' or workToken == '' then return reply('LIMIT', version) end
  local entry = retries[candidate['requestId']]
  local reserved = now + env['leaseMs']
  if ceiling ~= nil and reserved > ceiling then reserved = ceiling end
  entry['workToken'] = workToken
  entry['ownerToken'] = env['ownerToken']
  entry['leaseUntil'] = reserved
  table.insert(chosen, { requestId = candidate['requestId'], workToken = workToken })
end

if bump(state) == nil then return reply('LIMIT', version) end
if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
return reply('OK', state['version'], { reservations = chosen })
`;
