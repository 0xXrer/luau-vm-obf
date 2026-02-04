local Blob = require("compiler/blob")
local VM = require("runtime/vm")

local function xorEncode(key, bytes)
  local k = bit32.band(key, 0xFF)
  local out = table.create and table.create(#bytes) or {}
  for i = 1, #bytes do
    out[i] = string.char(bit32.bxor(bytes[i], k))
  end
  return table.concat(out)
end

local ver = 1
local key = 0x12345678
local constBytes = ""

local code = {
  0x01, 0x01, 0x05,
  0x01, 0x02, 0x07,
  0x02, 0x03, 0x01, 0x02,
  0xFF, 0x03,
}

local codeBytes = xorEncode(key, code)
local blob = Blob.pack(ver, key, codeBytes, constBytes)

local out = VM.run(blob)
print(out)
