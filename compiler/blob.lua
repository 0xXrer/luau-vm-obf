local Blob = {}

local function u32(n)
  local b1 = n % 256
  local b2 = math.floor(n / 256) % 256
  local b3 = math.floor(n / 65536) % 256
  local b4 = math.floor(n / 16777216) % 256
  return string.char(b1, b2, b3, b4)
end

function Blob.pack(specVersion, key, codeBytes, constBytes)
  local magic = "LVM0"
  local header = magic .. u32(specVersion) .. u32(key) .. u32(#constBytes) .. u32(#codeBytes)
  return header .. constBytes .. codeBytes
end

return Blob
