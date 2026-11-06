/**
 * سكربت Redis: الجولة الأمامية — بدايتها، وتسجيل صفحة فيها، وإقفالها.
 *
 * البداية بتقطع الحد الأعلى مرة واحدة وبتقفل الجولة النشطة. تسجيل الصفحة بيتأكد
 * إن المعرفات فريدة ومتصاعدة و جوه (المؤشر، الحد الأعلى] وإن عددها محدود،
 * وبعدين بيخزّن الصفحة كاملة ويقدّم المؤشر في عملية كتابة واحدة. الجولة من غير
 * حد أعلى (سوق فاضية) ما بتقبلش صفحة فيها بنود. الإقفال بيرجّع الحالة للـ IDLE
 * وبيسيب خريطة الإعادة زي ما هي، وبيشيل علامة الـ reconcile بس لما الجولة اللي
 * اتقفلت ما يكونش فيها فيضان؛ وإقفال جولة زارت صفحة من غير ما تخلص زي ما هو
 * مرفوض، عشان ما تتحسبش جولة كاملة وهي ما شافتش حاجة.
 * معرّفا الجولة والصفحة لازم يكونا نصين مش فاضيين قبل الكتابة، حتى الكاتب ما
 * ينشئش حالة يرفضها فحص السلامة في الأمر اللي بعده.
 *
 * السكربت مستقل بذاته وقت التشغيل لأن Redis مفيش فيه استيراد لسكربت تاني؛ وفحص
 * سلامة الحالة مشترك بين السكربتات وبتترجم جوه النص وقت البناء.
 */
import { RATING_CLAIM_STATE_VALIDATE } from './rating-claim-state-validate.lua.ts';

export const RATING_CLAIM_STATE_SWEEP = `
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

${RATING_CLAIM_STATE_VALIDATE}
local function load(raw, companyId)
  if not raw then return nil, 'MISSING' end
  local ok, state = pcall(cjson.decode, raw)
  if not ok or type(state) ~= 'table' then return nil, 'CORRUPT' end
  if state['schema'] ~= SCHEMA then return nil, 'CORRUPT' end
  if state['companyId'] ~= companyId then return nil, 'CORRUPT' end
  if type(state['version']) ~= 'number' then return nil, 'CORRUPT' end
  if type(state['retries']) ~= 'table' then return nil, 'CORRUPT' end
  if not validate_state(state) then return nil, 'CORRUPT' end
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

local function journal_size(state)
  local page = state['page']
  if type(page) ~= 'table' then return 0 end
  local entries = page['entries']
  if type(entries) ~= 'table' then return 0 end
  return #entries
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

local action = env['action']

if action == 'begin' then
  if state['phase'] ~= 'IDLE' then return reply('BUSY', version) end
  if not nonempty_string(env['sweepId']) then return reply('LIMIT', version) end
  if journal_size(state) > 0 then return reply('BUSY', version) end
  state['phase'] = 'SWEEP'
  state['sweepId'] = env['sweepId']
  if type(env['upperId']) == 'string' then state['upperId'] = env['upperId'] else state['upperId'] = nil end
  state['cursorId'] = nil
  state['page'] = nil
  state['sweepOverflowCount'] = 0
  if bump(state) == nil then return reply('LIMIT', version) end
  if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
  return reply('OK', state['version'], state)
end

if action == 'enrollPage' then
  if state['phase'] ~= 'SWEEP' or state['sweepId'] ~= env['sweepId'] then
    return reply('STALE', version)
  end
  if journal_size(state) > 0 then return reply('BUSY', version) end
  if not nonempty_string(env['pageId']) then return reply('LIMIT', version) end
  local entries = env['entries']
  if type(entries) ~= 'table' then return reply('LIMIT', version) end
  if #entries > env['maxEntries'] then return reply('LIMIT', version) end
  local cursor = state['cursorId']
  if type(cursor) ~= 'string' then cursor = nil end
  local upper = state['upperId']
  if type(upper) ~= 'string' then upper = nil end
  local fromId = env['fromId']
  if type(fromId) ~= 'string' then fromId = nil end
  if (fromId == nil) ~= (cursor == nil) then return reply('STALE', version) end
  if fromId ~= nil and fromId ~= cursor then return reply('STALE', version) end
  if upper == nil and #entries > 0 then return reply('LIMIT', version) end
  local previous = nil
  local tokens = {}
  for _, entry in ipairs(entries) do
    local requestId = entry['requestId']
    local workToken = entry['workToken']
    if type(requestId) ~= 'string' or requestId == '' then return reply('LIMIT', version) end
    if type(workToken) ~= 'string' or workToken == '' then return reply('LIMIT', version) end
    if tokens[workToken] then return reply('LIMIT', version) end
    tokens[workToken] = true
    if previous ~= nil and requestId <= previous then return reply('LIMIT', version) end
    if cursor ~= nil and requestId <= cursor then return reply('LIMIT', version) end
    if upper ~= nil and requestId > upper then return reply('LIMIT', version) end
    previous = requestId
  end
  local kept = {}
  local throughId = cursor
  for _, entry in ipairs(entries) do
    table.insert(kept, { requestId = entry['requestId'], workToken = entry['workToken'] })
    throughId = entry['requestId']
  end
  state['page'] = {
    pageId = env['pageId'],
    sweepId = env['sweepId'],
    fromId = fromId,
    throughId = throughId,
    exhausted = env['exhausted'] == true,
    entries = kept
  }
  if previous ~= nil then state['cursorId'] = previous end
  if bump(state) == nil then return reply('LIMIT', version) end
  if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
  return reply('OK', state['version'], state)
end

if state['phase'] ~= 'SWEEP' or state['sweepId'] ~= env['sweepId'] then
  return reply('STALE', version)
end
local page = state['page']
local upper = state['upperId']
if type(upper) ~= 'string' then upper = nil end
if journal_size(state) > 0 then return reply('BUSY', version) end
if upper ~= nil then
  if type(page) ~= 'table' then return reply('BUSY', version) end
  if page['exhausted'] ~= true then return reply('BUSY', version) end
end
state['phase'] = 'IDLE'
state['sweepId'] = nil
state['upperId'] = nil
state['cursorId'] = nil
state['page'] = nil
state['lastCompletedSweepId'] = env['sweepId']
if (state['sweepOverflowCount'] or 0) == 0 then state['reconcileRequired'] = false end
if bump(state) == nil then return reply('LIMIT', version) end
if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
return reply('OK', state['version'], state)
`;
