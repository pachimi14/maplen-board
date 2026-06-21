/** Job alliance / branch taxonomy for job gain rankings. */

function normalizeJobKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const ARCH_MAGE_FIRE_POISON = "Arch Mage(Fire / Poison)";
const ARCH_MAGE_ICE_LIGHTNING = "Arch Mage(Ice / Lightning)";
const MIHILE = "Mihile";

/** Exact API / client strings → canonical job (incl. non-ASCII). */
const JOB_LITERAL_ALIASES = {
  ミハエル: MIHILE,
  ミハイル: MIHILE,
  Mikhael: MIHILE,
  Mikhail: MIHILE,
  Michael: MIHILE,
  Mihael: MIHILE,
  アーク: "Ark",
  アデル: "Adele",
  ホヨン: "Ho Young",
  虎影: "Ho Young",
  "Lef Pirate": "Ark",
  "Lef Warrior": "Adele",
};

function lookupLiteralJob(name) {
  const raw = String(name || "").trim();
  if (!raw) {
    return null;
  }
  if (JOB_LITERAL_ALIASES[raw]) {
    return JOB_LITERAL_ALIASES[raw];
  }
  const lower = raw.toLowerCase();
  for (const [alias, canonical] of Object.entries(JOB_LITERAL_ALIASES)) {
    if (alias.toLowerCase() === lower) {
      return canonical;
    }
  }
  return null;
}

/** Explorer → branch → canonical display names (order preserved). */
const ADVENTURER_BRANCHES = [
  {
    branch: "戦士",
    jobs: ["Hero", "Paladin", "Dark Knight"],
  },
  {
    branch: "魔法使い",
    jobs: [ARCH_MAGE_FIRE_POISON, ARCH_MAGE_ICE_LIGHTNING, "Bishop"],
  },
  {
    branch: "弓使い",
    jobs: ["Bowmaster", "Marksman", "Pathfinder"],
  },
  {
    branch: "盗賊",
    jobs: ["Night Lord", "Shadower", "Blade Master"],
  },
  {
    branch: "海賊",
    jobs: ["Corsair", "Buccaneer", "Cannon Master"],
  },
];

const HERO_JOBS = ["Aran", "Evan", "Mercedes", "Phantom", "Luminous", "Shade"];

const CYGNUS_JOBS = [
  "Dawn Warrior",
  "Blaze Wizard",
  "Wind Archer",
  "Night Walker",
  "Thunder Breaker",
  MIHILE,
];

const LEF_JOBS = ["Ark", "Adele"];

const ANIMA_JOBS = ["Ho Young"];

/** API / formatJobName variants → canonical job name */
const JOB_KEY_ALIASES = {
  hero: "Hero",
  paladin: "Paladin",
  darkknight: "Dark Knight",
  darknight: "Dark Knight",
  fpmage: ARCH_MAGE_FIRE_POISON,
  fparchmage: ARCH_MAGE_FIRE_POISON,
  fparcheage: ARCH_MAGE_FIRE_POISON,
  firepoison: ARCH_MAGE_FIRE_POISON,
  firepoisonmage: ARCH_MAGE_FIRE_POISON,
  archmagefirepoison: ARCH_MAGE_FIRE_POISON,
  ilmage: ARCH_MAGE_ICE_LIGHTNING,
  ilarchmage: ARCH_MAGE_ICE_LIGHTNING,
  icelightning: ARCH_MAGE_ICE_LIGHTNING,
  icelightningmage: ARCH_MAGE_ICE_LIGHTNING,
  archmageicelightning: ARCH_MAGE_ICE_LIGHTNING,
  bishop: "Bishop",
  bowmaster: "Bowmaster",
  marksman: "Marksman",
  pathfinder: "Pathfinder",
  nightlord: "Night Lord",
  shadower: "Shadower",
  blademaster: "Blade Master",
  soulemaster: "Dawn Warrior",
  soulmaster: "Dawn Warrior",
  corsair: "Corsair",
  buccaneer: "Buccaneer",
  baccaneer: "Buccaneer",
  cannonmaster: "Cannon Master",
  cannonshooter: "Cannon Master",
  cannoneer: "Cannon Master",
  aran: "Aran",
  evan: "Evan",
  mercedes: "Mercedes",
  phantom: "Phantom",
  luminous: "Luminous",
  shade: "Shade",
  eunwol: "Shade",
  dawnwarrior: "Dawn Warrior",
  blazewizard: "Blaze Wizard",
  flamewizard: "Blaze Wizard",
  windarcher: "Wind Archer",
  windbreaker: "Wind Archer",
  thunderbreaker: "Thunder Breaker",
  striker: "Thunder Breaker",
  mihile: MIHILE,
  mikhael: MIHILE,
  mikael: MIHILE,
  mikhail: MIHILE,
  michael: MIHILE,
  mihael: MIHILE,
  ark: "Ark",
  adele: "Adele",
  lefpirate: "Ark",
  lefwarrior: "Adele",
  hoyoung: "Ho Young",
  hoyoungmage: "Ho Young",
};

const JOB_CATEGORY_LOOKUP = new Map();

function registerJob(alliance, branch, canonicalJob) {
  JOB_CATEGORY_LOOKUP.set(normalizeJobKey(canonicalJob), {
    alliance,
    branch,
    job: canonicalJob,
  });
}

for (const { branch, jobs } of ADVENTURER_BRANCHES) {
  for (const job of jobs) {
    registerJob("冒険家", branch, job);
  }
}

for (const job of HERO_JOBS) {
  registerJob("英雄", null, job);
}

for (const job of CYGNUS_JOBS) {
  registerJob("シグナス", null, job);
}

for (const job of LEF_JOBS) {
  registerJob("レフ", null, job);
}

for (const job of ANIMA_JOBS) {
  registerJob("アニマ", null, job);
}

for (const [key, canonical] of Object.entries(JOB_KEY_ALIASES)) {
  const category = JOB_CATEGORY_LOOKUP.get(normalizeJobKey(canonical));
  if (category) {
    JOB_CATEGORY_LOOKUP.set(key, category);
  }
}

export const JOB_TAXONOMY = [
  { alliance: "冒険家", branches: ADVENTURER_BRANCHES },
  { alliance: "英雄", branches: [{ branch: null, jobs: HERO_JOBS }] },
  { alliance: "シグナス", branches: [{ branch: null, jobs: CYGNUS_JOBS }] },
  { alliance: "レフ", branches: [{ branch: null, jobs: LEF_JOBS }] },
  { alliance: "アニマ", branches: [{ branch: null, jobs: ANIMA_JOBS }] },
];

export const JOB_ALLIANCES = JOB_TAXONOMY.map((entry) => entry.alliance);

export function classifyJob(displayJobName) {
  const literal = lookupLiteralJob(displayJobName);
  if (literal) {
    return JOB_CATEGORY_LOOKUP.get(normalizeJobKey(literal)) ?? null;
  }
  const key = normalizeJobKey(displayJobName);
  const alias = JOB_KEY_ALIASES[key];
  const lookupKey = alias ? normalizeJobKey(alias) : key;
  return JOB_CATEGORY_LOOKUP.get(lookupKey) ?? null;
}

export function canonicalJobName(displayJobName) {
  return (
    lookupLiteralJob(displayJobName) ??
    classifyJob(displayJobName)?.job ??
    displayJobName
  );
}

export { lookupLiteralJob };

/** Arrange flat per-job ranking groups into alliance → branch → jobs. */
export function categorizeJobRankings(flatGroups) {
  const byCanonical = new Map();

  for (const group of flatGroups) {
    const category = classifyJob(group.job);
    const key = category?.job ?? group.job;
    const existing = byCanonical.get(key);
    if (!existing || group.memberCount > existing.memberCount) {
      byCanonical.set(key, { ...group, job: key });
    }
  }

  const unclassified = flatGroups.filter((group) => !classifyJob(group.job));

  const alliances = JOB_TAXONOMY.map(({ alliance, branches }) => ({
    alliance,
    branches: branches.map(({ branch, jobs }) => ({
      branch,
      jobs: jobs.map((jobName) => {
        const group = byCanonical.get(jobName);
        if (group) {
          return group;
        }
        return {
          job: jobName,
          memberCount: 0,
          topGain: 0,
          top: [],
          allSorted: [],
        };
      }),
    })),
  }));

  const otherJobs = unclassified.filter(
    (group) => group.memberCount > 0 && !classifyJob(group.job)
  );

  return { alliances, otherJobs };
}
