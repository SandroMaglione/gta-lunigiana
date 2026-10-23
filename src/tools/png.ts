// Minimal PNG encoder on node:zlib (8-bit RGB, filter 0), for the map preview.
import { crc32, deflateSync } from "node:zlib"

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

const chunk = (type: string, data: Uint8Array): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** Encodes 8-bit RGB pixels (row-major, top row first) as a PNG with filter 0. */
export const encodePngRgb = (width: number, height: number, rgb: Uint8Array): Buffer => {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from(SIG),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ])
}
