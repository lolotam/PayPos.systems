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
 *
 * الكتلة دي فيها كمان الترميز الدقيق للحالة: cjson لوحده بيقرّب الأعداد
 * لأربع عشرة خانة معنوية، فنسخة زي 9007199254740991 كانت بتتخزّن
 * 9.007199254741e+15 وبتطلع رقم تاني خالص. الترميز الجديد بيكتب الأعداد
 * الصحيحة الآمنة بالشكل العشري الكامل، وبيسيب باقي القيم لـcjson زي ما هي،
 * وبيزور الجداول بمكدس صريح من غير تكرار. الكتلة لازم تيجي قبل reply في كل
 * سكربت، لأن reply بيستخدم الترميز.
 *
 * النص بلا بايت هروب cjson يُقتبس مباشرة؛ 0–31 والتنصيص والمائلة والعكسية وDEL تبقى على cjson.
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

local JSON_NULL = cjson.null

-- Safe integers are written as full decimal tokens; cjson alone rounds to
-- fourteen significant digits and loses the last digits of the version.
-- Unsafe or fractional numbers fall back to cjson so their behaviour is unchanged.
local function exact_number(value)
  if value ~= value then return nil end
  if value == math.huge or value == -math.huge then return nil end
  if value ~= math.floor(value) then return nil end
  if value < -MAX_SAFE or value > MAX_SAFE then return nil end
  return string.format('%.0f', value)
end

-- A table keyed 1..n is an array, anything else is an object; an empty table
-- stays {} like cjson writes it, so the codec can still turn it into an array.
local function exact_sequence(value)
  local size = 0
  for key in pairs(value) do
    if type(key) ~= 'number' or key < 1 or key ~= math.floor(key) then return false end
    size = size + 1
  end
  for index = 1, size do
    if value[index] == nil then return false end
  end
  return true
end

local escape_class = '[%z' .. string.char(1) .. '-' .. string.char(31, 34, 47, 92, 127) .. ']'

local function exact_string(value)
  if string.find(value, escape_class) then return cjson.encode(value) end
  return '"' .. value .. '"'
end

-- The exact encoder: one cjson pass keeps its type, depth and non-finite
-- rejection, then the JSON tree is walked with an explicit stack so safe
-- integers keep every digit. The value is never mutated and no depth limit
-- below the cjson one is introduced.
local function exact_value(item, stack, depth, emit)
  local kind = type(item)
  if item == JSON_NULL then
    emit('null')
  elseif kind == 'number' then
    emit(exact_number(item) or cjson.encode(item))
  elseif kind == 'string' then
    emit(exact_string(item))
  elseif kind ~= 'table' then
    emit(cjson.encode(item))
  elseif next(item) == nil then
    emit('{}')
  elseif exact_sequence(item) then
    emit('[')
    depth = depth + 1
    stack[depth] = { kind = 'array', table = item, index = 1, size = #item, comma = false }
  else
    emit('{')
    depth = depth + 1
    stack[depth] = { kind = 'object', table = item, key = nil, comma = false }
  end
  return depth
end

local function exact_json(value)
  local admissible, failure = pcall(cjson.encode, value)
  if not admissible then error(failure, 0) end
  failure = nil
  local parts = {}
  local count = 0
  local function emit(text)
    count = count + 1
    parts[count] = text
  end
  local stack = { { kind = 'value', value = value } }
  local depth = 1
  while depth > 0 do
    local frame = stack[depth]
    if frame.kind == 'value' then
      depth = exact_value(frame.value, stack, depth - 1, emit)
    elseif frame.kind == 'array' then
      local index = frame.index
      if index > frame.size then
        depth = depth - 1
        emit(']')
      else
        frame.index = index + 1
        if frame.comma then emit(',') else frame.comma = true end
        depth = depth + 1
        stack[depth] = { kind = 'value', value = frame.table[index] }
      end
    else
      local key = next(frame.table, frame.key)
      if key == nil then
        depth = depth - 1
        emit('}')
      else
        frame.key = key
        if frame.comma then emit(',') else frame.comma = true end
        local name = key
        if type(key) ~= 'string' then name = tostring(key) end
        emit(exact_string(name))
        emit(':')
        depth = depth + 1
        stack[depth] = { kind = 'value', value = frame.table[key] }
      end
    end
  end
  return table.concat(parts, '', 1, count)
end
`;
