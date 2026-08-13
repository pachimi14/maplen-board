import { normalizeJobPayload } from "../domain/contract.js";

export const DEFAULT_RAFFLE_API_BASE = "https://api.lulumi-tools.com";
const TERMINAL = new Set(["complete", "partial", "error", "cancelled"]);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true },
    );
  });
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createRaffleSource({
  baseUrl = import.meta.env.VITE_RAFFLE_API_BASE || DEFAULT_RAFFLE_API_BASE,
  fetchImpl = (...args) => fetch(...args),
  pollIntervalMs = 500,
} = {}) {
  const base = baseUrl.replace(/\/$/, "");

  async function request(path, options = {}) {
    try {
      const response = await fetchImpl(base + path, {
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        ...options,
      });
      const data = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          code: response.status === 429 ? "rateLimited" : "httpError",
          status: response.status,
          retryAfter: response.headers?.get?.("Retry-After") || "",
        };
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, code: error?.name === "AbortError" ? "aborted" : "networkError" };
    }
  }

  return {
    searchCharacters(query, { signal } = {}) {
      return request("/raffle/v1/characters/search", {
        method: "POST",
        signal,
        body: JSON.stringify({ query }),
      });
    },

    resolveCharacter(member, { signal } = {}) {
      return request("/raffle/v1/characters/resolve", {
        method: "POST",
        signal,
        body: JSON.stringify(member),
      });
    },


    createJob(body, { signal } = {}) {
      return request("/raffle/v1/jobs", {
        method: "POST",
        signal,
        body: JSON.stringify(body),
      });
    },

    getJob(jobId, { signal } = {}) {
      return request("/raffle/v1/jobs/" + encodeURIComponent(jobId), { signal });
    },

    cancelJob(jobId, { signal } = {}) {
      return request("/raffle/v1/jobs/" + encodeURIComponent(jobId), {
        method: "DELETE",
        signal,
      });
    },

    async runJob(body, { signal, onProgress = () => {}, timeoutMs = 50000 } = {}) {
      const created = await this.createJob(body, { signal });
      if (!created.ok || typeof created.data?.jobId !== "string") return created;
      const jobId = created.data.jobId;
      const started = Date.now();

      try {
        while (Date.now() - started < timeoutMs) {
          const loaded = await this.getJob(jobId, { signal });
          if (!loaded.ok) return loaded;
          const normalized = normalizeJobPayload(loaded.data);
          if (!normalized.ok) return normalized;
          onProgress(normalized.data.progress);
          if (TERMINAL.has(normalized.data.status)) return normalized;
          await sleep(pollIntervalMs, signal);
        }
        await this.cancelJob(jobId).catch(() => {});
        return { ok: false, code: "timeout" };
      } catch (error) {
        if (error?.name === "AbortError") {
          await this.cancelJob(jobId).catch(() => {});
          return { ok: false, code: "aborted" };
        }
        return { ok: false, code: "networkError" };
      }
    },
  };
}

export const raffleSource = createRaffleSource();