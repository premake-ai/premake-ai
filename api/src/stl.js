'use strict';
/** STL (binary or ASCII) -> triangles [[x,y,z] x3]. */
function readStl(buf) {
  const tris = [];
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (buf.length === 84 + n * 50 && n > 0) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50, f = (k) => buf.readFloatLE(o + k * 4);
      tris.push([[f(3), f(4), f(5)], [f(6), f(7), f(8)], [f(9), f(10), f(11)]]);
    }
    return tris;
  }
  const v = [...buf.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < v.length; i += 3) tris.push([v[i], v[i + 1], v[i + 2]]);
  return tris;
}
module.exports = { readStl };
