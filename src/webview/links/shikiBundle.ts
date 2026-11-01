// src/webview/links/shikiBundle.ts — Entry point of `media/shiki.js`.
//
// The curated Shiki bundle (design.md D1): 20 grammars, 4 themes and the
// JavaScript regex engine, composed statically at build time into an IIFE of
// its own. `syntaxRenderer.ts` adds it to the page on first use; running, it
// publishes itself on `globalThis[SHIKI_GLOBAL]`.

import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import css from "@shikijs/langs/css";
import go from "@shikijs/langs/go";
import html from "@shikijs/langs/html";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import kotlin from "@shikijs/langs/kotlin";
import markdown from "@shikijs/langs/markdown";
import php from "@shikijs/langs/php";
import python from "@shikijs/langs/python";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import yaml from "@shikijs/langs/yaml";
import darkPlus from "@shikijs/themes/dark-plus";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import lightPlus from "@shikijs/themes/light-plus";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { SHIKI_GLOBAL, type ShikiBundle } from "./shikiGlobal";

export const shikiBundle: ShikiBundle = {
  createHighlighter: () =>
    createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      langs: [
        c,
        cpp,
        css,
        go,
        html,
        java,
        javascript,
        json,
        jsx,
        kotlin,
        markdown,
        php,
        python,
        ruby,
        rust,
        shellscript,
        sql,
        tsx,
        typescript,
        yaml,
      ],
      themes: [githubLight, lightPlus, githubDark, darkPlus],
    }),
};

(globalThis as Record<string, unknown>)[SHIKI_GLOBAL] = shikiBundle;
