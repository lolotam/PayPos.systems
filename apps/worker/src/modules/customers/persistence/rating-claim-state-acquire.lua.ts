/**
 * سكربت Redis: استلام ملكية حالة الجدولة.
 *
 * بيبني الحالة لو مش موجودة (بتحدّد جديد ومالك جديد)، ولو موجودة بيرفض المالك
 * الحيّ ويأخذ غيرها من غير ما يغيّر التقدّم ولا النسخة. الحالة المتضررة أو
 * المجهولة بتترفض من غير أي كتابة.
 *
 * السكربت مستقل بذاته لأن Redis مفيش فيه استيراد لسكربت تاني.
 */
export const RATING_CLAIM_STATE_ACQUIRE = `
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
  local fresh = {
    schema = SCHEMA,
    companyId = companyId,
    incarnation = env['incarnation'],
    version = 1,
    ownerToken = env['ownerToken'],
    leaseUntil = now + env['leaseMs'],
    turnStartedAt = now,
    nextTicket = 1,
    phase = 'IDLE',
    retries = {},
    overflowCount = 0,
    reconcileRequired = false,
    sweepOverflowCount = 0
  }
  if not store(KEYS[1], fresh, env['maxBytes']) then return reply('LIMIT', 0) end
  return reply('OK', 1, fresh)
end

local version = state['version']
if type(state['ownerToken']) == 'string'
  and type(state['leaseUntil']) == 'number'
  and state['leaseUntil'] > now then
  return reply('BUSY', version, state)
end

state['ownerToken'] = env['ownerToken']
state['leaseUntil'] = now + env['leaseMs']
state['turnStartedAt'] = now
local retries = state['retries']
for _, entry in pairs(retries) do
  entry['ownerToken'] = nil
  entry['leaseUntil'] = nil
  entry['workToken'] = nil
end
if bump(state) == nil then return reply('LIMIT', version) end
if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
return reply('OK', state['version'], state)
`;
