local VM = {}

local function ru32(s, i)
  local b1 = string.byte(s, i)
  local b2 = string.byte(s, i + 1)
  local b3 = string.byte(s, i + 2)
  local b4 = string.byte(s, i + 3)
  return b1 + b2 * 256 + b3 * 65536 + b4 * 16777216
end

local function rxor(b, k)
  return bit32.bxor(b, bit32.band(k, 0xFF))
end

function VM.run(blob)
  if string.sub(blob, 1, 4) ~= "LVM0" then error("bad magic") end

  local ver = ru32(blob, 5)
  local key = ru32(blob, 9)
  local constLen = ru32(blob, 13)
  local codeLen = ru32(blob, 17)

  local constOff = 21
  local codeOff = constOff + constLen
  local codeEnd = codeOff + codeLen - 1

  local regs = {}
  local pc = codeOff

  local function fetch()
    local b = string.byte(blob, pc)
    pc += 1
    return rxor(b, key)
  end

  while pc <= codeEnd do
    local op = fetch()

    if op == 0x01 then
      local r = fetch()
      local imm = fetch()
      regs[r] = imm
    elseif op == 0x02 then
      local dst = fetch()
      local a = fetch()
      local b = fetch()
      regs[dst] = (regs[a] or 0) + (regs[b] or 0)
    elseif op == 0xFF then
      local r = fetch()
      return regs[r]
    else
      error("bad op " .. tostring(op) .. " ver=" .. tostring(ver))
    end
  end
end

return VM
