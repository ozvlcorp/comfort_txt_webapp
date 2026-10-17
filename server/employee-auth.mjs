import { fail, encoder, digest, seal, unseal } from './security.mjs';

const COOKIE = '__Host-comfort-session';
const TTL = 2 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ready(env) {
  if (!env.DB || !UUID.test(env.MOYSKLAD_ACCOUNT_ID || '')) fail(503, 'Вход сотрудников ещё не настроен.', 'auth_not_ready');
}
function sessionToken(request) {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-comfort-session=([a-f0-9]{64})(?:;|$)/)?.[1] || null;
}
export const clearSessionCookie = () => `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
export function checkEmployee(employee, env, expectedId) {
  if (!employee?.id || employee.accountId !== env.MOYSKLAD_ACCOUNT_ID || employee.archived || expectedId && employee.id !== expectedId) {
    fail(403, 'Вход разрешён только действующим сотрудникам подключённой компании.', 'account_forbidden');
  }
  return employee;
}
export function isAdmin(employee) { return employee.permissions?.admin === true || employee.permissions?.admin?.view === 'ALL'; }
export function canCreate(employee, type) {
  const permission = employee.permissions?.[type]?.create;
  return isAdmin(employee) || permission === true || ['ALL', 'OWN', 'OWNER', 'DEPARTMENT', 'GROUP'].includes(permission);
}
export function requireCreate(employee, type) {
  if (!canCreate(employee, type)) fail(403, 'В МойСкладе у вас нет права создавать этот документ или запись.', 'permission_denied');
}
export function publicEmployee(employee) {
  return { id: employee.id, name: employee.fullName || employee.name || employee.uid || 'Сотрудник', phone: employee.phone || '', login: employee.uid || '', admin: isAdmin(employee), canCreateOrders: canCreate(employee, 'customerorder'), canCreateClients: canCreate(employee, 'counterparty') };
}
async function cleanup(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM employee_sessions WHERE expires_at <= ? OR account_id != ?').bind(now, env.MOYSKLAD_ACCOUNT_ID),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').bind(now)
  ]);
}
async function limitAttempts(request, login, env) {
  const now = Date.now(), expires = now + 15 * 60 * 1000;
  const identities = [[`login:${login.toLowerCase()}`, 15], [`ip:${request.headers.get('cf-connecting-ip') || 'unknown'}`, 80]];
  const keys = await Promise.all(identities.map(([value]) => digest(value)));
  const results = await env.DB.batch(keys.map(value => env.DB.prepare('INSERT INTO login_attempts (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN login_attempts.expires_at <= ? THEN 1 ELSE login_attempts.attempts + 1 END, expires_at = CASE WHEN login_attempts.expires_at <= ? THEN excluded.expires_at ELSE login_attempts.expires_at END RETURNING attempts').bind(value, expires, now, now)));
  if (results.some((result, index) => result.results?.[0]?.attempts > identities[index][1])) fail(429, 'Слишком много попыток входа. Повторите через 15 минут.', 'login_rate_limit');
}
export async function loginEmployee(request, input, env, provider) {
  ready(env);
  const login = typeof input.login === 'string' ? input.login.trim() : '', password = input.password;
  if (!login || login.length > 255 || /[:\x00-\x1f\x7f]/.test(login) || typeof password !== 'string' || !password || password.length > 500) fail(400, 'Введите личный логин и пароль МойСклада.', 'login_invalid');
  await cleanup(env);
  await limitAttempts(request, login, env);
  const authorization = 'Basic ' + btoa(String.fromCharCode(...encoder.encode(`${login}:${password}`)));
  let employee;
  try { const context = await provider(authorization, '/context/employee'); employee = checkEmployee(context.employee || context, env); }
  catch (error) { if (error.status === 401) fail(401, 'Неверный логин или пароль, либо вход через API недоступен для этого сотрудника.', 'login_invalid'); throw error; }
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(32)), v => v.toString(16).padStart(2, '0')).join('');
  const hash = await digest(sid), expires = Date.now() + TTL;
  const encrypted = await seal(env, `${env.MOYSKLAD_ACCOUNT_ID}:${hash}`, { authorization });
  await logoutEmployee(request, env);
  await env.DB.prepare('INSERT INTO employee_sessions (id, account_id, employee_id, secret, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash, env.MOYSKLAD_ACCOUNT_ID, employee.id, encrypted, expires).run();
  return { employee: publicEmployee(employee), expires, cookie: `${COOKIE}=${sid}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}` };
}
export async function logoutEmployee(request, env) {
  const sid = sessionToken(request);
  if (sid && env.DB) await env.DB.prepare('DELETE FROM employee_sessions WHERE id = ?').bind(await digest(sid)).run();
}
export async function employeeSession(request, env, provider) {
  const sid = sessionToken(request);
  if (!sid) return null;
  ready(env);
  await cleanup(env);
  const hash = await digest(sid);
  const row = await env.DB.prepare('SELECT * FROM employee_sessions WHERE id = ?').bind(hash).first();
  if (!row || row.expires_at <= Date.now() || row.account_id !== env.MOYSKLAD_ACCOUNT_ID) fail(401, 'Сессия завершена. Войдите снова.', 'signin_required');
  let secret;
  try { secret = await unseal(env, `${row.account_id}:${hash}`, JSON.parse(row.secret)); }
  catch { await logoutEmployee(request, env); fail(401, 'Сессия завершена. Войдите снова.', 'signin_required'); }
  let employee;
  try { const context = await provider(secret.authorization, '/context/employee'); employee = checkEmployee(context.employee || context, env, row.employee_id); }
  catch (error) { if ([401, 403].includes(error.status)) { await logoutEmployee(request, env); fail(401, 'Доступ сотрудника изменён. Войдите снова.', 'signin_required'); } throw error; }
  return { id: employee.id, accountId: employee.accountId, email: employee.email || '', employee, authorization: secret.authorization, expires: row.expires_at };
}
