import rateLimit from "express-rate-limit";

const commonOptions = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  validate: {
    forwardedHeader: false,
  },
};

export const configReadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  ...commonOptions,
});

export const deploymentRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  ...commonOptions,
});

export const modelDiscoveryRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  ...commonOptions,
});

export const frontendRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 600,
  ...commonOptions,
});
