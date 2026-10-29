// Playwright does not preserve custom Error properties across evaluate().
// Carry the protocol error explicitly so CLI clients receive the same code as UI clients.
export async function invokePage(page, method, args = []) {
  const reply = await page.evaluate(async ({ method, args }) => {
    try { return { ok: true, value: await window.mengxReader.invoke(method, args) }; }
    catch (error) { return { ok: false, message: error.message, code: error.code || 'operation-failed', name: error.name }; }
  }, { method, args });
  if (!reply.ok) throw Object.assign(new Error(reply.message), { code: reply.code, name: reply.name || 'Error' });
  return reply.value;
}
