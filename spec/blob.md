# Blob v0 (MVP)

Binary string:

```
offset  size  field
0       4     magic "LVM0"
4       4     version u32 LE
8       4     key u32 LE
12      4     const_len u32 LE
16      4     code_len u32 LE
20      ...   const_bytes (raw, unused in MVP)
20+N    ...   code_bytes  (XOR-encoded stream)
```

Decoder uses `key & 0xFF` as a byte XOR.
