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
