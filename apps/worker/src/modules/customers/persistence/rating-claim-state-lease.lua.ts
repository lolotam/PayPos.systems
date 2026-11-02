/**
 * سكربت Redis: تجديد حجز المالك أو تسليم الدور، وقراءة الحالة كما هي.
 *
 * التجديد بيتحسب من Redis TIME وما بيعديش سقف ملكية الدور (بداية الدور + 180
 * ثانية): لو الوقت المتبقي للسقف مش كافي لحجز كامل، التجديد بيرجع LIMIT
 * والدور بيوقّف نفسه بدل ما يكمّل من غير سور. والحجوزات اللي المالك نفسه
 * ماسكها بتتجدد معاه، عشان المسار الطويل للإعادة ما يقعش BUSY والسور لسه صالح.
 * التسليم بيرفع الملكية بس وبيسيب التقدّم وخريطة الإعادة زي ما هما.
 * المالك اللي حجزه انتهى مش بيقدر يجدّد ولا يسلّم، حتى لو محدش أخذ الحالة بعده.
 * والقراءة مبتعملش أي تعديل، ودي طريق المراقبة اللي بيقرأ الحالة من برّه.
 *
 * في renew سقف الدور بيتفحص قبل حارس الحجز: الدور اللي وقته خلص لازم يرجع
 * LIMIT، مش BUSY، عشان ما يقفش بسبب فقد سور غير حقيقي وهو لسه مالك الحالة.
 * لو الوقت المتبقي مش كافي لحجز كامل، الدور خلص؛ الحجز المتجدد ما بيعدّيش
 * السقف، والدور بيقف بدل ما يطالب بطلبات من غير سور. بنود الإعادة اللي ماسكها
 * نفس المالك بتتجدد معاه، عشان مسار الإعادة الطويل ما يرجعش BUSY في النص
 * والسور لسه صالح.
 *
 * السكربت مستقل بذاته وقت التشغيل لأن Redis مفيش فيه استيراد لسكربت تاني؛ وفحص
 * سلامة الحالة مشترك بين السكربتات وبتترجم جوه النص وقت البناء.
 */
import { RATING_CLAIM_STATE_VALIDATE } from './rating-claim-state-validate.lua.ts';

export const RATING_CLAIM_STATE_LEASE = `
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
if env['action'] == 'read' then return reply('OK', version, state) end
if state['incarnation'] ~= env['incarnation'] then return reply('STALE', version) end
if state['version'] ~= env['version'] then return reply('STALE', version) end
if state['ownerToken'] ~= env['ownerToken'] then return reply('BUSY', version) end

if env['action'] == 'renew' then
  local turnStartedAt = state['turnStartedAt']
  if type(turnStartedAt) ~= 'number' then return reply('STALE', version) end
  local ceiling = turnStartedAt + env['maxTurnMs']
  if now + env['leaseMs'] > ceiling then return reply('LIMIT', version) end
end

local leaseUntil = state['leaseUntil']
if type(leaseUntil) ~= 'number' or leaseUntil <= now then return reply('BUSY', version) end

if env['action'] == 'renew' then
  local renewed = now + env['leaseMs']
  state['leaseUntil'] = renewed
  for _, entry in pairs(state['retries']) do
    if entry['ownerToken'] == env['ownerToken'] then
      entry['leaseUntil'] = renewed
    end
  end
  if bump(state) == nil then return reply('LIMIT', version) end
  if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
  return reply('OK', state['version'], state)
end

state['ownerToken'] = nil
state['leaseUntil'] = nil
state['turnStartedAt'] = nil
if bump(state) == nil then return reply('LIMIT', version) end
if not store(KEYS[1], state, env['maxBytes']) then return reply('LIMIT', version) end
return reply('OK', state['version'], state)
`;
