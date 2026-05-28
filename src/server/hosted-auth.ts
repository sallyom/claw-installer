import type { NextFunction, Request, Response } from "express";
import { installerRunMode } from "./installer-mode.js";
import { currentHostedUser, runWithRequestContext, type HostedUserContext } from "./request-context.js";

function firstHeader(req: Request, names: string[]): string {
  for (const name of names) {
    const value = req.get(name);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return "";
}

function bearerToken(req: Request): string {
  const forwarded = firstHeader(req, [
    "x-forwarded-access-token",
    "x-forwarded-token",
  ]);
  if (forwarded) {
    return forwarded;
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function parseGroups(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function hostedUserFromRequest(req: Request): HostedUserContext | null {
  const username = firstHeader(req, [
    "x-forwarded-user",
    "x-remote-user",
  ]);
  const token = bearerToken(req);
  if (!username || !token) {
    return null;
  }
  return {
    username,
    token,
    groups: parseGroups(firstHeader(req, [
      "x-forwarded-groups",
      "x-remote-groups",
    ])),
  };
}

export function hostedRequestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (installerRunMode() !== "hosted") {
    runWithRequestContext({}, next);
    return;
  }

  const hostedUser = hostedUserFromRequest(req);
  if (!hostedUser && req.method === "GET" && req.path === "/health") {
    runWithRequestContext({}, next);
    return;
  }
  if (!hostedUser) {
    res.status(401).json({ error: "Hosted installer requests require OpenShift OAuth user headers" });
    return;
  }

  runWithRequestContext({ hostedUser }, next);
}

export function hostedUserPrefix(): string {
  const username = currentHostedUser()?.username || "";
  return username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
