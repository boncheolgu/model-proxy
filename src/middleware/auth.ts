import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { resolveTenantByApiKey, type Tenant } from '../auth/api-key.js';

export type AuthedRequest = Request & {
  tenant: Tenant;
  conversationKey: string;
};

function unauthorized(res: Response, msg: string) {
  res.status(401).json({ error: { message: msg, type: 'invalid_request_error', code: 'unauthorized' } });
}

function parseBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

export function resolveConversationKey(req: Request, model: string): string {
  const explicit = String(req.header('x-conversation-key') || '').trim();
  if (explicit) return explicit;
  const fallback = `${req.ip}:${model}`;
  return crypto.createHash('sha256').update(fallback).digest('hex').slice(0, 24);
}

export function requireAuthAndTenant(req: Request, res: Response, next: NextFunction) {
  const token = parseBearerToken(req.header('authorization'));
  if (!token) return unauthorized(res, 'Missing bearer token');
  const tenant = resolveTenantByApiKey(token);
  if (!tenant) return unauthorized(res, 'Invalid API key');
  (req as AuthedRequest).tenant = tenant;
  next();
}
