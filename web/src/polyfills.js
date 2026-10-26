// Array.prototype.at arrived in Safari 15.4; three.js uses it. Older iPhones get this small stand-in.
const at = { value(i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; }, writable: true, configurable: true };
for (const proto of [Array.prototype, String.prototype, Object.getPrototypeOf(Int8Array.prototype)]) {
  if (!proto.at) Object.defineProperty(proto, 'at', at);
}
