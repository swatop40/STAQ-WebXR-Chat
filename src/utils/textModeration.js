const MAX_NAME_LENGTH = 20;
const MAX_CHAT_LENGTH = 240;

const LEET_CHARACTER_MAP = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
};

const BANNED_TERMS = [
  "abeed",
  "adam and steve",
  "abo",
  "abbo",
  "alligator bait",
  "araboosh",
  "beaner",
  "batty boy",
  "bitch",
  "boong",
  "bougnoule",
  "bullshit",
  "camel driver",
  "camel drivers",
  "camel jockey",
  "chinaman",
  "ching chong",
  "chink",
  "chinki",
  "chinky",
  "coolie",
  "cocksucker",
  "coon",
  "cunt",
  "damn",
  "dago",
  "dick",
  "douche",
  "douchebag",
  "dyke",
  "fairy",
  "fuck",
  "fucked",
  "fucker",
  "fucking",
  "fag",
  "faggot",
  "fruit",
  "fudgepacker",
  "gayrope",
  "golliwog",
  "gook",
  "groid",
  "guinea",
  "hell",
  "homintern",
  "jap",
  "jackass",
  "kaffer",
  "kaffir",
  "kike",
  "kraut",
  "lesbo",
  "motherfucker",
  "mandingo",
  "nigga",
  "nigger",
  "piss",
  "paki",
  "pajeet",
  "polack",
  "poof",
  "poofter",
  "prick",
  "pshek",
  "raghead",
  "sambo",
  "sea queen",
  "shit",
  "sissy",
  "slut",
  "spade",
  "twat",
  "spic",
  "tranny",
  "wog",
  "wop",
  "whore",
  "wetback",
  "zipperhead",
];

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparableCharacter(character) {
  const lower = character.toLowerCase();
  return LEET_CHARACTER_MAP[lower] || lower;
}

function isSkippableCharacter(character) {
  return !/[a-z0-9]/i.test(character) && !LEET_CHARACTER_MAP[character];
}

function findBannedRanges(text) {
  const ranges = [];
  const source = String(text || "");

  for (const bannedTerm of BANNED_TERMS) {
    const comparableTerm = bannedTerm.toLowerCase();

    for (let start = 0; start < source.length; start += 1) {
      let sourceIndex = start;
      let termIndex = 0;
      let lastMatchIndex = -1;

      while (sourceIndex < source.length && termIndex < comparableTerm.length) {
        const nextCharacter = source[sourceIndex];

        if (isSkippableCharacter(nextCharacter)) {
          sourceIndex += 1;
          continue;
        }

        if (
          normalizeComparableCharacter(nextCharacter) !== comparableTerm[termIndex]
        ) {
          break;
        }

        lastMatchIndex = sourceIndex;
        sourceIndex += 1;
        termIndex += 1;
      }

      if (termIndex !== comparableTerm.length || lastMatchIndex < start) {
        continue;
      }

      const previousIndex = start - 1;
      const nextIndex = lastMatchIndex + 1;
      const previousCharacter = previousIndex >= 0 ? source[previousIndex] : "";
      const nextCharacter = nextIndex < source.length ? source[nextIndex] : "";
      const hasWordBoundaryBefore = !/[a-z0-9]/i.test(previousCharacter);
      const hasWordBoundaryAfter = !/[a-z0-9]/i.test(nextCharacter);

      if (!hasWordBoundaryBefore || !hasWordBoundaryAfter) {
        continue;
      }

      ranges.push([start, lastMatchIndex]);
      start = lastMatchIndex;
    }
  }

  return ranges.sort((left, right) => left[0] - right[0]);
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];

  const merged = [ranges[0].slice()];
  for (const [start, end] of ranges.slice(1)) {
    const previous = merged[merged.length - 1];
    if (start <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], end);
      continue;
    }
    merged.push([start, end]);
  }

  return merged;
}

function maskRange(text, start, end) {
  let masked = "";
  for (let index = start; index <= end; index += 1) {
    const character = text[index];
    masked += /\s/.test(character) ? character : "*";
  }
  return masked;
}

export function censorText(text) {
  const source = String(text || "");
  const ranges = mergeRanges(findBannedRanges(source));
  if (!ranges.length) {
    return { text: source, didCensor: false };
  }

  let output = "";
  let cursor = 0;

  for (const [start, end] of ranges) {
    output += source.slice(cursor, start);
    output += maskRange(source, start, end);
    cursor = end + 1;
  }

  output += source.slice(cursor);
  return { text: output, didCensor: true };
}

export function isDisplayNameAllowed(name) {
  const normalized = collapseWhitespace(name).slice(0, MAX_NAME_LENGTH);
  if (!normalized) {
    return {
      allowed: true,
      normalized: "",
      reason: null,
    };
  }

  const moderated = censorText(normalized);
  return {
    allowed: !moderated.didCensor,
    normalized,
    reason: moderated.didCensor ? "Name contains blocked language." : null,
  };
}

export function sanitizeChatText(text) {
  const normalized = collapseWhitespace(text).slice(0, MAX_CHAT_LENGTH);
  const moderated = censorText(normalized);
  return moderated.text;
}

export function sanitizeDisplayName(name, fallbackName = "Player") {
  const fallback = collapseWhitespace(fallbackName).slice(0, MAX_NAME_LENGTH) || "Player";
  const normalized = collapseWhitespace(name).slice(0, MAX_NAME_LENGTH);
  if (!normalized) return fallback;

  const moderated = censorText(normalized);
  const collapsed = collapseWhitespace(moderated.text);
  const hasVisibleCharacters = /[a-z0-9]/i.test(collapsed);
  return hasVisibleCharacters ? collapsed : fallback;
}

export const moderationConfig = {
  bannedTerms: [...BANNED_TERMS],
  maxChatLength: MAX_CHAT_LENGTH,
  maxNameLength: MAX_NAME_LENGTH,
};
