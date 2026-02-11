/**
 * themeColors.ts — Extracts syntax token colors from the active VS Code color theme.
 *
 * VS Code doesn't expose editor token colors as CSS custom properties in webviews.
 * This module reads the active theme's JSON file, parses its `tokenColors` array,
 * and maps TextMate scopes to our syntax highlight token classes.
 *
 * Falls back to sensible defaults (Dark+/Light+ palette) if parsing fails.
 */

import * as path from "path";
import * as vscode from "vscode";

/** The token colors we need for our syntax highlighter. */
export interface SyntaxTokenColors {
  key: string; // JSON property names
  string: string; // string values
  number: string; // numeric values
  bool: string; // true/false keywords
  nullVal: string; // null keyword
  tag: string; // HTML tag names
  attrName: string; // HTML attribute names
  attrValue: string; // HTML attribute values
  comment: string; // comments
  punctuation: string; // brackets, colons, commas
}

// Scope → our token key mapping (ordered by priority: most specific first)
const SCOPE_MAP: Array<{ scopes: string[]; token: keyof SyntaxTokenColors }> = [
  {
    scopes: [
      "support.type.property-name",
      "meta.object-literal.key",
      "string.json support.type.property-name",
    ],
    token: "key",
  },
  { scopes: ["string.quoted", "string"], token: "string" },
  { scopes: ["constant.numeric", "constant.numeric.json"], token: "number" },
  {
    scopes: [
      "constant.language.boolean",
      "constant.language.json",
      "constant.language",
    ],
    token: "bool",
  },
  {
    scopes: ["constant.language.null", "constant.language.undefined"],
    token: "nullVal",
  },
  { scopes: ["entity.name.tag", "entity.name.tag.html"], token: "tag" },
  {
    scopes: ["entity.other.attribute-name", "entity.other.attribute-name.html"],
    token: "attrName",
  },
  {
    scopes: ["string.quoted.double.html", "meta.attribute string"],
    token: "attrValue",
  },
  { scopes: ["comment", "comment.block", "comment.line"], token: "comment" },
  {
    scopes: ["punctuation", "meta.brace", "punctuation.definition"],
    token: "punctuation",
  },
];

const DARK_DEFAULTS: SyntaxTokenColors = {
  key: "#9cdcfe",
  string: "#ce9178",
  number: "#b5cea8",
  bool: "#569cd6",
  nullVal: "#569cd6",
  tag: "#569cd6",
  attrName: "#9cdcfe",
  attrValue: "#ce9178",
  comment: "#6a9955",
  punctuation: "#d4d4d4",
};

const LIGHT_DEFAULTS: SyntaxTokenColors = {
  key: "#0451a5",
  string: "#a31515",
  number: "#098658",
  bool: "#0000ff",
  nullVal: "#0000ff",
  tag: "#800000",
  attrName: "#ff0000",
  attrValue: "#0000ff",
  comment: "#008000",
  punctuation: "#000000",
};

interface ThemeTokenColorRule {
  scope?: string | string[];
  settings?: {
    foreground?: string;
    fontStyle?: string;
  };
}

/**
 * Read and parse a JSON/JSONC theme file. Strips comments and trailing commas.
 */
async function readThemeFile(uri: vscode.Uri): Promise<any> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  let text = Buffer.from(bytes).toString("utf-8");
  // Strip single-line comments
  text = text.replace(/\/\/.*$/gm, "");
  // Strip block comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip trailing commas before } or ]
  text = text.replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(text);
}

/**
 * Recursively resolve a theme, following `include` references.
 * Returns a flat array of all tokenColors rules.
 */
async function resolveTokenColors(
  themeUri: vscode.Uri,
): Promise<ThemeTokenColorRule[]> {
  try {
    const theme = await readThemeFile(themeUri);
    let rules: ThemeTokenColorRule[] = [];

    // Follow includes first (base themes)
    if (theme.include) {
      const includeUri = vscode.Uri.joinPath(
        vscode.Uri.file(path.dirname(themeUri.fsPath)),
        theme.include,
      );
      const baseRules = await resolveTokenColors(includeUri);
      rules = [...baseRules];
    }

    // Then overlay this theme's tokenColors
    if (Array.isArray(theme.tokenColors)) {
      rules = [...rules, ...theme.tokenColors];
    }

    return rules;
  } catch {
    return [];
  }
}

/**
 * Find the best foreground color for a given set of target scopes
 * from the theme's tokenColors rules.
 *
 * Matching: a rule scope "string" matches target "string.quoted.double".
 * More specific matches win (longer scope string).
 */
function findColor(
  targetScopes: string[],
  rules: ThemeTokenColorRule[],
): string | undefined {
  let bestColor: string | undefined;
  let bestSpecificity = -1;

  for (const rule of rules) {
    if (!rule.settings?.foreground) continue;

    const ruleScopes = Array.isArray(rule.scope)
      ? rule.scope
      : typeof rule.scope === "string"
        ? rule.scope.split(/\s*,\s*/)
        : [];

    for (const ruleScope of ruleScopes) {
      const trimmed = ruleScope.trim();
      for (const target of targetScopes) {
        if (
          target === trimmed ||
          target.startsWith(trimmed + ".") ||
          target.startsWith(trimmed + " ")
        ) {
          if (trimmed.length > bestSpecificity) {
            bestSpecificity = trimmed.length;
            bestColor = rule.settings.foreground;
          }
        }
        // Also match the other direction: rule is more specific than our target
        if (
          trimmed.startsWith(target + ".") ||
          trimmed.startsWith(target + " ") ||
          trimmed === target
        ) {
          if (trimmed.length > bestSpecificity) {
            bestSpecificity = trimmed.length;
            bestColor = rule.settings.foreground;
          }
        }
      }
    }
  }

  return bestColor;
}

/**
 * Get the syntax token colors from the currently active VS Code color theme.
 */
export async function getThemeTokenColors(): Promise<SyntaxTokenColors> {
  const themeKind = vscode.window.activeColorTheme.kind;
  const isLight =
    themeKind === vscode.ColorThemeKind.Light ||
    themeKind === vscode.ColorThemeKind.HighContrastLight;
  const defaults = isLight ? LIGHT_DEFAULTS : DARK_DEFAULTS;

  try {
    const themeName = vscode.workspace
      .getConfiguration("workbench")
      .get<string>("colorTheme");

    if (!themeName) return defaults;

    // Find the extension that provides this theme
    let themeUri: vscode.Uri | undefined;
    for (const ext of vscode.extensions.all) {
      const contributes = ext.packageJSON?.contributes;
      if (!contributes?.themes) continue;

      for (const themeContrib of contributes.themes) {
        const label: string = themeContrib.label ?? themeContrib.id ?? "";
        if (label === themeName || themeContrib.id === themeName) {
          const themePath: string = themeContrib.path;
          themeUri = vscode.Uri.file(path.join(ext.extensionPath, themePath));
          break;
        }
      }
      if (themeUri) break;
    }

    if (!themeUri) return defaults;

    const rules = await resolveTokenColors(themeUri);
    if (rules.length === 0) return defaults;

    // Build our color map from the rules
    const result: SyntaxTokenColors = { ...defaults };
    for (const mapping of SCOPE_MAP) {
      const color = findColor(mapping.scopes, rules);
      if (color) {
        result[mapping.token] = color;
      }
    }

    return result;
  } catch (e) {
    console.warn("rAPI: Failed to read theme token colors, using defaults:", e);
    return defaults;
  }
}

/**
 * Generate a CSS string with custom properties for our syntax tokens.
 */
export function tokenColorsToCss(colors: SyntaxTokenColors): string {
  return `
    --rapi-syn-key: ${colors.key};
    --rapi-syn-string: ${colors.string};
    --rapi-syn-number: ${colors.number};
    --rapi-syn-bool: ${colors.bool};
    --rapi-syn-null: ${colors.nullVal};
    --rapi-syn-tag: ${colors.tag};
    --rapi-syn-attr-name: ${colors.attrName};
    --rapi-syn-attr-value: ${colors.attrValue};
    --rapi-syn-comment: ${colors.comment};
    --rapi-syn-punctuation: ${colors.punctuation};
  `;
}
