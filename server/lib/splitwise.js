import User from '../models/User.js';

const SPLITWISE_BASE_URL = process.env.SPLITWISE_BASE_URL || 'https://secure.splitwise.com';
const SPLITWISE_API_BASE = process.env.SPLITWISE_API_BASE || 'https://secure.splitwise.com/api/v3.0';
const SPLITWISE_CLIENT_ID = process.env.SPLITWISE_CLIENT_ID;
const SPLITWISE_CLIENT_SECRET = process.env.SPLITWISE_CLIENT_SECRET;

function toUrlEncoded(value, form = new URLSearchParams(), prefix = null) {
  if (value === null || value === undefined) return form;

  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      const key = prefix ? `${prefix}[${idx}]` : String(idx);
      toUrlEncoded(item, form, key);
    });
    return form;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([k, v]) => {
      const key = prefix ? `${prefix}[${k}]` : k;
      toUrlEncoded(v, form, key);
    });
    return form;
  }

  if (prefix) form.append(prefix, String(value));
  return form;
}

function firstErrorMessage(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const first = data.errors[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const firstVal = Object.values(first).flat().find(Boolean);
      if (typeof firstVal === 'string') return firstVal;
    }
  }

  if (data.errors && typeof data.errors === 'object') {
    for (const value of Object.values(data.errors)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return value[0];
      if (typeof value === 'string') return value;
    }
  }

  return '';
}

function hasSplitwiseErrors(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.error === 'string' && data.error.trim()) return true;
  if (Array.isArray(data.errors) && data.errors.length > 0) return true;
  if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors).length > 0) return true;
  if (data.success === false) return true;
  return false;
}

export async function splitwiseFetch(path, accessToken, { method = 'GET', query, body } = {}) {
  const url = new URL(`${SPLITWISE_API_BASE}${path}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.append(key, String(value));
    });
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
  const opts = { method, headers };

  if (body && method !== 'GET') {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = toUrlEncoded(body).toString();
  }

  const resp = await fetch(url, opts);
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || hasSplitwiseErrors(data)) {
    const message = firstErrorMessage(data) || `Splitwise request failed (${resp.status})`;
    const error = new Error(String(message));
    error.status = resp.status || 500;
    error.data = data;
    throw error;
  }

  return data;
}

async function refreshSplitwiseToken(userDoc) {
  if (!SPLITWISE_CLIENT_ID || !SPLITWISE_CLIENT_SECRET || !userDoc?.splitwise?.refreshToken) {
    return null;
  }

  const resp = await fetch(`${SPLITWISE_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: userDoc.splitwise.refreshToken,
      client_id: SPLITWISE_CLIENT_ID,
      client_secret: SPLITWISE_CLIENT_SECRET
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.access_token) return null;

  userDoc.splitwise.accessToken = data.access_token;
  if (data.refresh_token) userDoc.splitwise.refreshToken = data.refresh_token;
  userDoc.splitwise.tokenType = data.token_type || userDoc.splitwise.tokenType || 'bearer';
  userDoc.splitwise.expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null;
  await userDoc.save();
  return userDoc.splitwise.accessToken;
}

export async function withSplitwiseAccessToken(appUserId, fn) {
  const userDoc = await User.findById(appUserId);
  if (!userDoc?.splitwise?.accessToken) {
    const err = new Error('Splitwise is not connected for this account');
    err.status = 400;
    throw err;
  }

  try {
    return await fn(userDoc.splitwise.accessToken);
  } catch (err) {
    if (err.status !== 401) throw err;
    const refreshed = await refreshSplitwiseToken(userDoc);
    if (!refreshed) throw err;
    return fn(refreshed);
  }
}
