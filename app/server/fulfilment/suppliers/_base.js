// Supplier adapter contract (server/fulfilment). Every supplier is one object:
//
//   { id, name, kinds: ['printed'|'fabricated'|'bought'], url, env: ['KEY', ...], api: 'what exists', todo: 'next step',
//     auto(): bool                      true once the env keys exist AND place() is implemented
//     quote(job, ctx)   -> Promise<obj> live price for this job, or { manual: true, reason }
//     place(job, ctx)   -> Promise<obj> submit the order, or { manual: true, reason }   (never called automatically today)
//     status(job, ctx)  -> Promise<obj> supplier-side order status, or { manual: true, reason } }
//
// ctx = { order, plan, shipTo, readPart(rel) -> Buffer, email, confirm }. Adapters never pay for anything.
'use strict';

const env = (k) => String(process.env[k] || '').trim();

/** A supplier that has no automation yet: a person places the order from the prepared order kit. */
function manual(def) {
  const keys = def.env || [];
  const reason = () => {
    if (!keys.length) return `${def.name} has no ordering API. Place it by hand from the order kit.`;
    const missing = keys.filter((k) => !env(k));
    if (missing.length) return `${def.name}: manual until ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} set in .env.local.`;
    return `${def.name}: keys found, but the API adapter is not written yet (${def.todo || 'see FULFILMENT.md'}).`;
  };
  return {
    kinds: [], env: keys, api: '', todo: '', ...def,
    auto: () => false,
    hasKeys: () => keys.length > 0 && keys.every((k) => env(k)),
    quote: async () => ({ manual: true, reason: reason() }),
    place: async () => ({ manual: true, reason: reason() }),
    status: async () => ({ manual: true, reason: reason() }),
  };
}

module.exports = { manual, env };
