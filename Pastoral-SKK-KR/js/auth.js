import { api, setToken } from './api.js';
import { CONFIG } from './config.js';

let currentUser = null;

export function getCurrentUser() {
  if (currentUser) return currentUser;
  const stored = localStorage.getItem(CONFIG.USER_KEY);
  if (stored) {
    currentUser = JSON.parse(stored);
    return currentUser;
  }
  return null;
}

export function setCurrentUser(user) {
  currentUser = user;
  if (user) localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CONFIG.USER_KEY);
}

export async function login(username, password) {
  const data = await api.login(username, password);
  setCurrentUser(data.user);
  return data.user;
}

export function logout() {
  setCurrentUser(null);
  setToken(null);
}

export async function checkHasUsers() {
  try {
    return await api.hasUsers();
  } catch {
    return false;
  }
}

export async function setupAdmin(username, fullName, password) {
  return api.setup(username, fullName, password, 'admin');
}

export function hasRole(roles) {
  const user = getCurrentUser();
  if (!user) return false;
  if (!Array.isArray(roles)) roles = [roles];
  return roles.includes(user.role);
}

export function isReadOnly() {
  const user = getCurrentUser();
  return user && user.role === 'gereja';
}

function normalizePermission(perm) {
  // Boolean values pass through unchanged (feature toggles like _kalender_pastoral)
  if (typeof perm === 'boolean') {
    return perm;
  }
  // Convert old string format to new object format
  if (typeof perm === 'string') {
    return { level: perm, divisions: [], classes: [] };
  }
  if (perm && typeof perm === 'object') {
    return {
      level: perm.level || 'none',
      divisions: perm.divisions || [],
      classes: perm.classes || []
    };
  }
  return { level: 'none', divisions: [], classes: [] };
}

export function getUserPermissions() {
  const user = getCurrentUser();
  if (!user) return {};
  // Admin always has full access
  if (user.role === 'admin') {
    const full = {};
    CONFIG.PRESENSI_TYPES.forEach(t => full[t.value] = { level: 'write', divisions: [], classes: [] });
    full._kalender_pastoral = true;
    return full;
  }
  // Use stored permissions
  if (user.permissions && Object.keys(user.permissions).length > 0) {
    const result = {};
    Object.entries(user.permissions).forEach(([k, v]) => result[k] = normalizePermission(v));
    return result;
  }
  // Fall back to role defaults
  const defaults = CONFIG.PERMISSION_DEFAULTS[user.role] || {};
  const result = {};
  Object.entries(defaults).forEach(([k, v]) => result[k] = normalizePermission(v));
  return result;
}

export function hasPermission(presensiType, level) {
  const perms = getUserPermissions();
  const perm = perms[presensiType] || { level: 'none' };
  const levels = CONFIG.PERMISSION_LEVELS;
  return levels.indexOf(perm.level) >= levels.indexOf(level);
}

export function hasAccess(presensiType) {
  return hasPermission(presensiType, 'view');
}

export function canWrite(presensiType) {
  return hasPermission(presensiType, 'write');
}

// Returns restriction filters for a presensi type
export function getPermissionFilter(presensiType) {
  const perms = getUserPermissions();
  const perm = perms[presensiType] || { level: 'none', divisions: [], classes: [] };
  if (perm.level === 'none') return null; // no access at all
  return {
    level: perm.level,
    divisions: perm.divisions || [],
    classes: perm.classes || []
  };
}
