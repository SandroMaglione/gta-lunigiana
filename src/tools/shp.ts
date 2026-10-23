// Minimal ESRI shapefile + dBase III reader for the gzipped CTR layers: polygons and polylines
// (Z and M variants too; extra dimensions are skipped), attributes as trimmed latin-1 strings.
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

export interface ShpRecord {
  readonly parts: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
  readonly attrs: Readonly<Record<string, string>>
}

const readDbf = (path: string): Array<Record<string, string>> => {
  const b = gunzipSync(readFileSync(path))
  const count = b.readUInt32LE(4),
    header = b.readUInt16LE(8),
    size = b.readUInt16LE(10)
  const fields: Array<{ name: string; len: number }> = []
  for (let o = 32; b[o] !== 0x0d; o += 32)
    fields.push({ name: b.toString("latin1", o, o + 11).replace(/\0.*$/, ""), len: b[o + 16]! })
  return Array.from({ length: count }, (_, i) => {
    let o = header + i * size + 1 // skip the deletion flag
    const row: Record<string, string> = {}
    for (const f of fields) {
      row[f.name] = b.toString("latin1", o, o + f.len).trim()
      o += f.len
    }
    return row
  })
}

/** `base` without extension: reads base.shp.gz and base.dbf.gz. */
export const readShp = (base: string): Array<ShpRecord> => {
  const b = gunzipSync(readFileSync(`${base}.shp.gz`)),
    attrs = readDbf(`${base}.dbf.gz`)
  const out: Array<ShpRecord> = []
  for (let o = 100; o < b.length;) {
    const content = o + 8,
      type = b.readInt32LE(content)
    const parts: Array<Array<readonly [number, number]>> = []
    if (type !== 0) {
      if (![3, 5, 13, 15, 23, 25].includes(type)) throw new Error(`${base}.shp: shape type ${type}`)
      const np = b.readInt32LE(content + 36),
        nv = b.readInt32LE(content + 40)
      const starts = Array.from({ length: np }, (_, k) => b.readInt32LE(content + 44 + 4 * k))
      const xy = content + 44 + 4 * np
      for (let k = 0; k < np; k++) {
        const part: Array<readonly [number, number]> = []
        for (let v = starts[k]!; v < (starts[k + 1] ?? nv); v++)
          part.push([b.readDoubleLE(xy + 16 * v), b.readDoubleLE(xy + 16 * v + 8)])
        parts.push(part)
      }
    }
    out.push({ parts, attrs: attrs[out.length]! })
    o = content + b.readInt32BE(o + 4) * 2
  }
  return out
}
