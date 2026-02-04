# ISA v0 (MVP)

Byte-oriented stream. Each byte is XOR-decoded with `key & 0xFF`.

Registers: `R0..R255` (byte index).
All immediates are bytes in MVP.

Opcodes:

- `0x01 LOADI r imm`
  - `r: u8`, `imm: u8`
  - `R[r] = imm`

- `0x02 ADD dst a b`
  - `dst,a,b: u8`
  - `R[dst] = (R[a] or 0) + (R[b] or 0)`

- `0xFF RET r`
  - `r: u8`
  - returns `R[r]`

This MVP exists to wire CI and the agent loop.
