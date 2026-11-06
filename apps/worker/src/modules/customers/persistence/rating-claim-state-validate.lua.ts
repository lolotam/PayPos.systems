/**
 * فحص سلامة حالة الجدولة، مشترك بين سكربتات الحالة.
 *
 * Redis مفيش فيه استيراد لسكربت تاني، فالفحص مكتوب هنا مرة واحدة وبتترجمه
 * السكربتات نفسها جوّه نصها وقت البناء. الفحص بيتأكد إن حقول السور والمجلة
 * ومدخلات الإعادة كلها سليمة قبل أي كتابة، فالحالة المتضررة بتترفض CORRUPT
 * والمفتاح بيفضل زي ما هو بالبايت.
 *
 * المجلة لازم تكون متصلة لأن عدّها وتسويتها بيعتمدوا على # وipairs، لكن الإعادات
 * خريطة بمفاتيح الطلبات النصية. الجدول الفاضي مقبول في الاتنين: cjson مش بيفرق
 * بين [] و{} الفاضيين. عدّاد فيضان الجولة اختياري للتوافق مع fallback الصفر
 * الموجود في التسوية والإقفال، وبقية العدّادات المطلوبة ممنوع تغيب أو تتقرب.
 * مؤشر الصفحة بيحتفظ بآخر طلب اتسجل حتى بعد تسوية الطرف؛ لذلك بنفحص ترتيب
 * البنود المتبقية وحدودها، من غير ما نشترط إن آخر بند متبقّي يساوي المؤشر.
 * تذاكر الإعادة فريدة وأقل من nextTicket لأن التخصيص والتقديم بيتخزنوا معًا؛
 * حذف بنود قديمة ممكن يسيب فجوات، وترتيب مفاتيح الخريطة مش ترتيب الطابور.
 */
export const RATING_CLAIM_STATE_VALIDATE = `
local function nonempty_string(value)
  return type(value) == 'string' and value ~= ''
end

local function safe_integer(value, minimum)
  return type(value) == 'number' and value >= minimum and value <= MAX_SAFE
    and value == math.floor(value)
end

local function optional_string(value)
  return value == nil or nonempty_string(value)
end

local function optional_time(value)
  return value == nil or safe_integer(value, -MAX_SAFE)
end

local function sequence(value)
  if type(value) ~= 'table' then return false end
  local size = #value
  local count = 0
  for key in pairs(value) do
    if not safe_integer(key, 1) or key > size then return false end
    count = count + 1
  end
  return count == size
end

local function ownership(value, thirdField)
  local owner = value['ownerToken']
  local lease = value['leaseUntil']
  if not optional_string(owner) or not optional_time(lease) then return false end
  if (owner == nil) ~= (lease == nil) then return false end
  local third = value[thirdField]
  if (owner == nil) ~= (third == nil) then return false end
  if thirdField == 'turnStartedAt' then return optional_time(third) end
  return optional_string(third)
end

local function valid_page(state)
  local page = state['page']
  local cursor = state['cursorId']
  if page == nil then return cursor == nil end
  if type(page) ~= 'table' then return false end
  if not nonempty_string(page['pageId']) or page['sweepId'] ~= state['sweepId'] then return false end
  if type(page['exhausted']) ~= 'boolean' then return false end
  if not optional_string(page['fromId']) or not optional_string(page['throughId']) then return false end
  if page['throughId'] ~= cursor then return false end
  local previous = page['fromId']
  if previous ~= nil and (cursor == nil or previous > cursor) then return false end
  local entries = page['entries']
  if not sequence(entries) then return false end
  if cursor == nil and #entries > 0 then return false end
  local tokens = {}
  for _, entry in ipairs(entries) do
    if type(entry) ~= 'table' then return false end
    if not nonempty_string(entry['requestId']) or not nonempty_string(entry['workToken']) then
      return false
    end
    local requestId = entry['requestId']
    local workToken = entry['workToken']
    if previous ~= nil and requestId <= previous then return false end
    if requestId > cursor or tokens[workToken] then return false end
    previous = requestId
    tokens[workToken] = true
  end
  return true
end

local function valid_retries(retries, nextTicket)
  if type(retries) ~= 'table' then return false end
  local tickets = {}
  for requestId, entry in pairs(retries) do
    if not nonempty_string(requestId) then return false end
    if type(entry) ~= 'table' then return false end
    local ticket = entry['ticket']
    if not safe_integer(ticket, 1) or ticket >= nextTicket or tickets[ticket] then return false end
    tickets[ticket] = true
    if not safe_integer(entry['eligibleAt'], -MAX_SAFE) then return false end
    if not ownership(entry, 'workToken') then return false end
  end
  return true
end

local function validate_state(state)
  if not nonempty_string(state['incarnation']) then return false end
  if not safe_integer(state['version'], 1) or not safe_integer(state['nextTicket'], 1) then return false end
  if not safe_integer(state['overflowCount'], 0) then return false end
  local sweepOverflow = state['sweepOverflowCount']
  if sweepOverflow ~= nil and not safe_integer(sweepOverflow, 0) then return false end
  if type(state['reconcileRequired']) ~= 'boolean' then return false end
  if (sweepOverflow or 0) > 0 and not state['reconcileRequired'] then return false end
  if not optional_time(state['overflowSince']) then return false end
  if not optional_string(state['lastCompletedSweepId']) then return false end
  if not ownership(state, 'turnStartedAt') then return false end
  if not optional_string(state['upperId']) or not optional_string(state['cursorId']) then return false end
  if state['phase'] == 'IDLE' then
    if state['sweepId'] ~= nil or state['upperId'] ~= nil or state['cursorId'] ~= nil
      or state['page'] ~= nil then return false end
  elseif state['phase'] == 'SWEEP' then
    if not nonempty_string(state['sweepId']) then return false end
    if state['cursorId'] ~= nil
      and (state['upperId'] == nil or state['cursorId'] > state['upperId']) then return false end
  else
    return false
  end
  return valid_page(state) and valid_retries(state['retries'], state['nextTicket'])
end
`;
